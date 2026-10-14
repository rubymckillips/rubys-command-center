import { afterEach, describe, expect, it, vi } from 'vitest';

const credentials = { username: 'élève', password: 'sëcret' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadApi(baseUrl = '') {
  vi.stubEnv('VITE_API_BASE_URL', baseUrl);
  return import('../client/src/api.js');
}

describe('client API authentication and origin', () => {
  it('joins the configured backend origin to existing API routes and adds UTF-8 Basic auth', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetch);
    const api = await loadApi('https://api.example.test///');

    api.setCredentials(credentials.username, credentials.password);
    await api.listItems('job applications');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/items?section=job%20applications');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64')}`);
  });

  it('removes the authorization header after credentials are cleared', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetch);
    const api = await loadApi();

    api.setCredentials(credentials.username, credentials.password);
    api.clearCredentials();
    await api.listToday();

    expect(fetch.mock.calls[0][0]).toBe('/api/today');
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('authorization');
    expect(api.authorizationHeader()).toBeUndefined();
  });

  it('clears credentials and notifies the registered handler on a 401 without exposing them in the URL or storage', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { code: 'unauthorized', message: 'Authentication required.' } }) });
    vi.stubGlobal('fetch', fetch);
    const api = await loadApi('https://api.example.test');
    const unauthorized = vi.fn();
    api.setUnauthorizedHandler(unauthorized);
    api.setCredentials(credentials.username, credentials.password);
    const localStorage = { setItem: vi.fn() };
    const sessionStorage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);

    await expect(api.checkHealth()).rejects.toMatchObject({ code: 'unauthorized' });

    expect(fetch.mock.calls[0][0]).toBe('https://api.example.test/api/health');
    expect(fetch.mock.calls[0][0]).not.toContain(credentials.username);
    expect(fetch.mock.calls[0][0]).not.toContain(credentials.password);
    expect(unauthorized).toHaveBeenCalledOnce();
    expect(api.authorizationHeader()).toBeUndefined();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('ignores a delayed 401 from an older generation after the same credentials are entered again', async () => {
    let resolveFetch;
    const fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const api = await loadApi();
    const unauthorized = vi.fn();
    api.setUnauthorizedHandler(unauthorized);

    api.setCredentials(credentials.username, credentials.password);
    const oldRequest = api.checkHealth();
    const oldHeader = fetch.mock.calls[0][1].headers.Authorization;

    api.clearCredentials();
    api.setCredentials(credentials.username, credentials.password);
    const newGeneration = api.credentialGeneration();
    resolveFetch({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'unauthorized', message: 'Authentication required.' } }),
    });

    await expect(oldRequest).rejects.toMatchObject({ code: 'unauthorized' });

    expect(api.credentialGeneration()).toBe(newGeneration);
    expect(api.authorizationHeader()).toBe(oldHeader);
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
