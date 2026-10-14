import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { applyCors } from './cors.js';
import { isAuthorized } from './auth.js';
import { createActivityRepository } from './repositories/activity.js';
import { createItemsRepository } from './repositories/items.js';

export function createApp({ pool, connectors, auth, frontendOrigin, commit, logger = (entry) => console.log(JSON.stringify(entry)) } = {}) {
  const activityRepository = pool ? createActivityRepository(pool) : null;
  const itemsRepository = pool ? createItemsRepository(pool, activityRepository) : null;

  return async function requestHandler(request, response) {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let pathname = '/';
    response.once('finish', () => {
      try {
        logger({ id: requestId, method: request.method, path: pathname, status: response.statusCode, durationMs: Math.max(0, Math.round(performance.now() - startedAt)) });
      } catch {
        // Request logging must not interrupt response handling.
      }
    });

    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      pathname = requestUrl.pathname;
      if (applyCors(request, response, { frontendOrigin })) return;

      if (request.method === 'GET' && pathname === '/api/version') {
        sendJson(response, 200, { commit });
        return;
      }

      if (!isAuthorized(request.headers.authorization, auth)) {
        response.setHeader('WWW-Authenticate', 'Basic realm="PS3", charset="UTF-8"');
        sendError(response, 401, 'unauthorized', 'Authentication required');
        return;
      }

      if (pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (pathname.startsWith('/api/')) {
        if (!itemsRepository || !activityRepository) {
          sendError(response, 503, 'unavailable', 'The database is not configured');
          return;
        }
        await handleApiRequest(request, response, requestUrl, itemsRepository, activityRepository, connectors);
        return;
      }

      sendError(response, 404, 'not_found', 'Route not found');
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(response, error.status, error.code, error.message);
      } else if (!response.headersSent) {
        sendError(response, 500, 'internal_error', 'Unexpected server error');
      } else {
        response.destroy();
      }
    }
  };
}

async function handleApiRequest(request, response, requestUrl, itemsRepository, activityRepository, connectors = {}) {
  const { pathname } = requestUrl;

  const syncSource = pathname === '/api/sync/canvas' ? 'canvas'
    : pathname === '/api/sync/google-calendar' ? 'googleCalendar' : null;
  if (request.method === 'POST' && syncSource) {
    const connector = connectors[syncSource];
    if (typeof connector !== 'function') {
      sendJson(response, 200, emptySyncResult('This sync is not configured.'));
      return;
    }
    try {
      sendJson(response, 200, await connector({ itemsRepository }));
    } catch {
      sendJson(response, 200, emptySyncResult('The feed could not be synced.'));
    }
    return;
  }

  if (request.method === 'GET' && pathname === '/api/items') {
    const section = requestUrl.searchParams.get('section');
    if (!section) {
      sendError(response, 400, 'invalid_query', 'A section is required');
      return;
    }
    sendJson(response, 200, { items: (await itemsRepository.list({ section })).map(presentItem) });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/today') {
    sendJson(response, 200, { items: (await itemsRepository.list({ todayOnly: true })).map(presentItem) });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/activity') {
    sendJson(response, 200, { events: await activityRepository.list() });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/items') {
    const input = await readJson(request);
    const validationError = validateItemPayload(input, false);
    if (validationError) {
      sendError(response, 400, 'invalid_item', validationError);
      return;
    }
    sendJson(response, 201, { item: presentItem(await itemsRepository.create(normalizePlanningFields(input))) });
    return;
  }

  const todayMatch = pathname.match(/^\/api\/items\/([^/]+)\/today$/);
  if (todayMatch && request.method === 'POST') {
    const input = await readJson(request);
    if (!isRecord(input) || typeof input.included !== 'boolean') {
      sendError(response, 400, 'invalid_today', 'included must be a boolean');
      return;
    }
    const item = await itemsRepository.setToday(todayMatch[1], input.included);
    if (!item) {
      sendError(response, 404, 'not_found', 'Item not found');
      return;
    }
    sendJson(response, 200, { item: presentItem(item) });
    return;
  }

  const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch && request.method === 'PATCH') {
    const patch = await readJson(request);
    const validationError = validateItemPayload(patch, true);
    if (validationError) {
      sendError(response, 400, 'invalid_item', validationError);
      return;
    }
    const calendarItem = (await itemsRepository.list({ section: 'calendar' })).find((item) => item.id === itemMatch[1]);
    if (calendarItem?.source === 'google-calendar') {
      delete patch.title;
      delete patch.dueAt;
      delete patch.due_at;
      delete patch.plannedFor;
    }
    const planningItems = (await Promise.all(['workouts', 'meals'].map((section) => itemsRepository.list({ section })))).flat();
    const planningItem = planningItems.find((entry) => entry.id === itemMatch[1]);
    const item = await itemsRepository.update(itemMatch[1], normalizePlanningFields(patch, planningItem?.notes));
    if (!item) {
      sendError(response, 404, 'not_found', 'Item not found');
      return;
    }
    sendJson(response, 200, { item: presentItem(item) });
    return;
  }

  if (itemMatch && request.method === 'DELETE') {
    const item = await itemsRepository.remove(itemMatch[1]);
    if (!item) {
      sendError(response, 404, 'not_found', 'Item not found');
      return;
    }
    sendJson(response, 200, { item: presentItem(item) });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/reorder') {
    const input = await readJson(request);
    if (!isRecord(input) || typeof input.scope !== 'string' || !input.scope || !Array.isArray(input.orderedIds)
      || input.orderedIds.some((id) => typeof id !== 'string')) {
      sendError(response, 400, 'invalid_reorder', 'scope and an orderedIds array are required');
      return;
    }
    try {
      sendJson(response, 200, { items: (await itemsRepository.reorder(input.scope, input.orderedIds)).map(presentItem) });
    } catch {
      sendError(response, 400, 'invalid_reorder', 'orderedIds must contain exactly the items in the requested scope');
    }
    return;
  }

  sendError(response, 404, 'not_found', 'Route not found');
}

