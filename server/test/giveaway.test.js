import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { GiveawayService } from '../src/giveaway.js';

const MIN = 60_000;

function setup({ subs = [], rand } = {}) {
  let clock = Date.parse('2026-10-15T20:00:00Z');
  const service = new GiveawayService({
    db: openDb(':memory:'),
    now: () => clock,
    rand,
    fetchSubscribers: async (ids) => new Set(ids.filter((id) => subs.includes(id))),
    lookupUser: async (id) => ({ id, login: `user${id}`, display_name: `User${id}`, created_at: '2020-01-01T00:00:00Z' }),
    logger: { warn() {}, error() {}, info() {} },
  });
  return { service, advance: (ms) => { clock += ms; }, now: () => clock };
}

// Simulates a viewer whose extension checks in once per 15-minute window.
function watch(service, advance, viewers, minutes) {
  for (let m = 0; m < minutes; m += 15) {
    for (const v of viewers) service.heartbeat(v);
    advance(15 * MIN);
  }
}

test('presence before joining counts, and tickets grow with time watched', async () => {
  const { service, advance } = setup();
  service.start({ durationMin: 90, intervalMin: 15 });
  watch(service, advance, ['U1'], 45);
  await service.join({ opaqueId: 'U1', userId: '1' });
  const s = service.viewerState('U1');
  assert.equal(s.me.joined, true);
  assert.equal(s.me.slots, 4); // 3 windows watched + the join window
  assert.equal(s.stats.entrants, 1);
});

test('joining requires a logged-in viewer who shared their identity', async () => {
  const { service } = setup();
  service.start();
  await assert.rejects(service.join({ opaqueId: 'A1', userId: null }), { code: 'login_required' });
  await assert.rejects(service.join({ opaqueId: 'U1', userId: null }), { code: 'identity_required' });
});

test('recent accounts are refused', async () => {
  const { service } = setup();
  service.lookupUser = async (id) => ({ id, login: 'alt', created_at: new Date().toISOString() });
  service.start({ minAccountAgeDays: 30 });
  await assert.rejects(service.join({ opaqueId: 'U1', userId: '1' }), { code: 'account_too_recent' });
});

test('someone who only shows up at the end is not eligible', async () => {
  const { service, advance } = setup();
  service.start({ durationMin: 90, intervalMin: 15, minTickets: 2 });
  await service.join({ opaqueId: 'U1', userId: '1' });
  watch(service, advance, ['U1'], 75);
  await service.join({ opaqueId: 'U2', userId: '2' }); // arrives 15 minutes before the draw
  advance(15 * MIN);
  service.heartbeat('U1');
  const g = service.active();
  const pool = service.eligible(g).map((c) => c.user_id);
  assert.deepEqual(pool, ['1']);
});

test('viewers who left before the draw are not eligible', async () => {
  const { service, advance } = setup();
  service.start({ durationMin: 90, intervalMin: 15 });
  await service.join({ opaqueId: 'U1', userId: '1' });
  await service.join({ opaqueId: 'U2', userId: '2' });
  watch(service, advance, ['U1', 'U2'], 30);
  watch(service, advance, ['U1'], 60); // U2 closed the stream
  assert.deepEqual(service.eligible(service.active()).map((c) => c.user_id), ['1']);
});

