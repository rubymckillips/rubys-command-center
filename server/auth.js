import { createHash, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';

const digest = (value) => createHash('sha256').update(value, 'utf8').digest();
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function isAuthorized(header, { username, password } = {}) {
  if (typeof username !== 'string' || !username || username.includes(':')
    || typeof password !== 'string' || !password || typeof header !== 'string') return false;

  const match = header.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return false;
  const encoded = match[1];
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.toString('base64') !== encoded) return false;

  let credentials;
  try {
    credentials = utf8.decode(decoded);
  } catch {
    return false;
  }
  const separator = credentials.indexOf(':');
  if (separator <= 0) return false;
  const candidateUsername = credentials.slice(0, separator);
  const candidatePassword = credentials.slice(separator + 1);
  return timingSafeEqual(digest(`${candidateUsername}:${candidatePassword}`), digest(`${username}:${password}`));
}
