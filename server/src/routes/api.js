import express from 'express';

// Endpoints for the viewer web app (PWA).
export function apiRouter({ config, service, push, sessions }) {
  const router = express.Router();

  const requireUser = (req, res, next) => {
    req.user = sessions.get(req);
    if (!req.user) return res.status(401).json({ error: 'login_required' });
    next();
  };

  router.get('/me', (req, res) => {
    const user = sessions.get(req);
    res.json({
      user: user ? { id: user.uid, login: user.login, name: user.name } : null,
      wins: user ? service.winsFor(user.uid) : [],
      push: { enabled: push.enabled, publicKey: push.publicKey },
      channel: config.broadcasterLogin,
    });
  });

  router.post('/push/subscribe', (req, res) => {
    push.subscribe(req.body?.subscription, sessions.get(req)?.uid ?? null);
    res.json({ ok: true });
  });

  router.post('/push/unsubscribe', (req, res) => {
    push.unsubscribe(req.body?.endpoint);
    res.json({ ok: true });
  });

  router.post('/wins/:id/contact', requireUser, (req, res) => {
    service.setContact(Number(req.params.id), req.user.uid, req.body?.contact);
    res.json({ ok: true });
  });

  router.delete('/me', requireUser, (req, res) => {
    service.forgetUser(req.user.uid);
    sessions.clear(res);
    res.json({ ok: true });
  });

  return router;
}
