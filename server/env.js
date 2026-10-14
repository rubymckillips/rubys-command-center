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
  const oauth = {
    clientId:environment.GITHUB_CLIENT_ID,clientSecret:environment.GITHUB_CLIENT_SECRET,
    redirectUri:environment.GITHUB_REDIRECT_URI,ownerGithubId:environment.OWNER_GITHUB_ID,
    production:environment.NODE_ENV==='production',
  };

  if (environment.NODE_ENV === 'production') {
    if (!oauth.clientId || !oauth.clientSecret || !/^\d+$/.test(oauth.ownerGithubId??'')) {
      throw startupConfigurationError('config_auth', 'CONFIG_AUTH_REQUIRED', 'GitHub client ID, client secret, and numeric OWNER_GITHUB_ID are required');
    }
    if (!commit || !/^(?:[\da-f]{40}|[\da-f]{64})$/i.test(commit)) {
      throw startupConfigurationError('config_version', 'CONFIG_VERSION_REQUIRED', 'A full RENDER_GIT_COMMIT is required in production');
    }
    if (!frontendOrigin) throw startupConfigurationError('config_origin', 'CONFIG_ORIGIN_REQUIRED', 'FRONTEND_ORIGIN is required in production');
  }
  if (frontendOrigin && !isHttpOrigin(frontendOrigin)) {
    throw startupConfigurationError('config_origin', 'CONFIG_ORIGIN_INVALID', 'FRONTEND_ORIGIN must be an HTTP or HTTPS origin');
  }
  const useOAuth=environment.NODE_ENV==='production'||Boolean(oauth.clientId);
  if(useOAuth){
    let callback;
    try{callback=new URL(oauth.redirectUri);}catch{throw startupConfigurationError('config_auth','CONFIG_AUTH_REQUIRED','GitHub callback URL is required');}
    if(!oauth.clientSecret||!/^\d+$/.test(oauth.ownerGithubId??'')||callback.origin!==frontendOrigin||callback.pathname!=='/api/auth/github/callback'||callback.search||callback.hash
      ||(oauth.production&&callback.protocol!=='https:')){
      throw startupConfigurationError('config_auth','CONFIG_AUTH_REQUIRED','GitHub callback URL must match the frontend origin and /api/auth/github/callback');
    }
  }

  return { auth:useOAuth?undefined:auth, oauth:useOAuth?oauth:undefined, frontendOrigin, commit };
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
