import express from 'express';
import { verifyExtJwt } from '../extjwt.js';

// Endpoints called by the Twitch extension panel. Auth is the extension JWT Twitch
// hands to the panel (Authorization: Bearer ...), so CORS can stay open.
export function extRouter({ config, service }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '600',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  router.use((req, res, next) => {
    const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
    const payload = verifyExtJwt(token, config.extension.secret);
    if (!payload) return res.status(401).json({ error: 'invalid_token' });
    if (payload.channel_id !== config.broadcasterId) return res.status(403).json({ error: 'wrong_channel' });
    req.ext = { opaqueId: payload.opaque_user_id, userId: payload.user_id || null };
    next();
  });

  router.get('/state', (req, res) => {
    res.json(service.viewerState(req.ext.opaqueId));
  });

  router.post('/heartbeat', (req, res) => {
    const { slot } = service.heartbeat(req.ext.opaqueId);
    res.json({ slot, state: service.viewerState(req.ext.opaqueId) });
  });

  router.post('/join', async (req, res) => {
    await service.join(req.ext);
    res.json(service.viewerState(req.ext.opaqueId));
  });

  router.post('/claim', (req, res) => {
    service.claim(req.ext.opaqueId);
    res.json(service.viewerState(req.ext.opaqueId));
  });

  return router;
}
