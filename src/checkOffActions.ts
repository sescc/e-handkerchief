// ============================================================
// e-Handkerchief — checkOffActions
// Shared "check off / uncheck a knot" logic used by the Knots list and the
// knot detail screen.
//
// Checking off is NOT a content edit: it never touches `updatedAt`, so it
// causes no sync conflict, never lifts a cloud tombstone and never re-uploads
// media. It has its own last-write-wins clock, `checkOffChangedAt`, and emits
// `knot:checkedOff` (not `knot:saved`); app.ts listens for that event to send
// a metadata-only Drive update.
// ============================================================

import { knotStore } from './knotStore.js';
import { eventBus } from './eventBus.js';
import { toastService } from './toastService.js';
import { isCheckedOff } from './dayCutoff.js';
import type { Knot } from './types.js';

/**
 * Set a knot's check-off state. Re-reads the knot from the store first, so it
 * never writes over a fresher copy (e.g. one just pulled by a sync), then
 * saves and emits `knot:checkedOff`. Returns the updated knot, or undefined
 * if the knot no longer exists.
 */
export async function setCheckedOff(knotId: string, checkedOff: boolean): Promise<Knot | undefined> {
  const knot = await knotStore.get(knotId);
  if (!knot) return undefined;
  const now = Date.now();
  knot.checkedOffAt = checkedOff ? now : null;
  knot.checkOffChangedAt = now;
  // updatedAt is deliberately left alone.
  await knotStore.save(knot);
  eventBus.emit('knot:checkedOff', knot);
  return knot;
}

/**
 * Copy the STORED check-off state onto `knot` (in place) and return it. Call
 * this right before saving a knot whose in-memory copy may be stale — e.g. a
 * screen that has held it for a while — so a content save can never write an
 * old `checkedOffAt` / `checkOffChangedAt` back over a newer check-off (made
 * from the list, via Undo, or pulled by a sync). If the knot is no longer in
 * the store, it is returned unchanged.
 */
export async function withLatestCheckOff(knot: Knot): Promise<Knot> {
  const stored = await knotStore.get(knot.id);
  if (!stored) return knot;
  if (stored.checkedOffAt === undefined) delete knot.checkedOffAt;
  else knot.checkedOffAt = stored.checkedOffAt;
  if (stored.checkOffChangedAt === undefined) delete knot.checkOffChangedAt;
  else knot.checkOffChangedAt = stored.checkOffChangedAt;
  return knot;
}

/**
 * Toggle a knot's check-off state and offer an Undo toast that applies the
 * inverse (with a fresh `checkOffChangedAt`, so it wins over the first change
 * on every device). Returns the updated knot, or undefined if not found.
 */
export async function toggleCheckOff(knotId: string): Promise<Knot | undefined> {
  const current = await knotStore.get(knotId);
  if (!current) return undefined;

  const wasCheckedOff = isCheckedOff(current);
  const updated = await setCheckedOff(knotId, !wasCheckedOff);
  if (!updated) return undefined;

  toastService.showAction(wasCheckedOff ? 'Unchecked' : 'Checked off', 'Undo', () => {
    void setCheckedOff(knotId, wasCheckedOff).catch((err) => {
      console.warn('Undo of check-off failed:', err);
      toastService.show('Could not undo — please try again');
    });
  });
  return updated;
}
