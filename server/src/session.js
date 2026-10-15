import { createHmac, timingSafeEqual } from 'node:crypto';

// Minimal signed-cookie sessions: base64url(JSON).hmac

const COOKIE = 'sid';
const MAX_AGE_SEC = 30 * 24 * 3600;

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function mac(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function encodeSigned(data, secret) {
  const value = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${value}.${mac(value, secret)}`;
}

export function decodeSigned(raw, secret) {
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const value = raw.slice(0, i);
  const expected = Buffer.from(mac(value, secret));
  const actual = Buffer.from(raw.slice(i + 1));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64url'));
  } catch {
    return null;
  }
}

export function cookieOptions(secure, maxAgeSec = MAX_AGE_SEC) {
  return { httpOnly: true, sameSite: 'lax', secure, maxAge: maxAgeSec * 1000, path: '/' };
}

export function sessions({ secret, secure }) {
  return {
    get(req) {
      const s = decodeSigned(parseCookies(req)[COOKIE], secret);
      return s && s.exp > Date.now() ? s : null;
    },
    set(res, data) {
      res.cookie(COOKIE, encodeSigned({ ...data, exp: Date.now() + MAX_AGE_SEC * 1000 }, secret), cookieOptions(secure));
    },
    clear(res) {
      res.clearCookie(COOKIE, { path: '/' });
    },
  };
}
