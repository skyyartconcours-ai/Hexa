import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signExtJwt, verifyExtJwt } from '../src/extjwt.js';
import { verifyEventSubSignature } from '../src/eventsub.js';
import { encodeSigned, decodeSigned } from '../src/session.js';

const SECRET = Buffer.from('super-secret-extension-key').toString('base64');

test('extension JWT round-trips and rejects tampering and expiry', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = signExtJwt({ opaque_user_id: 'U123', channel_id: '42', exp }, SECRET);
  assert.equal(verifyExtJwt(token, SECRET).opaque_user_id, 'U123');

  const [h, , s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ opaque_user_id: 'U999', channel_id: '42', exp })).toString('base64url');
  assert.equal(verifyExtJwt(`${h}.${forged}.${s}`, SECRET), null);
  assert.equal(verifyExtJwt(token, Buffer.from('other').toString('base64')), null);
  assert.equal(verifyExtJwt(token, SECRET, (exp + 1) * 1000), null);
  assert.equal(verifyExtJwt('garbage', SECRET), null);
});

test('EventSub signature check', () => {
  const secret = 'eventsub-secret-123';
  const messageId = 'msg-1';
  const timestamp = new Date().toISOString();
  const rawBody = Buffer.from('{"hello":"world"}');
  const signature = 'sha256=' + createHmac('sha256', secret).update(messageId + timestamp).update(rawBody).digest('hex');
  assert.ok(verifyEventSubSignature({ secret, messageId, timestamp, rawBody, signature }));
  assert.ok(!verifyEventSubSignature({ secret, messageId, timestamp, rawBody: Buffer.from('{}'), signature }));
  assert.ok(!verifyEventSubSignature({ secret, messageId, timestamp, rawBody, signature, nowMs: Date.now() + 20 * 60_000 }));
});

test('signed cookies', () => {
  const raw = encodeSigned({ uid: '1' }, 'k');
  assert.deepEqual(decodeSigned(raw, 'k'), { uid: '1' });
  assert.equal(decodeSigned(raw, 'other'), null);
  assert.equal(decodeSigned(raw.replace(/^./, 'x'), 'k'), null);
});
