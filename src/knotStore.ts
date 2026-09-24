// ============================================================
// e-Handkerchief — KnotStore
// CRUD operations on Knots in IndexedDB.
// ============================================================

import {
  openDB,
  dbGet,
  dbPut,
  dbDelete,
  dbGetAll,
  resetDBCache,
  KNOT_OBJECT_STORE,
  KNOT_TOMBSTONE_STORE,
} from './db.js';
import type { Knot, KnotTombstone } from './types.js';

export interface KnotStoreAPI {
  /** Save a new or updated knot. Resolves within 1 second under normal conditions. */
  save(knot: Knot): Promise<void>;
  /** Retrieve a single knot by UUID. Returns undefined if not found. */
  get(id: string): Promise<Knot | undefined>;
  /** All knots sorted by createdAt descending (newest first). */
  listAll(): Promise<Knot[]>;
  /**
   * Permanently delete a knot FROM THIS DEVICE and its associated media
   * blobs, and record a local tombstone. Local deletes never delete the
   * knot's Drive backup — Drive is an archive — and the tombstone stops a
   * later sync from pulling this knot back onto this device.
   */
  delete(id: string): Promise<void>;
  /** All local delete tombstones, used by sync to avoid re-pulling deleted knots. */
  listTombstones(): Promise<KnotTombstone[]>;
  /**
   * Save a knot pulled from cloud sync. A plain save with no side effects —
   * unlike `save()`, callers of `saveFromSync` are responsible for deciding
   * whether to notify the rest of the app (e.g. via eventBus). This function
   * itself MUST NOT emit any events, so a sync pull never looks like a local
   * edit to the rest of the app.
   */
  saveFromSync(knot: Knot): Promise<void>;
}

async function saveWithRetry(knot: Knot): Promise<void> {
  try {
    const db = await openDB();
    await dbPut(db, KNOT_OBJECT_STORE, knot);
  } catch {
    // The cached connection may be stale (e.g. after a tab was killed).
    // Reset the cache and try one more time with a fresh connection.
    resetDBCache();
    const db = await openDB();
    await dbPut(db, KNOT_OBJECT_STORE, knot);
  }
}

export const knotStore: KnotStoreAPI = {
  async save(knot: Knot): Promise<void> {
    await saveWithRetry(knot);
  },

  async get(id: string): Promise<Knot | undefined> {
    const db = await openDB();
    return dbGet<Knot>(db, KNOT_OBJECT_STORE, id);
  },

  async listAll(): Promise<Knot[]> {
    const db = await openDB();
    // 'prev' cursor direction = descending by index value = newest first
    return dbGetAll<Knot>(db, KNOT_OBJECT_STORE, 'createdAt', 'prev');
  },

  async delete(id: string): Promise<void> {
    const db = await openDB();
    await dbDelete(db, KNOT_OBJECT_STORE, id);
    // Centralized here so every delete path (Knots list, detail screen, …)
    // records a tombstone — a local delete must never be undone by a pull.
    const tombstone: KnotTombstone = { id, deletedAt: Date.now() };
    await dbPut(db, KNOT_TOMBSTONE_STORE, tombstone);
  },

  async listTombstones(): Promise<KnotTombstone[]> {
    const db = await openDB();
    return dbGetAll<KnotTombstone>(db, KNOT_TOMBSTONE_STORE);
  },

  async saveFromSync(knot: Knot): Promise<void> {
    // Plain save — MUST NOT emit events (see the KnotStoreAPI doc comment).
    await saveWithRetry(knot);
  },
};
