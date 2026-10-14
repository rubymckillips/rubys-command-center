import { existsSync, readFileSync } from 'node:fs';

export function loadEnvironment({ filePath, environment = process.env } = {}) {
  if (!filePath || !existsSync(filePath)) return environment;

  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());
    if (key && environment[key] === undefined) environment[key] = value;
  }
  return environment;
}

export function serverOptionsFromEnvironment(environment = process.env) {
  const configuredPort = Number.parseInt(environment.PORT, 10);
  return {
    port: Number.isInteger(configuredPort) && configuredPort >= 0 ? configuredPort : 3000,
    databaseUrl: environment.DATABASE_URL,
  };
}

export function serverSecurityOptionsFromEnvironment(environment = process.env) {
  const auth = {
    username: environment.BASIC_AUTH_USERNAME,
    password: environment.BASIC_AUTH_PASSWORD,
  };
  const frontendOrigin = environment.FRONTEND_ORIGIN || (environment.NODE_ENV === 'production' ? undefined : 'http://localhost:5173');
  const commit = environment.RENDER_GIT_COMMIT;

  if (environment.NODE_ENV === 'production') {
    if (!auth.username || auth.username.includes(':') || !auth.password) {
      throw startupConfigurationError('config_auth', 'CONFIG_AUTH_REQUIRED', 'BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are required in production');
    }
    if (!commit || !/^(?:[\da-f]{40}|[\da-f]{64})$/i.test(commit)) {
      throw startupConfigurationError('config_version', 'CONFIG_VERSION_REQUIRED', 'A full RENDER_GIT_COMMIT is required in production');
    }
    if (!frontendOrigin) throw startupConfigurationError('config_origin', 'CONFIG_ORIGIN_REQUIRED', 'FRONTEND_ORIGIN is required in production');
  }
  if (frontendOrigin && !isHttpOrigin(frontendOrigin)) {
    throw startupConfigurationError('config_origin', 'CONFIG_ORIGIN_INVALID', 'FRONTEND_ORIGIN must be an HTTP or HTTPS origin');
  }

  return { auth, frontendOrigin, commit };
}

function startupConfigurationError(stage, code, message) {
  const error = new Error(message);
  error.startupStage = stage;
  error.startupCode = code;
  return error;
}

function isHttpOrigin(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === value;
  } catch {
    return false;
  }
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}
