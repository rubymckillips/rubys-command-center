import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../server/index.js';
import { openTestDatabase } from './postgres.js';

const testAuthorization = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`;

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: testAuthorization, ...options.headers },
  });
  return { response, body: await response.json() };
}

describe('server restart persistence', () => {
  let database;
  let first;
  let second;

  afterEach(async () => {
    await first?.close();
    await second?.close();
    await database?.close();
    first = undefined;
    second = undefined;
    database = undefined;
  });

  it('keeps an item, its Today placement, and activity after a server restart', async () => {
    database = await openTestDatabase();
    const options = {
      port: 0,
      databaseUrl: database.connectionString,
      databaseOptions: { searchPath: database.schema },
      environment: { NODE_ENV: 'test', BASIC_AUTH_USERNAME: 'test-user', BASIC_AUTH_PASSWORD: 'test-password' },
    };
    first = await startServer(options);
    const firstUrl = `http://127.0.0.1:${first.server.address().port}`;
    const created = await requestJson(firstUrl, '/api/items', {
      method: 'POST', body: JSON.stringify({ section: 'tasks', title: 'Prepare lunches' }),
    });
    expect(created.response.status).toBe(201);
    const included = await requestJson(firstUrl, `/api/items/${created.body.item.id}/today`, {
      method: 'POST', body: JSON.stringify({ included: true }),
    });
    expect(included.response.status).toBe(200);
    await first.close();
    first = undefined;

    second = await startServer(options);
    const secondUrl = `http://127.0.0.1:${second.server.address().port}`;
    const today = await requestJson(secondUrl, '/api/today');
    const activity = await requestJson(secondUrl, '/api/activity');
    expect(today.response.status).toBe(200);
    expect(today.body.items).toEqual([
      expect.objectContaining({ id: created.body.item.id, title: 'Prepare lunches', inToday: true }),
    ]);
    expect(activity.body.events.map(({ action }) => action)).toEqual(['created', 'today-added']);
  });
});
