import express from 'express';
import { fileURLToPath } from 'node:url';
import { GiveawayError } from './giveaway.js';
import { eventSubHandler } from './eventsub.js';
import { extRouter } from './routes/ext.js';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

// Cookie-authenticated writes must carry this header. Browsers can't add it cross-site
// without a CORS preflight we never approve, which is what blocks CSRF.
function requireFetchHeader(req, res, next) {
  if (req.method === 'GET' || req.get('X-Requested-With') === 'fetch') return next();
  res.status(403).json({ error: 'csrf' });
}

export function createApp({ config, db, service, twitch, push, sessions, onStreamOnline, logger = console }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.post('/eventsub', express.raw({ type: 'application/json', limit: '256kb' }), eventSubHandler({
    secret: config.eventsubSecret,
    db,
    logger,
    onNotification: async (type, event) => {
      if (type === 'stream.online') await onStreamOnline(event);
    },
  }));

  app.use(express.json({ limit: '32kb' }));
  app.use('/ext', extRouter({ config, service }));
  app.use('/auth', requireFetchHeader, authRouter({ config, twitch, sessions, logger }));
  app.use('/api', requireFetchHeader, apiRouter({ config, service, push, sessions }));
  app.use('/admin/api', requireFetchHeader, adminRouter({ config, service, twitch, push, sessions }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use((err, req, res, next) => {
    if (err instanceof GiveawayError || (err.status && err.status < 500)) {
      return res.status(err.status || 400).json({ error: err.code || err.message });
    }
    logger.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}
