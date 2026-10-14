import {
  authorizationSnapshot, authorizationHeader, clearCredentials, clearCredentialsIfGeneration,
  credentialGeneration, setCredentials,
} from './auth.js';

export { authorizationHeader, clearCredentials, clearCredentialsIfGeneration, credentialGeneration, setCredentials };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
let unauthorizedHandler;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = undefined;
  };
}

function apiUrl(path) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function request(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...options.headers };
  const credentials = authorizationSnapshot();
  if (credentials.header) headers.Authorization = credentials.header;
  let response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers });
  } catch {
    throw { code: 'network_error', message: 'The server could not be reached.' };
  }
  if (response.status === 401) {
    if (clearCredentialsIfGeneration(credentials.generation)) unauthorizedHandler?.();
  }
  let payload;
  try { payload = await response.json(); } catch { throw { code: 'invalid_response', message: 'The server returned an invalid response.' }; }
  if (!response.ok || payload.error) {
    if (payload.error && typeof payload.error === 'object') throw payload.error;
    throw { code: response.ok ? 'request_failed' : 'request_failed', message: payload.error || 'The request failed.' };
  }
  return payload;
}

export function checkHealth() { return request('/api/health'); }
export function listItems(section) { return request(`/api/items?section=${encodeURIComponent(section)}`); }
export function listToday() { return request('/api/today'); }
export function sync(source) {
  const path = source === 'googleCalendar' ? 'google-calendar' : source;
  return request(`/api/sync/${path}`, { method: 'POST' });
}
export function updateItem(id, patch) {
  return request(`/api/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export function createItem(item) {
  return request('/api/items', { method: 'POST', body: JSON.stringify(item) });
}
export function deleteItem(id) {
  return request(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function setToday(id, included) {
  return request(`/api/items/${encodeURIComponent(id)}/today`, { method: 'POST', body: JSON.stringify({ included }) });
}
export function reorderItems(scope, orderedIds) {
  return request('/api/reorder', { method: 'POST', body: JSON.stringify({ scope, orderedIds }) });
}
