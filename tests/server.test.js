import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { createActivityRepository } from '../server/repositories/activity.js';
import { createItemsRepository } from '../server/repositories/items.js';
import { openTestDatabase } from './postgres.js';

const testAuth = { username: 'test-user', password: 'test-password' };
const testAuthorization = `Basic ${Buffer.from(`${testAuth.username}:${testAuth.password}`).toString('base64')}`;

describe('Postgres repositories', () => {
  const closers = [];
  afterEach(async () => Promise.all(closers.splice(0).map((close) => close())));

  async function repositories() {
    const database = await openTestDatabase();
    closers.push(database.close);
    const activity = createActivityRepository(database.pool);
    return { items: createItemsRepository(database.pool, activity), activity };
  }

  it('creates normalized local items and records creation', async () => {
    const { items, activity } = await repositories();
    const item = await items.create({ section: 'tasks', title: 'Draft proposal', notes: 'Outline first' });
    expect(item).toMatchObject({ kind: 'local', section: 'tasks', title: 'Draft proposal', completed: false, inToday: false });
    expect((await activity.list()).map(({ action }) => action)).toEqual(['created']);
  });

  it('updates local fields, completion, and records the right actions', async () => {
    const { items, activity } = await repositories();
    const item = await items.create({ section: 'tasks', title: 'Draft proposal' });
    await items.update(item.id, { notes: 'Updated', completed: true });
    expect((await items.list({ section: 'tasks' }))[0]).toMatchObject({ notes: 'Updated', completed: true });
    expect((await activity.list()).map(({ action }) => action)).toEqual(['created', 'completed']);
  });

  it('preserves local fields when source fields are updated', async () => {
    const { items } = await repositories();
    const item = await items.create({
      section: 'academics', title: 'Original', notes: 'Keep me', externalUrl: 'https://local.test',
      completed: true, inToday: true, source: 'canvas', sourceId: 'a-1',
    });
    const other = await items.create({ section: 'academics', title: 'Other' });
    await items.reorder('academics', [other.id, item.id]);
    await items.reorder('today', [item.id]);

    const updated = await items.upsertSource({
      source: 'canvas', source_id: 'a-1', title: 'Updated from Canvas', section: 'calendar',
      due_at: '2026-10-01T12:00:00Z', class_name: 'SI 212',
      notes: 'Connector must not replace this', completed: false, inToday: false,
      position: 99, todayPosition: 99, externalUrl: 'https://connector.test',
    });
    expect(updated).toMatchObject({
      title: 'Updated from Canvas', section: 'academics', notes: 'Keep me',
      externalUrl: 'https://local.test', completed: true, inToday: true,
      position: 1, todayPosition: 0, sourceId: 'a-1',
    });
    expect((await items.list({ section: 'academics' })).map((entry) => [entry.id, entry.position])).toEqual([
      [other.id, 0], [item.id, 1],
    ]);
    expect(await items.list({ section: 'calendar' })).toEqual([]);
  });

  it('adds and removes Today membership without deleting the item', async () => {
    const { items, activity } = await repositories();
    const item = await items.create({ section: 'tasks', title: 'Today item' });
    await items.setToday(item.id, true);
    expect(await items.list({ todayOnly: true })).toHaveLength(1);
    await items.setToday(item.id, false);
    expect(await items.list({ section: 'tasks' })).toHaveLength(1);
    expect((await activity.list()).map(({ action }) => action)).toEqual(['created', 'today-added', 'today-removed']);
  });

  it('reorders section and Today positions contiguously', async () => {
    const { items, activity } = await repositories();
    const first = await items.create({ section: 'tasks', title: 'First' });
    const second = await items.create({ section: 'tasks', title: 'Second' });
    const third = await items.create({ section: 'tasks', title: 'Third' });
    await items.setToday(first.id, true);
    await items.setToday(second.id, true);
    await items.reorder('tasks', [third.id, first.id, second.id]);
    await items.reorder('today', [second.id, first.id]);
    expect((await items.list({ section: 'tasks' })).map((item) => [item.id, item.position])).toEqual([
      [third.id, 0], [first.id, 1], [second.id, 2],
    ]);
    expect((await items.list({ todayOnly: true })).map((item) => [item.id, item.todayPosition])).toEqual([
      [second.id, 0], [first.id, 1],
    ]);
    expect((await activity.list()).filter(({ action }) => action === 'reordered')).toHaveLength(5);
  });

  it('rejects duplicate IDs in a reorder and leaves positions unchanged', async () => {
    const { items } = await repositories();
    const first = await items.create({ section: 'tasks', title: 'First' });
    const second = await items.create({ section: 'tasks', title: 'Second' });
    await expect(items.reorder('tasks', [first.id, first.id])).rejects.toThrow(/exactly the items/);
    expect((await items.list({ section: 'tasks' })).map((item) => [item.id, item.position])).toEqual([
      [first.id, 0], [second.id, 1],
    ]);
  });

  it('deletes an item and records deletion', async () => {
    const { items, activity } = await repositories();
    const item = await items.create({ section: 'tasks', title: 'Remove me' });
    expect(await items.remove(item.id)).toMatchObject({ id: item.id });
    expect(await items.list({ section: 'tasks' })).toEqual([]);
    expect((await activity.list()).at(-1).action).toBe('deleted');
  });
});

