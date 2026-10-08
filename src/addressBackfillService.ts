// ============================================================
// e-Handkerchief — AddressBackfillService
// Knots tied offline keep their GPS coordinates but no address. Once the
// device is back online this fills the address in (reverse geocoding), for
// knots created on THIS device only (their ids live in
// AppSettings.pendingAddressKnotIds, which is never synced).
// ============================================================

import { knotStore } from './knotStore.js';
import { geoService } from './geoService.js';
import { settingsStore } from './settingsStore.js';
import { eventBus } from './eventBus.js';
import { needsAddress, removePending } from './addressBackfill.js';

/** At most this many knots are processed per run; the rest wait for the next run. */
const MAX_PER_RUN = 10;
/** Nominatim usage policy: at most 1 request per second. */
const MIN_GAP_MS = 1100;

let inFlight: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Drop `id` from the persisted pending list (list read fresh to keep concurrent additions). */
async function dropPending(id: string): Promise<void> {
  const current = settingsStore.getCurrent().pendingAddressKnotIds;
  if (!current || !current.includes(id)) return;
  await settingsStore.save({ pendingAddressKnotIds: removePending(current, id) });
}

async function run(): Promise<void> {
  const ids = (settingsStore.getCurrent().pendingAddressKnotIds ?? []).slice(0, MAX_PER_RUN);
  let calledNetwork = false;

  for (const id of ids) {
    if (!navigator.onLine) return;
    try {
      const knot = await knotStore.get(id);
      if (!knot || !needsAddress(knot) || !knot.location) {
        await dropPending(id);
        continue;
      }

      if (calledNetwork) await sleep(MIN_GAP_MS);
      if (!navigator.onLine) return;
      calledNetwork = true;

      const addr = await geoService.reverseGeocode(knot.location.latitude, knot.location.longitude);
      if (!addr) continue; // keep the id; retried next run

      // The knot may have been edited or deleted during the await.
      const latest = await knotStore.get(id);
      if (!latest || !needsAddress(latest) || !latest.location) {
        await dropPending(id);
        continue;
      }

      const updated = {
        ...latest,
        location: { ...latest.location, resolvedAddress: addr },
        updatedAt: Date.now(),
      };
      await knotStore.save(updated);
      eventBus.emit('knot:saved', updated);
      await dropPending(id);
    } catch (err) {
      console.warn('Address backfill failed for knot', id, err);
    }
  }
}

/**
 * Look up and store the address for pending knots. Resolves immediately when
 * offline or nothing is pending. Single-flight: concurrent calls share one run.
 */
export function fillPendingAddresses(): Promise<void> {
  if (inFlight) return inFlight;
  if (!navigator.onLine) return Promise.resolve();
  const pending = settingsStore.getCurrent().pendingAddressKnotIds;
  if (!pending || pending.length === 0) return Promise.resolve();

  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
