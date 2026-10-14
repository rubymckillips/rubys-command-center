import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';

describe('public version endpoint', () => {
  it('reports the injected full commit without authentication and disables caching', async () => {
    const commit = '0123456789abcdef'.repeat(2) + '01234567';
    const server = createServer(createApp({ commit, auth: { username: 'u', password: 'p' } }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/version`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ commit });
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('keeps non-API frontend paths private and unavailable from the backend', async () => {
    const server = createServer(createApp({ commit: 'e'.repeat(40), auth: { username: 'u', password: 'p' } }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      expect((await fetch(base)).status).toBe(401);
      const authorized = await fetch(base, { headers: { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` } });
      expect(authorized.status).toBe(404);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
