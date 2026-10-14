import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { serverSecurityOptionsFromEnvironment } from '../server/env.js';

describe('CORS', () => {
  it('allows only the configured origin and approved preflight methods and headers', async () => {
    const pool = { query: async () => { throw new Error('database must not be queried'); } };
    const server = createServer(createApp({
      pool, auth: { username: 'u', password: 'p' }, commit: 'c'.repeat(40), frontendOrigin: 'https://frontend.example.test',
    }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const allowed = await fetch(`${baseUrl}/api/health`, { headers: { origin: 'https://frontend.example.test' } });
      expect(allowed.status).toBe(401);
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://frontend.example.test');
      expect(allowed.headers.get('vary')).toContain('Origin');
      expect(allowed.headers.get('access-control-allow-methods')).toContain('GET');
      expect(allowed.headers.get('access-control-allow-headers')).toContain('Authorization');

      const rejected = await fetch(`${baseUrl}/api/health`, { headers: { origin: 'https://attacker.example.test' } });
      expect(rejected.status).toBe(403);
      expect(rejected.headers.get('access-control-allow-origin')).toBeNull();

      const preflight = await fetch(`${baseUrl}/api/items`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://frontend.example.test',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, authorization',
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('https://frontend.example.test');

      const invalid = await fetch(`${baseUrl}/api/items`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://frontend.example.test',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'x-secret',
        },
      });
      expect(invalid.status).toBe(403);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('still requires authentication when Origin is absent', async () => {
    const server = createServer(createApp({ auth: { username: 'u', password: 'p' }, commit: 'd'.repeat(40) }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
      expect(response.status).toBe(401);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(response.headers.get('vary')).toContain('Origin');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('uses the exact local Vite origin for POST preflight by default', async () => {
    const { frontendOrigin } = serverSecurityOptionsFromEnvironment({ NODE_ENV: 'development' });
    const pool = { query: async () => { throw new Error('preflight must not access the database'); } };
    const server = createServer(createApp({
      pool, auth: { username: 'u', password: 'p' }, commit: 'f'.repeat(40), frontendOrigin,
    }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/items`, {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, authorization',
        },
      });
      expect(frontendOrigin).toBe('http://localhost:5173');
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
