// ============================================================
// e-Handkerchief — Raw IndexedDB Promise helpers
// ============================================================

const DB_NAME = 'e-handkerchief-db';
const DB_VERSION = 5;

/** Object store name for Knots. Used here and by knotStore.ts instead of a string literal. */
export const KNOT_OBJECT_STORE = 'knots';

/**
 * Object store name for local delete tombstones. Used here and by
 * knotStore.ts instead of a string literal. Records are
 * `{ id: string; deletedAt: number }` — see the KnotTombstone type.
 */
export const KNOT_TOMBSTONE_STORE = 'knotTombstones';

/**
 * Object store name for per-knot sync state (conflict detection). Used here
 * and by knotStore.ts. Records are `SyncStateRecord` — see types.ts:
 * `{ knotId, baseUpdatedAt, conflict? }`, keyed by `knotId`.
 */
export const SYNC_STATE_STORE = 'syncState';

let _db: IDBDatabase | null = null;

/**
 * Open (and cache) the IndexedDB database.
 * Creates all object stores on first run.
 */
export function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = (event.target as IDBOpenDBRequest).transaction;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        // Fresh database — create the full current (v5) schema directly:
        // knots, cloudUploadJobs, settings, knotTombstones, syncState. (No emailJobs —
        // save-and-send email was retired in favor of a per-knot Share
        // button; see the v3 -> v4 block below.)
        const knots = db.createObjectStore(KNOT_OBJECT_STORE, { keyPath: 'id' });
        knots.createIndex('createdAt', 'createdAt', { unique: false });

        const uploads = db.createObjectStore('cloudUploadJobs', { keyPath: 'id' });
        uploads.createIndex('status', 'status', { unique: false });

        // Settings store: no keyPath; records stored with explicit key 'app'
        db.createObjectStore('settings');

        db.createObjectStore(KNOT_TOMBSTONE_STORE, { keyPath: 'id' });

        db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'knotId' });
      }

      if (oldVersion >= 1 && oldVersion < 2) {
        // v1 -> v2: entity rename note -> knot (user decision, 2026-09-24).
        // The app is still in testing, so this DROPS existing local notes and
        // any queued cloud-upload jobs (whose records use the old `noteId`
        // field name) rather than migrating them — no migration is written.
        if (db.objectStoreNames.contains('notes')) {
          db.deleteObjectStore('notes');
        }
        if (!db.objectStoreNames.contains(KNOT_OBJECT_STORE)) {
          const knots = db.createObjectStore(KNOT_OBJECT_STORE, { keyPath: 'id' });
          knots.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (tx && db.objectStoreNames.contains('cloudUploadJobs')) {
          // Old records used `noteId`; clear rather than migrate the field name.
          tx.objectStore('cloudUploadJobs').clear();
        }
        // 'emailJobs' and 'settings' are unchanged by this version.
      }

      if (oldVersion < 3) {
        // v2 -> v3: local delete tombstones, so a Drive sync never pulls a
        // knot back onto a device it was deliberately deleted from.
        if (!db.objectStoreNames.contains(KNOT_TOMBSTONE_STORE)) {
          db.createObjectStore(KNOT_TOMBSTONE_STORE, { keyPath: 'id' });
        }
      }

      if (oldVersion < 4) {
        // v3 -> v4: retire save-and-send email (replaced by a per-knot Share
        // button). Drop the queued email jobs store; nothing reads it anymore.
        if (db.objectStoreNames.contains('emailJobs')) {
          db.deleteObjectStore('emailJobs');
        }
      }

      if (oldVersion >= 1 && oldVersion < 5) {
        // v4 -> v5: per-knot sync state (base version + recorded conflict) for
        // edit-conflict detection. Existing knots simply have no base yet;
        // the sync planner handles that case without losing data.
        // (A fresh database, oldVersion 0, already got it in the block above.)
        if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
          db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'knotId' });
        }
      }

      // if (oldVersion < 6) { ... }  <- future migrations append a block here
    };

    req.onblocked = () => {
      reject(new Error('Database open blocked by another open connection'));
    };

    req.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // If another tab/version upgrade requests it, close cleanly and clear cache
      db.onversionchange = () => {
        db.close();
        _db = null;
      };

      // If the connection is abnormally closed (e.g. OS kills the tab on hang),
      // clear the cache so the next call reopens a fresh connection.
      // Guard with a cast — onclose is not in all lib.dom versions.
      (db as IDBDatabase & { onclose?: (() => void) | null }).onclose = () => {
        _db = null;
      };

      _db = db;
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Reset the cached DB connection.
 * The next `openDB()` call will open a fresh connection.
 */
export function resetDBCache(): void {
  _db = null;
}

/**
 * Retrieve a single record by key.
 * Resolves with `undefined` if the key does not exist.
 */
export function dbGet<T>(
  db: IDBDatabase,
  storeName: string,
  key: string
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Write a record to the store.
 * Pass an explicit `key` for stores that have no keyPath (e.g. 'settings').
 */
export function dbPut<T>(
  db: IDBDatabase,
  storeName: string,
  value: T,
  key?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let reqError: DOMException | null = null;
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = key !== undefined ? store.put(value, key) : store.put(value);
    req.onerror = () => { reqError = req.error; };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(reqError ?? tx.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(reqError ?? tx.error ?? new Error('Transaction error'));
  });
}

/**
 * Delete a record by key.
 */
export function dbDelete(
  db: IDBDatabase,
  storeName: string,
  key: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let reqError: DOMException | null = null;
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onerror = () => { reqError = req.error; };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(reqError ?? tx.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(reqError ?? tx.error ?? new Error('Transaction error'));
  });
}

/**
 * Retrieve all records from a store (or an index within it),
 * in the given cursor direction (default: 'next' = ascending).
 */
export function dbGetAll<T>(
  db: IDBDatabase,
  storeName: string,
  indexName?: string,
  direction: IDBCursorDirection = 'next'
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const source: IDBIndex | IDBObjectStore = indexName
      ? store.index(indexName)
      : store;
    const results: T[] = [];
    const req = (source as IDBIndex).openCursor(null, direction);
    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        results.push(cursor.value as T);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Query all records matching a given key range on a named index.
 */
export function dbGetAllByIndex<T>(
  db: IDBDatabase,
  storeName: string,
  indexName: string,
  query: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index(indexName);
    const req = index.getAll(query);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}
