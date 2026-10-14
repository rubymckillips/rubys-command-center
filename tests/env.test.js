import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvironment, serverOptionsFromEnvironment, serverSecurityOptionsFromEnvironment } from '../server/env.js';
import { startServer, startupDiagnostic } from '../server/index.js';

describe('local environment setup', () => {
  const temporaryDirectories = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('loads local feed and server settings without replacing explicit environment overrides', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ps2-env-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, '.env');
    await writeFile(filePath, [
      'PORT=3000',
      'DATABASE_URL=postgresql://localhost/from-dotenv',
      'CANVAS_ICAL_URL=https://canvas.example.test/private',
      'GOOGLE_CALENDAR_ICAL_URL=https://calendar.example.test/private',
    ].join('\n'));
    const environment = { PORT: '4100' };

    loadEnvironment({ filePath, environment });

    expect(environment).toMatchObject({
      PORT: '4100', DATABASE_URL: 'postgresql://localhost/from-dotenv',
      CANVAS_ICAL_URL: 'https://canvas.example.test/private',
      GOOGLE_CALENDAR_ICAL_URL: 'https://calendar.example.test/private',
    });
    expect(serverOptionsFromEnvironment(environment)).toEqual({ port: 4100, databaseUrl: 'postgresql://localhost/from-dotenv' });
  });

  it('fails closed on incomplete production authentication or commit before opening a database', async () => {
    await expect(startServer({ environment: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://invalid' } }))
      .rejects.toThrow(/BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are required/);
    await expect(startServer({ environment: {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://invalid', BASIC_AUTH_USERNAME: 'deploy',
      BASIC_AUTH_PASSWORD: 'secret', FRONTEND_ORIGIN: 'https://frontend.example.test',
    } })).rejects.toThrow(/full RENDER_GIT_COMMIT/);
    expect(() => serverSecurityOptionsFromEnvironment({
      NODE_ENV: 'production', BASIC_AUTH_USERNAME: 'deploy', BASIC_AUTH_PASSWORD: 'secret', FRONTEND_ORIGIN: 'https://frontend.example.test',
    })).toThrow(/full RENDER_GIT_COMMIT/);
    expect(() => serverSecurityOptionsFromEnvironment({
      NODE_ENV: 'production', BASIC_AUTH_USERNAME: 'bad:name', BASIC_AUTH_PASSWORD: 'secret',
      FRONTEND_ORIGIN: 'https://frontend.example.test', RENDER_GIT_COMMIT: 'f'.repeat(40),
    })).toThrow(/BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are required/);
    expect(serverSecurityOptionsFromEnvironment({
      NODE_ENV: 'production', BASIC_AUTH_USERNAME: 'deploy', BASIC_AUTH_PASSWORD: 'secret',
      FRONTEND_ORIGIN: 'https://frontend.example.test', RENDER_GIT_COMMIT: 'f'.repeat(40),
    })).toMatchObject({ auth: { username: 'deploy', password: 'secret' }, commit: 'f'.repeat(40) });
    await expect(startServer({ environment: {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://invalid', BASIC_AUTH_USERNAME: 'deploy',
      BASIC_AUTH_PASSWORD: 'secret', RENDER_GIT_COMMIT: 'f'.repeat(40),
    } })).rejects.toThrow(/FRONTEND_ORIGIN is required/);
    expect(serverSecurityOptionsFromEnvironment({ NODE_ENV: 'development' }).frontendOrigin).toBe('http://localhost:5173');
    expect(() => serverSecurityOptionsFromEnvironment({ FRONTEND_ORIGIN: 'https://frontend.example.test/path' }))
      .toThrow(/must be an HTTP or HTTPS origin/);
  });

  it('classifies missing production authentication and redacts unexpected startup error details', async () => {
    const productionAuthError = await startServer({ environment: {
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://secret-host/private-db',
    } }).catch((error) => error);
    expect(startupDiagnostic(productionAuthError)).toEqual({
      event: 'startup_failure', stage: 'config_auth', code: 'CONFIG_AUTH_REQUIRED',
    });

    const injected = new Error('password=sentinel-password url=postgresql://sentinel-host/sentinel-db');
    injected.stack = 'sentinel-stack';
    injected.code = 'ECONNREFUSED';
    const serialized = JSON.stringify(startupDiagnostic(injected, 'database_connect'));
    expect(serialized).toBe(JSON.stringify({
      event: 'startup_failure', stage: 'database_connect', code: 'NODE_CONNECTION_REFUSED',
    }));
    expect(serialized).not.toContain('sentinel');
    expect(serialized).not.toContain('postgresql://');
  });
});
