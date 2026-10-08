// ============================================================
// e-Handkerchief — addressBackfill (pure helpers)
// Decides which knots still need a reverse-geocoded address and manages the
// pending-id list. No DOM / IndexedDB imports: runs under plain node.
// ============================================================

import type { Knot } from './types.js';

function isBlank(s: string | undefined | null): boolean {
  return s === undefined || s === null || s.trim() === '';
}

/**
 * True iff the knot has GPS coordinates but no address and no manual label —
 * i.e. an address lookup would add information.
 */
export function needsAddress(knot: Knot): boolean {
  return knot.location !== null && isBlank(knot.location.resolvedAddress) && isBlank(knot.manualLabel);
}

/** Add `id` to the list (deduplicated, order preserved). Returns a new array. */
export function addPending(ids: readonly string[] | undefined, id: string): string[] {
  const list = ids ? [...ids] : [];
  if (!list.includes(id)) list.push(id);
  return list;
}

/** Remove `id` from the list. Returns a new array (unchanged content if absent). */
export function removePending(ids: readonly string[] | undefined, id: string): string[] {
  return (ids ?? []).filter((x) => x !== id);
}
