// ============================================================
// e-Handkerchief — SettingsStore
// Reads/writes AppSettings to IndexedDB with an in-memory cache.
// ============================================================

import { openDB, dbGet, dbPut } from './db.js';
import type { AppSettings } from './types.js';

export interface SettingsStoreAPI {
  /** Load settings from IndexedDB. Must be called once before any screen renders. */
  load(): Promise<AppSettings>;
  /** Persist a partial settings update within 500 ms. */
  save(patch: Partial<AppSettings>): Promise<void>;
  /**
   * Synchronous in-memory cache — always reflects the latest persisted state.
   * Throws if load() has not been called yet.
   */
  getCurrent(): AppSettings;
  /** Register a listener that fires after every successful save. Returns unsubscribe fn. */
  onChange(listener: (settings: AppSettings) => void): () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  transcriptionEnabled: false,
  transcriptionServerUrl: '',
  emailSummaryEnabled: false,
  emailSummaryRecipient: null,
  cloudBackupProvider: null,
  cloudBackupToken: null,
  notificationPermissionRequested: false,
  lastSyncAt: null,
  timezone: 'auto',
  dateFormat: 'DD MMM YYYY',
  timeFormat: '24h',
};

let _current: AppSettings | null = null;
const _listeners: Array<(s: AppSettings) => void> = [];

export const settingsStore: SettingsStoreAPI = {
  async load(): Promise<AppSettings> {
    const db = await openDB();
    const stored = await dbGet<AppSettings>(db, 'settings', 'app');
    // Merge stored object with defaults so any absent key gets its default value
    _current = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    return _current;
  },

  async save(patch: Partial<AppSettings>): Promise<void> {
    if (!_current) {
      throw new Error('settingsStore.load() must be called before save()');
    }
    const updated: AppSettings = { ..._current, ...patch };
    const db = await openDB();
    await dbPut(db, 'settings', updated, 'app');
    _current = updated;
    for (const listener of _listeners) {
      listener(_current);
    }
  },

  getCurrent(): AppSettings {
    if (!_current) {
      throw new Error('settingsStore.load() must be called before getCurrent()');
    }
    return _current;
  },

  onChange(listener: (settings: AppSettings) => void): () => void {
    _listeners.push(listener);
    return () => {
      const idx = _listeners.indexOf(listener);
      if (idx !== -1) _listeners.splice(idx, 1);
    };
  },
};
