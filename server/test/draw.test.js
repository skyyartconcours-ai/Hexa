import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTickets, weightedPick } from '../src/draw.js';

const base = { maxTickets: 10, loyal: false, loyaltyBonus: 2, isSub: false, subMultiplier: 1, subFreeAlternative: true };

test('one ticket per checkpoint, capped', () => {
  assert.equal(computeTickets({ ...base, slots: 3 }), 3);
  assert.equal(computeTickets({ ...base, slots: 25 }), 10);
});

test('loyalty bonus is added on top of the cap', () => {
  assert.equal(computeTickets({ ...base, slots: 25, loyal: true }), 12);
});

test('sub multiplier applies to subs, and to loyal viewers when the free alternative is on', () => {
  const opts = { ...base, slots: 4, subMultiplier: 1.5 };
  assert.equal(computeTickets({ ...opts, isSub: true }), 6);
  assert.equal(computeTickets({ ...opts }), 4);
  assert.equal(computeTickets({ ...opts, loyal: true }), 9); // (4 + 2) * 1.5
  assert.equal(computeTickets({ ...opts, loyal: true, subFreeAlternative: false }), 6);
});

test('weightedPick walks the cumulative weights', () => {
  const c = [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }];
  assert.equal(weightedPick(c, () => 0).id, 'a');
  assert.equal(weightedPick(c, () => 1).id, 'b');
  assert.equal(weightedPick(c, () => 3).id, 'b');
  assert.equal(weightedPick([], () => 0), null);
  assert.equal(weightedPick([{ id: 'z', weight: 0 }], () => 0), null);
});

test('weightedPick is roughly proportional with the real RNG', () => {
  const c = [{ id: 'a', weight: 1 }, { id: 'b', weight: 9 }];
  let b = 0;
  for (let i = 0; i < 5000; i++) if (weightedPick(c).id === 'b') b++;
  assert.ok(b > 4300 && b < 4700, `b won ${b}/5000`);
});
