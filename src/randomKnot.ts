// ============================================================
// e-Handkerchief — randomKnot
// Pure helper behind the "Random" button: pick one unchecked knot at random,
// optionally skipping the one currently on screen. No DOM, no db imports —
// kept importable under plain `node` for the characterization test.
// ============================================================

import type { Knot } from './types.js';

/**
 * Pick a random knot that is NOT checked off (`checkedOffAt` is not a number),
 * excluding the knot whose id is `excludeId` (pass null to exclude nothing).
 * Returns null when there is no candidate. `rand` is injectable for tests and
 * must return a value in [0, 1); a value of exactly 1 is clamped to the last
 * candidate.
 */
export function pickRandomKnot(
  knots: Knot[],
  excludeId: string | null,
  rand: () => number = Math.random,
): Knot | null {
  const candidates = knots.filter(
    (k) => typeof k.checkedOffAt !== 'number' && k.id !== excludeId,
  );
  if (candidates.length === 0) return null;
  const index = Math.min(Math.floor(rand() * candidates.length), candidates.length - 1);
  return candidates[index];
}
