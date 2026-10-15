import express from 'express';
import { randomBytes } from 'node:crypto';
import { encodeSigned, decodeSigned, parseCookies, cookieOptions } from '../session.js';
import { BROADCASTER_SCOPES } from '../twitch.js';

const STATE_COOKIE = 'oauth_state';

const safeNext = (next, fallback) =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : fallback;

export function authRouter({ config, twitch, sessions, logger }) {
  const router = express.Router();
  const secure = config.publicUrl.startsWith('https://');

  router.get('/login', (req, res) => {
    const asAdmin = req.query.as === 'admin';
    const state = randomBytes(16).toString('hex');
    const next = safeNext(req.query.next, asAdmin ? '/admin/' : '/');
    res.cookie(STATE_COOKIE, encodeSigned({ state, asAdmin, next }, config.sessionSecret), cookieOptions(secure, 600));
    res.redirect(twitch.authorizeUrl({ state, scopes: asAdmin ? BROADCASTER_SCOPES : [] }));
  });

  router.get('/callback', async (req, res) => {
    const saved = decodeSigned(parseCookies(req)[STATE_COOKIE], config.sessionSecret);
    res.clearCookie(STATE_COOKIE, { path: '/' });
    if (!saved || saved.state !== req.query.state || !req.query.code) {
      return res.status(400).send('Connexion expirée ou invalide, réessaie.');
    }
    try {
      const tokens = await twitch.exchangeCode(String(req.query.code));
      const user = await twitch.getUserForToken(tokens.access_token);
      const isBroadcaster = user.id === config.broadcasterId;
      if (saved.asAdmin && !isBroadcaster) {
        return res.status(403).send('Seul le compte Twitch de la chaîne peut accéder au tableau de bord.');
      }
      if (saved.asAdmin) twitch.saveBroadcasterTokens(tokens);
      sessions.set(res, { uid: user.id, login: user.login, name: user.display_name, admin: isBroadcaster && saved.asAdmin });
      res.redirect(saved.next);
    } catch (err) {
      logger.error('OAuth callback failed:', err);
      res.status(502).send('Twitch ne répond pas, réessaie dans un instant.');
    }
  });

  router.post('/logout', (req, res) => {
    sessions.clear(res);
    res.json({ ok: true });
  });

  return router;
}
