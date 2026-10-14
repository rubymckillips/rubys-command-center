import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { openTestDatabase } from './postgres.js';

const testAuth = { username: 'test-user', password: 'test-password' };
const testAuthorization = `Basic ${Buffer.from(`${testAuth.username}:${testAuth.password}`).toString('base64')}`;

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: testAuthorization, ...options.headers },
  });
  return { response, body: await response.json() };
}

async function inProcessServer() {
  const database = await openTestDatabase();
  const server = createServer(createApp({ pool: database.pool, auth: testAuth, commit: 'a'.repeat(40) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    database,
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function stopInProcessServer({ database, server }) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await database.close();
}

describe('PS2 acceptance requirements', () => {
  const closers = [];
  afterEach(async () => Promise.all(closers.splice(0).map(stopInProcessServer)));

  it('allows users to create, change, use Today, and delete data through the HTTP API', async () => {
    const app = await inProcessServer();
    closers.push(app);

    const created = await requestJson(app.baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({ section: 'tasks', title: 'Plan the week' }),
    });
    expect(created.response.status).toBe(201);

    const changed = await requestJson(app.baseUrl, `/api/items/${created.body.item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Plan the week', notes: 'Start with Monday', completed: true }),
    });
    expect(changed.response.status).toBe(200);
    expect(changed.body.item).toMatchObject({ notes: 'Start with Monday', completed: true });

    const todayAdded = await requestJson(app.baseUrl, `/api/items/${created.body.item.id}/today`, {
      method: 'POST',
      body: JSON.stringify({ included: true }),
    });
    expect(todayAdded.body.item.inToday).toBe(true);
    expect((await requestJson(app.baseUrl, '/api/today')).body.items).toEqual([
      expect.objectContaining({ id: created.body.item.id, title: 'Plan the week' }),
    ]);

    const deleted = await requestJson(app.baseUrl, `/api/items/${created.body.item.id}`, { method: 'DELETE' });
    expect(deleted.response.status).toBe(200);
    expect((await requestJson(app.baseUrl, '/api/items?section=tasks')).body.items).toEqual([]);
    expect((await requestJson(app.baseUrl, '/api/today')).body.items).toEqual([]);
  });
});
