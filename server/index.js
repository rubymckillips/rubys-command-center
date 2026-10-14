import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { syncCanvas } from './connectors/canvas.js';
import { syncGoogleCalendar } from './connectors/google-calendar.js';
import { openDatabase } from './db.js';
import { loadEnvironment, serverOptionsFromEnvironment, serverSecurityOptionsFromEnvironment } from './env.js';
import { migrate } from './migrate.js';
import { seedLocalItems } from './seed.js';
import { createIdentityRepository } from './repositories/identity.js';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvironment({ filePath: path.join(appDirectory, '.env') });

export async function startServer({ port, databaseUrl, databaseOptions, environment = process.env, seedLocal = false, auth, frontendOrigin, commit } = {}) {
  const configured = serverOptionsFromEnvironment(environment);
  const security = serverSecurityOptionsFromEnvironment(environment);
  const serverAuth = auth ?? security.auth;
  const allowedFrontendOrigin = frontendOrigin ?? security.frontendOrigin;
  let deployedCommit = commit ?? security.commit;
  if (!deployedCommit) {
    try { deployedCommit = readLocalCommit(); }
    catch { throw startupFailure('config_version', 'CONFIG_VERSION_UNAVAILABLE'); }
  }
  const listeningPort = port ?? configured.port;
  const connectionString = databaseUrl ?? configured.databaseUrl;
  if (!connectionString) throw startupFailure('database_connect', 'DATABASE_URL_REQUIRED');
  const database = await startupStep('database_connect', () => openDatabase(connectionString, databaseOptions));
  try {
    await startupStep('migrate', () => migrate(database.pool));
    if(security.oauth)await startupStep('migrate',()=>createIdentityRepository(database.pool,security.oauth.ownerGithubId).ensureOwner());
    if (seedLocal && environment.NODE_ENV !== 'production') await startupStep('migrate', () => seedLocalItems(database.pool));
  } catch (error) {
    await database.close();
    throw error;
  }

  const allowFeeds = environment.NODE_ENV !== 'production';
  const connectors = {
    canvas: ({ itemsRepository }) => syncCanvas({
      url: allowFeeds ? environment.CANVAS_ICAL_URL : undefined,
      fetchImpl: fetch,
      itemsRepository,
    }),
    googleCalendar: ({ itemsRepository }) => syncGoogleCalendar({
      url: allowFeeds ? environment.GOOGLE_CALENDAR_ICAL_URL : undefined,
      fetchImpl: fetch,
      itemsRepository,
    }),
  };
  const server = createServer(createApp({
    pool: database.pool, connectors, auth: security.oauth?undefined:serverAuth, oauth:security.oauth, frontendOrigin: allowedFrontendOrigin, commit: deployedCommit,
  }));
  let closePromise;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listeningPort, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const activePort = typeof address === 'object' && address ? address.port : listeningPort;
      console.log(`PS3 web app listening on http://localhost:${activePort}`);
      resolve();
    });
  }).catch(async (error) => {
    await database.close();
    throw diagnosticError(error, 'listen');
  });

  return {
    server,
    close: () => {
      if (closePromise) return closePromise;
      closePromise = new Promise((resolve, reject) => server.close((error) => {
        database.close().then(() => error ? reject(error) : resolve(), reject);
      }));
      return closePromise;
    },
  };
}

const safeNodeCodes = new Map([
  ['ECONNREFUSED', 'NODE_CONNECTION_REFUSED'],
  ['ECONNRESET', 'NODE_CONNECTION_RESET'],
  ['ETIMEDOUT', 'NODE_CONNECTION_TIMEOUT'],
  ['ENOTFOUND', 'NODE_HOST_NOT_FOUND'],
  ['EAI_AGAIN', 'NODE_DNS_TEMPORARY_FAILURE'],
  ['EHOSTUNREACH', 'NODE_HOST_UNREACHABLE'],
  ['ENETUNREACH', 'NODE_NETWORK_UNREACHABLE'],
  ['EADDRINUSE', 'NODE_ADDRESS_IN_USE'],
  ['EACCES', 'NODE_PERMISSION_DENIED'],
  ['CERT_HAS_EXPIRED', 'TLS_CERTIFICATE_EXPIRED'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'TLS_CERTIFICATE_NAME_INVALID'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS_CERTIFICATE_UNTRUSTED'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'TLS_CERTIFICATE_SELF_SIGNED'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS_CERTIFICATE_SELF_SIGNED'],
]);
const safeStartupCodes = new Set([
  'CONFIG_AUTH_REQUIRED', 'CONFIG_VERSION_REQUIRED', 'CONFIG_ORIGIN_REQUIRED', 'CONFIG_ORIGIN_INVALID',
  'CONFIG_VERSION_UNAVAILABLE', 'DATABASE_URL_REQUIRED',
]);

function startupFailure(stage, code) {
  const error = new Error('PS3 startup failed');
  error.startupStage = stage;
  error.startupCode = code;
  return error;
}

async function startupStep(stage, operation) {
  try { return await operation(); }
  catch (error) { throw diagnosticError(error, stage); }
}

function diagnosticError(error, fallbackStage) {
  const knownStages = new Set(['config_auth', 'config_origin', 'config_version', 'database_connect', 'migrate', 'listen']);
  const stage = knownStages.has(error?.startupStage) ? error.startupStage : fallbackStage;
  if (safeStartupCodes.has(error?.startupCode)) {
    const tagged = startupFailure(stage, error.startupCode);
    return tagged;
  }
  if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return startupFailure(stage, `PG_${error.code}`);
  }
  if (safeNodeCodes.has(error?.code)) {
    return startupFailure(stage, safeNodeCodes.get(error.code));
  }
  return startupFailure('UNKNOWN', 'STARTUP_UNKNOWN');
}

export function startupDiagnostic(error, fallbackStage = 'UNKNOWN') {
  const safe = diagnosticError(error, fallbackStage);
  return { event: 'startup_failure', stage: safe.startupStage, code: safe.startupCode };
}

function readLocalCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('Could not determine the local Git commit');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then((runningServer) => {
    const shutdown = () => runningServer.close().catch(() => {
      console.error('Could not shut down server cleanly.');
      process.exitCode = 1;
    });
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((error) => {
    console.error(JSON.stringify(startupDiagnostic(error)));
    process.exitCode = 1;
  });
}
