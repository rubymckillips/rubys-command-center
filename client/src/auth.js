let currentAuthorizationHeader;
let currentGeneration = 0;

export function setCredentials(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  currentAuthorizationHeader = `Basic ${encoded}`;
  currentGeneration += 1;
  return currentGeneration;
}

export function clearCredentials() {
  currentAuthorizationHeader = undefined;
  currentGeneration += 1;
}

export function clearCredentialsIfGeneration(generation) {
  if (currentGeneration !== generation) return false;
  clearCredentials();
  return true;
}

export function authorizationHeader() {
  return currentAuthorizationHeader;
}

export function credentialGeneration() {
  return currentGeneration;
}

export function authorizationSnapshot() {
  return { header: currentAuthorizationHeader, generation: currentGeneration };
}
