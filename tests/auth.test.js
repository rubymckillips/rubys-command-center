import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { isAuthorized } from '../server/auth.js';
import { openTestDatabase } from './postgres.js';

const auth = { username: 'test-user', password: 'test-password:with-colon' };
const validHeader = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;

describe('Basic authentication', () => {
  it('validates strict Basic credentials while allowing colons in passwords', () => {
    expect(isAuthorized(validHeader, auth)).toBe(true);
    expect(isAuthorized(`bAsIc ${validHeader.slice(6)}`, auth)).toBe(true);
    for (const header of [undefined, 'Bearer token', 'Basic', 'Basic !!!', 'Basic YWJj', 'Basic /w==']) {
      expect(isAuthorized(header, auth)).toBe(false);
    }
    expect(isAuthorized(`Basic ${Buffer.from('wrong:test-password:with-colon').toString('base64')}`, auth)).toBe(false);
  });

  it('protects every API route except version and protocol preflight', async () => {
    const database = await openTestDatabase();
    const server = createServer(createApp({ pool: database.pool, auth, commit: 'a'.repeat(40), frontendOrigin: 'https://frontend.example.test' }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const [method, path, body] of [
        ['GET', '/api/health'], ['GET', '/api/items?section=tasks'], ['GET', '/api/today'], ['GET', '/api/activity'],
        ['POST', '/api/items', '{}'], ['PATCH', '/api/items/id', '{}'], ['DELETE', '/api/items/id'],
        ['POST', '/api/items/id/today', '{}'], ['POST', '/api/reorder', '{}'],
        ['POST', '/api/sync/canvas'], ['POST', '/api/sync/google-calendar'], ['GET', '/api/unknown'],
      ]) {
        for (const authorization of [undefined, 'Basic !!!', `Basic ${Buffer.from('bad:credentials').toString('base64')}`]) {
          const response = await fetch(`${baseUrl}${path}`, {
            method, headers: { ...(authorization ? { authorization } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body,
          });
          expect(response.status, `${method} ${path}`).toBe(401);
          expect(response.headers.get('www-authenticate')).toBe('Basic realm="PS3", charset="UTF-8"');
          expect(response.headers.get('cache-control')).toBe('no-store');
        }
      }
      const version = await fetch(`${baseUrl}/api/version`);
      expect(version.status).toBe(200);
      expect(await version.json()).toEqual({ commit: 'a'.repeat(40) });

      const authorized = await fetch(`${baseUrl}/api/health`, { headers: { authorization: validHeader } });
      expect(authorized.status).toBe(200);

      const items = await fetch(`${baseUrl}/api/items?section=tasks`, { headers: { authorization: validHeader } });
      expect(items.status).toBe(200);
      expect(items.headers.get('cache-control')).toBe('no-store');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await database.close();
    }
  });

  it('logs only request metadata and returns generic unexpected errors', async () => {
    const calls = [];
    const sentinel = 'sentinel-secret-should-never-appear';
    const authHeader = `Basic ${Buffer.from(`test-user:${sentinel}`).toString('base64')}`;
    const server = createServer(createApp({
      pool: { query: async () => { throw new Error(sentinel); } },
      auth: { username: 'test-user', password: sentinel }, commit: 'b'.repeat(40),
      logger: (entry) => calls.push(entry),
    }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/items?section=${sentinel}`, {
        headers: { authorization: authHeader },
      });
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).not.toContain(sentinel);
      expect(text).toContain('Unexpected server error');
      await new Promise((resolve) => setImmediate(resolve));
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/items', status: 500 });
      expect(JSON.stringify(calls)).not.toContain(sentinel);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
