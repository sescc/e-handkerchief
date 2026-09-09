// ============================================================
// e-Handkerchief — Raw IndexedDB Promise helpers
// ============================================================

const DB_NAME = 'e-handkerchief-db';
const DB_VERSION = 1;

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

      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('emailJobs')) {
        const jobs = db.createObjectStore('emailJobs', { keyPath: 'id' });
        jobs.createIndex('status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains('cloudUploadJobs')) {
        const uploads = db.createObjectStore('cloudUploadJobs', { keyPath: 'id' });
        uploads.createIndex('status', 'status', { unique: false });
      }

      // Settings store: no keyPath; records stored with explicit key 'app'
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };

    req.onsuccess = (event) => {
      _db = (event.target as IDBOpenDBRequest).result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
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
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = key !== undefined ? store.put(value, key) : store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
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
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
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