test('full flow: scheduled draw, missed claim, redraw, claim', async () => {
  const { service, advance } = setup({ rand: () => 0 });
  service.start({ durationMin: 90, intervalMin: 15, claimTimeoutSec: 60 });
  await service.join({ opaqueId: 'U1', userId: '1' });
  await service.join({ opaqueId: 'U2', userId: '2' });
  watch(service, advance, ['U1', 'U2'], 90);
  service.heartbeat('U1');
  service.heartbeat('U2');

  await service.tick();
  let g = service.active();
  assert.equal(g.status, 'claiming');
  const first = g.candidate_opaque_id;
  assert.equal(service.viewerState(first).me.isCandidate, true);

  advance(61_000);
  assert.throws(() => service.claim(first), { code: 'too_late' });
  await service.tick();
  g = service.active();
  const second = g.candidate_opaque_id;
  assert.notEqual(second, first);

  assert.throws(() => service.claim(first), { code: 'not_candidate' });
  const winner = service.claim(second);
  assert.equal(winner.user_id, second === 'U1' ? '1' : '2');
  assert.equal(service.active(), null);
  assert.equal(service.viewerState(second).me.isWinner, true);
  assert.equal(service.viewerState(second).giveaway.winner, winner.display_name);
  assert.equal(service.winsFor(winner.user_id).length, 1);
});

test('draw with nobody eligible closes the giveaway without a winner', async () => {
  const { service, advance } = setup();
  const g = service.start({ durationMin: 30 });
  advance(31 * MIN);
  await service.tick();
  assert.equal(service.get(g.id).status, 'done');
});

test('an early manual draw with nobody eligible keeps the giveaway open', async () => {
  const { service } = setup();
  const g = service.start();
  await service.join({ opaqueId: 'U1', userId: '1' });
  assert.equal(await service.draw(g.id, { closeIfEmpty: false }), null);
  assert.equal(service.get(g.id).status, 'open');
});

test('weights include loyalty bonus and sub multiplier', async () => {
  const { service, advance } = setup({ subs: ['2'] });
  service.updateSettings({ durationMin: 30, intervalMin: 15, minTickets: 1, loyaltyLives: 1, loyaltyBonus: 2, subMultiplier: 2, subFreeAlternative: false });

  // Previous live: only user 1 took part, so user 1 is loyal next time.
  service.start();
  await service.join({ opaqueId: 'U1', userId: '1' });
  watch(service, advance, ['U1'], 30);
  service.heartbeat('U1');
  await service.tick();
  service.claim('U1');

  service.start();
  await service.join({ opaqueId: 'U1', userId: '1' });
  await service.join({ opaqueId: 'U2', userId: '2' });
  watch(service, advance, ['U1', 'U2'], 30);
  service.heartbeat('U1');
  service.heartbeat('U2');
  await service.tick();

  const tickets = Object.fromEntries(service.adminOverview().entrants.map((e) => [e.user_id, e.tickets]));
  assert.equal(tickets['1'], 3 + 2); // 3 checkpoints + loyalty
  assert.equal(tickets['2'], 3 * 2); // 3 checkpoints, sub x2
});

test('only one active giveaway at a time, and cancel works', () => {
  const { service } = setup();
  const g = service.start();
  assert.throws(() => service.start(), { code: 'already_active' });
  service.cancel(g.id);
  assert.equal(service.active(), null);
});

test('settings are clamped', () => {
  const { service } = setup();
  const s = service.updateSettings({ intervalMin: 0, maxTickets: 5, minTickets: 50, subMultiplier: 99, prize: '  Elden Ring  ' });
  assert.equal(s.intervalMin, 1);
  assert.equal(s.minTickets, 5);
  assert.equal(s.subMultiplier, 5);
  assert.equal(s.prize, 'Elden Ring');
});

test('winner contact info: only the winner can set it, and forgetUser clears it', async () => {
  const { service, advance } = setup();
  service.start({ durationMin: 30, minTickets: 1 });
  await service.join({ opaqueId: 'U1', userId: '1' });
  watch(service, advance, ['U1'], 30);
  service.heartbeat('U1');
  await service.tick();
  const w = service.claim('U1');
  assert.throws(() => service.setContact(w.id, '2', 'hack'), { code: 'not_found' });
  service.setContact(w.id, '1', 'Discord: user1');
  assert.equal(service.winsFor('1')[0].contact, 'Discord: user1');
  service.forgetUser('1');
  assert.equal(service.winsFor('1')[0].contact, null);
});