describe('HTTP API', () => {
  const closers = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function apiServer() {
    const database = await openTestDatabase();
    const server = createServer(createApp({ pool: database.pool, auth: testAuth, commit: 'a'.repeat(40) }));
    await new Promise((resolve) => server.listen(0, resolve));
    closers.push(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    closers.push(database.close);
    return { baseUrl: `http://127.0.0.1:${server.address().port}`, database };
  }

  async function requestJson(baseUrl, pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: testAuthorization, ...options.headers },
    });
    return { response, body: await response.json() };
  }

  it('exercises the item, Today, reorder, and activity endpoints over HTTP', async () => {
    const { baseUrl } = await apiServer();
    const created = await requestJson(baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'local', section: 'academics', title: 'Read chapter 3',
        notes: 'Take notes', dueAt: '2026-10-01T12:00:00Z', externalUrl: 'https://example.test/ch3',
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body.item).toMatchObject({ section: 'academics', title: 'Read chapter 3', inToday: false });

    const second = await requestJson(baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({ section: 'academics', title: 'Submit notes' }),
    });
    expect(second.response.status).toBe(201);

    const listed = await requestJson(baseUrl, '/api/items?section=academics');
    expect(listed.response.status).toBe(200);
    expect(listed.body.items.map(({ id }) => id)).toEqual([created.body.item.id, second.body.item.id]);

    const edited = await requestJson(baseUrl, `/api/items/${created.body.item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'Updated notes', completed: true }),
    });
    expect(edited.response.status).toBe(200);
    expect(edited.body.item).toMatchObject({ notes: 'Updated notes', completed: true });

    const included = await requestJson(baseUrl, `/api/items/${created.body.item.id}/today`, {
      method: 'POST', body: JSON.stringify({ included: true }),
    });
    expect(included.response.status).toBe(200);
    expect(included.body.item.inToday).toBe(true);

    const today = await requestJson(baseUrl, '/api/today');
    expect(today.response.status).toBe(200);
    expect(today.body.items.map(({ id }) => id)).toEqual([created.body.item.id]);

    const reordered = await requestJson(baseUrl, '/api/reorder', {
      method: 'POST',
      body: JSON.stringify({ scope: 'academics', orderedIds: [second.body.item.id, created.body.item.id] }),
    });
    expect(reordered.response.status).toBe(200);
    expect(reordered.body.items.map(({ id }) => id)).toEqual([second.body.item.id, created.body.item.id]);

    const removedFromToday = await requestJson(baseUrl, `/api/items/${created.body.item.id}/today`, {
      method: 'POST', body: JSON.stringify({ included: false }),
    });
    expect(removedFromToday.response.status).toBe(200);
    expect(removedFromToday.body.item.inToday).toBe(false);
    expect((await requestJson(baseUrl, '/api/items?section=academics')).body.items).toHaveLength(2);
    expect((await requestJson(baseUrl, '/api/today')).body.items).toEqual([]);

    const activity = await requestJson(baseUrl, '/api/activity');
    expect(activity.response.status).toBe(200);
    expect(activity.body.events.map(({ action }) => action)).toEqual([
      'created', 'created', 'completed', 'today-added', 'reordered', 'reordered', 'today-removed',
    ]);

    const deleted = await requestJson(baseUrl, `/api/items/${second.body.item.id}`, { method: 'DELETE' });
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.item.id).toBe(second.body.item.id);
    expect((await requestJson(baseUrl, '/api/items?section=academics')).body.items).toHaveLength(1);
  });

  it('uses the public item presentation for Today placement and reordering responses', async () => {
    const { baseUrl } = await apiServer();
    const workout = await requestJson(baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({
        section: 'workouts', title: 'Intervals', notes: 'Bring water', workoutType: 'cardio', plannedFor: '2026-10-02T17:00:00Z',
      }),
    });
    const meal = await requestJson(baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({
        section: 'meals', title: 'Lunch prep', notes: 'Pack containers', mealType: 'lunch', prepNotes: 'Cook rice', checklist: ['Rice', 'Beans'], plannedFor: '2026-10-03T12:00:00Z',
      }),
    });

    const workoutToday = await requestJson(baseUrl, `/api/items/${workout.body.item.id}/today`, {
      method: 'POST', body: JSON.stringify({ included: true }),
    });
    const mealToday = await requestJson(baseUrl, `/api/items/${meal.body.item.id}/today`, {
      method: 'POST', body: JSON.stringify({ included: true }),
    });
    expect(workoutToday.body.item).toMatchObject({
      workoutType: 'cardio', plannedFor: '2026-10-02T17:00:00Z', notes: 'Bring water', inToday: true,
    });
    expect(mealToday.body.item).toMatchObject({
      mealType: 'lunch', prepNotes: 'Cook rice', checklist: ['Rice', 'Beans'], plannedFor: '2026-10-03T12:00:00Z', notes: 'Pack containers', inToday: true,
    });
    expect(workoutToday.body.item.notes).not.toContain('[[cc-plan:');
    expect(mealToday.body.item.notes).not.toContain('[[cc-plan:');

    const reordered = await requestJson(baseUrl, '/api/reorder', {
      method: 'POST', body: JSON.stringify({ scope: 'today', orderedIds: [meal.body.item.id, workout.body.item.id] }),
    });
    expect(reordered.body.items).toEqual([
      expect.objectContaining({ id: meal.body.item.id, mealType: 'lunch', prepNotes: 'Cook rice', checklist: ['Rice', 'Beans'], plannedFor: '2026-10-03T12:00:00Z', notes: 'Pack containers' }),
      expect.objectContaining({ id: workout.body.item.id, workoutType: 'cardio', plannedFor: '2026-10-02T17:00:00Z', notes: 'Bring water' }),
    ]);
    expect(reordered.body.items.every((item) => !item.notes?.includes('[[cc-plan:'))).toBe(true);
  });

  it('returns stable JSON validation and not-found errors', async () => {
    const { baseUrl } = await apiServer();
    const missingSection = await requestJson(baseUrl, '/api/items', {
      method: 'POST', body: JSON.stringify({ title: 'Missing section' }),
    });
    expect(missingSection.response.status).toBe(400);
    expect(missingSection.body.error).toMatchObject({ code: 'invalid_item', message: expect.any(String) });

    const missingTitle = await requestJson(baseUrl, '/api/items', {
      method: 'POST', body: JSON.stringify({ section: 'tasks' }),
    });
    expect(missingTitle.response.status).toBe(400);
    expect(missingTitle.body.error).toMatchObject({ code: 'invalid_item', message: expect.any(String) });

    const malformedReorder = await requestJson(baseUrl, '/api/reorder', {
      method: 'POST', body: JSON.stringify({ scope: 'tasks', orderedIds: 'not-an-array' }),
    });
    expect(malformedReorder.response.status).toBe(400);
    expect(malformedReorder.body.error).toMatchObject({ code: 'invalid_reorder', message: expect.any(String) });

    for (const payload of [
      { section: 42, title: 'Bad section' },
      { section: 'tasks', title: 'Bad notes', notes: false },
      { section: 'tasks', title: 'Bad completed', completed: 'yes' },
      { section: 'tasks', title: 'Bad in today', in_today: 'yes' },
      { section: 'tasks', title: 'Bad due date', dueAt: 42 },
    ]) {
      const malformedFields = await requestJson(baseUrl, '/api/items', {
        method: 'POST', body: JSON.stringify(payload),
      });
      expect(malformedFields.response.status).toBe(400);
      expect(malformedFields.body.error).toMatchObject({ code: 'invalid_item', message: expect.any(String) });
    }

    const malformedToday = await requestJson(baseUrl, '/api/items/unknown/today', {
      method: 'POST', body: JSON.stringify({ included: 'yes' }),
    });
    expect(malformedToday.response.status).toBe(400);
    expect(malformedToday.body.error).toMatchObject({ code: 'invalid_today', message: expect.any(String) });

    const malformedScope = await requestJson(baseUrl, '/api/reorder', {
      method: 'POST', body: JSON.stringify({ scope: 42, orderedIds: ['id'] }),
    });
    expect(malformedScope.response.status).toBe(400);
    expect(malformedScope.body.error).toMatchObject({ code: 'invalid_reorder', message: expect.any(String) });

    const unknown = await requestJson(baseUrl, '/api/items/unknown/today', {
      method: 'POST', body: JSON.stringify({ included: true }),
    });
    expect(unknown.response.status).toBe(404);
    expect(unknown.body.error).toMatchObject({ code: 'not_found', message: expect.any(String) });
  });

  it('archives imported items instead of deleting their source record', async () => {
    const { baseUrl, database } = await apiServer();
    const items = createItemsRepository(database.pool);
    const imported = await items.create({
      kind: 'assignment', section: 'academics', title: 'Imported assignment',
      source: 'canvas', sourceId: 'canvas-1', inToday: true,
    });

    const deleted = await requestJson(baseUrl, `/api/items/${imported.id}`, { method: 'DELETE' });
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.item).toMatchObject({ id: imported.id, archived: true, inToday: false });
    expect((await requestJson(baseUrl, '/api/items?section=academics')).body.items).toEqual([]);
    expect((await requestJson(baseUrl, '/api/today')).body.items).toEqual([]);
    expect((await database.pool.query('SELECT id, archived FROM items WHERE id = $1', [imported.id])).rows[0]).toMatchObject({
      id: imported.id, archived: true,
    });
    expect((await requestJson(baseUrl, '/api/activity')).body.events.at(-1)).toMatchObject({
      itemId: imported.id, action: 'archived', section: 'academics',
    });
  });
});
