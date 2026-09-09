// ============================================================
// e-Handkerchief — NoteStore
// CRUD operations on Notes in IndexedDB.
// ============================================================

import { openDB, dbGet, dbPut, dbDelete, dbGetAll } from './db.js';
import type { Note } from './types.js';

export interface NoteStoreAPI {
  /** Save a new or updated note. Resolves within 1 second under normal conditions. */
  save(note: Note): Promise<void>;
  /** Retrieve a single note by UUID. Returns undefined if not found. */
  get(id: string): Promise<Note | undefined>;
  /** All notes sorted by createdAt descending (newest first). */
  listAll(): Promise<Note[]>;
  /** Permanently delete a note and its associated media blobs. */
  delete(id: string): Promise<void>;
}

export const noteStore: NoteStoreAPI = {
  async save(note: Note): Promise<void> {
    const db = await openDB();
    await dbPut(db, 'notes', note);
  },

  async get(id: string): Promise<Note | undefined> {
    const db = await openDB();
    return dbGet<Note>(db, 'notes', id);
  },

  async listAll(): Promise<Note[]> {
    const db = await openDB();
    // 'prev' cursor direction = descending by index value = newest first
    return dbGetAll<Note>(db, 'notes', 'createdAt', 'prev');
  },

  async delete(id: string): Promise<void> {
    const db = await openDB();
    await dbDelete(db, 'notes', id);
  },
};
