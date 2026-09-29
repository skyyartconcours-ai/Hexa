import { config } from '../config.js';
import { readToken, writeToken } from '../db.js';
import { log } from '../log.js';

const TOKEN_KEY = 'twitch_oauth';

/** Echec d'authentification Twitch avec son statut : 400/401 = definitif, le reste = passager. */
export class TwitchAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface StoredToken {
  accessToken: string;
  refreshToken: string;
  /** Timestamp epoch ms. */
  expiresAt: number;
  scopes: string[];
}

interface DeviceCodeResponse {
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[] | string;
}

function store(payload: TokenResponse): StoredToken {
  const scopes = Array.isArray(payload.scope) ? payload.scope : String(payload.scope ?? '').split(' ');
  const token: StoredToken = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    // 60 s de marge pour ne jamais utiliser un token qui expire pendant la requete.
    expiresAt: Date.now() + payload.expires_in * 1000 - 60_000,
    scopes: scopes.filter(Boolean),
  };
  writeToken(TOKEN_KEY, token);
  return token;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Device Code Flow : pas de redirect URI, pas de client secret, pas de serveur
 * public a exposer. L'utilisateur ouvre une URL et tape un code. Ideal pour un
 * outil qui tourne sur le PC du streamer.
 *
 * L'app Twitch doit etre declaree en type de client "Public".
 */
export async function loginInteractive(): Promise<StoredToken> {
  const scopes = config.twitch.scopes.join(' ');

  const deviceResponse = await fetch(`${config.twitch.authUrl}/oauth2/device`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.twitch.clientId, scopes }),
  });

  if (!deviceResponse.ok) {
    throw new Error(
      `Demande de device code refusee (${deviceResponse.status}) : ${await deviceResponse.text()}\n` +
        'Verifie que TWITCH_CLIENT_ID est correct et que l\'app est de type "Public".',
    );
  }

  const device = (await deviceResponse.json()) as DeviceCodeResponse;

  console.log('\n────────────────────────────────────────────────');
  console.log('  Autorise Hexa sur ton compte Twitch :');
  console.log(`  1. Ouvre  ${device.verification_uri}`);
  console.log(`  2. Entre le code  ${device.user_code}`);
  console.log('────────────────────────────────────────────────\n');

  const deadline = Date.now() + device.expires_in * 1000;
  let intervalMs = Math.max(device.interval, 1) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const tokenResponse = await fetch(`${config.twitch.authUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.twitch.clientId,
        scopes,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (tokenResponse.ok) {
      const token = store((await tokenResponse.json()) as TokenResponse);
      log.ok('Twitch connecte. Le token est stocke dans data/hexa.db.');
      return token;
    }

    const body = await tokenResponse.text();
    if (body.includes('authorization_pending')) continue;
    if (body.includes('slow_down')) {
      intervalMs += 2000;
      continue;
    }
    throw new Error(`Autorisation echouee : ${body}`);
  }

  throw new Error('Le code a expire avant validation. Relance `npm run login`.');
}

async function refresh(token: StoredToken): Promise<StoredToken> {
  const response = await fetch(`${config.twitch.authUrl}/oauth2/token`, {
    method: 'POST',
    // Sans delai, un refresh pendu (id.twitch.tv qui ne repond pas) bloquait
    // TOUS les appels Twitch 300 s : refreshOnce() partage la meme promesse.
    signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.twitch.clientId,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    }),
  });

  if (!response.ok) {
    // Refresh token a usage unique : un autre process (npm run doctor, backfill)
    // a pu le consommer et ecrire le nouveau dans la base entre-temps.
    const latest = readToken<StoredToken>(TOKEN_KEY);
    if (latest && latest.refreshToken !== token.refreshToken && Date.now() < latest.expiresAt) {
      return latest;
    }
    throw new TwitchAuthError(
      `Refresh du token Twitch impossible (${response.status}). Relance \`npm run login\`.`,
      response.status,
    );
  }

  log.twitch('Token Twitch rafraichi.');
  return store((await response.json()) as TokenResponse);
}

/** Un seul refresh a la fois : le refresh token d'un client Public est a usage unique. */
let inflight: Promise<StoredToken> | null = null;
function refreshOnce(token: StoredToken): Promise<StoredToken> {
  inflight ??= refresh(token).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Retourne un access token valide, en le rafraichissant si besoin (ou si `force`). */
export async function getAccessToken(force = false): Promise<string> {
  const token = readToken<StoredToken>(TOKEN_KEY);
  if (!token) {
    throw new Error('Pas de token Twitch enregistre. Lance `npm run login` d\'abord.');
  }

  const missing = config.twitch.scopes.filter((scope) => !token.scopes.includes(scope));
  if (missing.length) {
    throw new Error(
      `Le token enregistre n'a pas les scopes ${missing.join(', ')}. Relance \`npm run login\`.`,
    );
  }

  if (force || Date.now() >= token.expiresAt) {
    return (await refreshOnce(token)).accessToken;
  }
  return token.accessToken;
}

/**
 * Validation exigee par Twitch au demarrage puis toutes les heures :
 * https://dev.twitch.tv/docs/authentication/validate-tokens/
 * Un 401 declenche un refresh ; si le refresh echoue, l'erreur remonte.
 */
export async function validateToken(): Promise<{ login: string; userId: string; expiresIn: number }> {
  const call = async (token: string) =>
    fetch(`${config.twitch.authUrl}/oauth2/validate`, {
      headers: { authorization: `OAuth ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  let response = await call(await getAccessToken());
  if (response.status === 401) response = await call(await getAccessToken(true));
  if (!response.ok) {
    throw new TwitchAuthError(
      `Token Twitch refuse par /oauth2/validate (${response.status}). Relance \`npm run login\`.`,
      response.status,
    );
  }
  const info = (await response.json()) as { login: string; user_id: string; expires_in: number };
  return { login: info.login, userId: info.user_id, expiresIn: info.expires_in };
}

export function hasStoredToken(): boolean {
  return readToken<StoredToken>(TOKEN_KEY) !== null;
}
