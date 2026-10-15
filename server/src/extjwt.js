import { createHmac, timingSafeEqual } from 'node:crypto';

// Twitch extension JWTs are HS256-signed with the base64-encoded extension secret.

function sign(data, secretB64) {
  return createHmac('sha256', Buffer.from(secretB64, 'base64')).update(data).digest('base64url');
}

export function signExtJwt(payload, secretB64) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.${sign(`${header}.${body}`, secretB64)}`;
}

/** Returns the payload, or null if the token is malformed, forged or expired. */
export function verifyExtJwt(token, secretB64, nowMs = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  try {
    if (JSON.parse(Buffer.from(header, 'base64url')).alg !== 'HS256') return null;
    const expected = Buffer.from(sign(`${header}.${body}`, secretB64));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url'));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}
