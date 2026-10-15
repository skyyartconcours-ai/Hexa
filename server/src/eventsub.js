import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_MS = 10 * 60 * 1000;

export function verifyEventSubSignature({ secret, messageId, timestamp, rawBody, signature, nowMs = Date.now() }) {
  if (!secret || !messageId || !timestamp || !signature || !rawBody) return false;
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts) || Math.abs(nowMs - ts) > MAX_AGE_MS) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret)
    .update(messageId + timestamp).update(rawBody).digest('hex'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Express handler for Twitch EventSub webhooks. Must be mounted with express.raw()
 * so the signature can be checked against the exact bytes Twitch sent.
 */
export function eventSubHandler({ secret, db, onNotification, logger = console }) {
  return async (req, res) => {
    const messageId = req.get('Twitch-Eventsub-Message-Id');
    const ok = verifyEventSubSignature({
      secret,
      messageId,
      timestamp: req.get('Twitch-Eventsub-Message-Timestamp'),
      rawBody: req.body,
      signature: req.get('Twitch-Eventsub-Message-Signature'),
    });
    if (!ok) return res.sendStatus(403);

    const body = JSON.parse(req.body.toString('utf8'));
    const type = req.get('Twitch-Eventsub-Message-Type');

    if (type === 'webhook_callback_verification') {
      return res.type('text/plain').send(body.challenge);
    }
    if (type === 'revocation') {
      logger.warn('EventSub subscription revoked:', body.subscription?.type, body.subscription?.status);
      return res.sendStatus(204);
    }
    if (type !== 'notification') return res.sendStatus(204);

    // Twitch may deliver the same message more than once.
    const fresh = db.prepare('INSERT OR IGNORE INTO eventsub_messages (id, received_at) VALUES (?, ?)')
      .run(messageId, Date.now()).changes > 0;
    res.sendStatus(204);
    if (!fresh) return;
    db.prepare('DELETE FROM eventsub_messages WHERE received_at < ?').run(Date.now() - 24 * 3600 * 1000);
    try {
      await onNotification(body.subscription.type, body.event);
    } catch (err) {
      logger.error('EventSub notification handler failed:', err);
    }
  };
}
