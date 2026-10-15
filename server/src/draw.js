import { randomInt } from 'node:crypto';

/**
 * Tickets for one entrant.
 * - 1 ticket per checkpoint where the viewer was seen watching, capped at maxTickets
 * - + loyaltyBonus if they took part in the previous lives' giveaways
 * - x subMultiplier if they are a sub (or, with the free alternative, a loyal viewer)
 */
export function computeTickets({ slots, maxTickets, loyal, loyaltyBonus, isSub, subMultiplier, subFreeAlternative }) {
  const base = Math.min(slots, maxTickets);
  const withLoyalty = base + (loyal ? loyaltyBonus : 0);
  const boosted = subMultiplier > 1 && (isSub || (subFreeAlternative && loyal));
  return Math.round(withLoyalty * (boosted ? subMultiplier : 1));
}

/** Picks one candidate with probability proportional to `weight`. */
export function weightedPick(candidates, rand = randomInt) {
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return null;
  let r = rand(total);
  for (const c of candidates) {
    if (r < c.weight) return c;
    r -= c.weight;
  }
  return null;
}