function emptySyncResult(error) {
  return { imported: 0, updated: 0, skipped: 0, error };
}

function hasTitle(title) {
  return typeof title === 'string' && title.trim().length > 0;
}

function validateItemPayload(input, partial) {
  if (!isRecord(input)) return 'Request body must be a JSON object';
  if (!partial && !hasTitle(input.section)) return 'section and a non-empty title are required';
  if (!partial && !hasTitle(input.title)) return 'section and a non-empty title are required';
  if (input.section !== undefined && (!hasTitle(input.section))) return 'section must be a non-empty string';
  if (input.title !== undefined && !hasTitle(input.title)) return 'title must be a non-empty string';
  if (input.kind !== undefined && typeof input.kind !== 'string') return 'kind must be a string';
  for (const field of ['notes', 'dueAt', 'due_at', 'plannedFor', 'externalUrl', 'external_url', 'mealType', 'prepNotes']) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') {
      return `${field} must be a string or null`;
    }
  }
  for (const field of ['completed', 'inToday', 'in_today']) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') return `${field} must be a boolean`;
  }
  if (input.workoutType !== undefined && !['legs', 'abs-cardio', 'cardio'].includes(input.workoutType)) {
    return 'workoutType must be legs, abs-cardio, or cardio';
  }
  if (input.checklist !== undefined && (!Array.isArray(input.checklist) || input.checklist.some((item) => typeof item !== 'string'))) {
    return 'checklist must be an array of strings';
  }
  return null;
}

const planningPrefix = /^\[\[cc-plan:(\{.*\})\]\](?:\n)?/;

function planningData(notes) {
  if (typeof notes !== 'string') return { metadata: {}, notes };
  const match = notes.match(planningPrefix);
  if (!match) return { metadata: {}, notes };
  try {
    return { metadata: JSON.parse(match[1]), notes: notes.slice(match[0].length) || null };
  } catch {
    return { metadata: {}, notes };
  }
}

function normalizePlanningFields(input, existingNotes) {
  const { plannedFor, workoutType, mealType, prepNotes, checklist, ...item } = input;
  const hasPlanningFields = plannedFor !== undefined || workoutType !== undefined || mealType !== undefined || prepNotes !== undefined || checklist !== undefined;
  if (!hasPlanningFields) return item;

  const { metadata: existingMetadata } = planningData(existingNotes);
  const { notes } = planningData(item.notes === undefined ? existingNotes : item.notes);
  const metadata = {
    ...existingMetadata,
    ...(workoutType !== undefined ? { workoutType } : {}),
    ...(mealType !== undefined ? { mealType } : {}),
    ...(prepNotes !== undefined ? { prepNotes } : {}),
    ...(checklist !== undefined ? { checklist: checklist.filter((entry) => entry.trim()) } : {}),
  };
  return {
    ...item,
    ...(plannedFor !== undefined ? { dueAt: plannedFor } : {}),
    notes: `[[cc-plan:${JSON.stringify(metadata)}]]${notes ? `\n${notes}` : ''}`,
  };
}

function presentItem(item) {
  const { metadata, notes } = planningData(item.notes);
  return {
    ...item,
    notes,
    ...metadata,
    ...(item.section === 'workouts' || item.section === 'meals' ? { plannedFor: item.dueAt } : {}),
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}
