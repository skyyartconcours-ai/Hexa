import express from 'express';
import { missingConfig } from '../config.js';

// Streamer dashboard API. Only the broadcaster's own Twitch account gets in.
export function adminRouter({ config, service, twitch, push, sessions }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const s = sessions.get(req);
    if (!s?.admin || s.uid !== config.broadcasterId) return res.status(401).json({ error: 'admin_required' });
    next();
  });

  router.get('/overview', (req, res) => {
    res.json({
      ...service.adminOverview(),
      push: { enabled: push.enabled, subscribers: push.count() },
      broadcasterToken: twitch.hasBroadcasterToken(),
      missingConfig: missingConfig(),
      publicUrl: config.publicUrl,
      serverNow: Date.now(),
    });
  });

  router.post('/settings', (req, res) => {
    res.json(service.updateSettings(req.body ?? {}));
  });

  router.post('/giveaways', (req, res) => {
    res.json(service.start(req.body ?? {}));
  });

  router.post('/giveaways/:id/draw', async (req, res) => {
    const id = Number(req.params.id);
    const g = service.get(id);
    const pick = g?.status === 'claiming' ? await service.redraw(id) : await service.draw(id, { closeIfEmpty: false });
    res.json({ pick: pick ? { login: pick.login, display_name: pick.display_name, tickets: pick.weight } : null });
  });

  router.post('/giveaways/:id/cancel', (req, res) => {
    service.cancel(Number(req.params.id));
    res.json({ ok: true });
  });

  router.post('/winners/:id/delivered', (req, res) => {
    service.setDelivered(Number(req.params.id), Boolean(req.body?.delivered));
    res.json({ ok: true });
  });

  router.get('/eventsub', async (req, res) => {
    res.json(await twitch.listEventSubs());
  });

  router.post('/eventsub', async (req, res) => {
    res.json(await twitch.ensureStreamOnlineSub());
  });

  router.post('/push/test', async (req, res) => {
    res.json(await push.sendAll({
      title: '🔔 Test de notification',
      body: 'Si tu vois ça, les notifications de live fonctionnent !',
      url: `https://twitch.tv/${config.broadcasterLogin}`,
    }));
  });

  return router;
}
