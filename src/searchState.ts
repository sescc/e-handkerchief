// ============================================================
// e-Handkerchief — searchState
// The one in-memory search query shared by the Knots and Calendar screens.
// Not persisted: it lives until the app is closed (or the user clears it).
// ============================================================

import { eventBus } from './eventBus.js';

let query = '';

export const searchState = {
  /** The raw query text (may be empty or only whitespace). */
  get(): string {
    return query;
  },

  /** Set the query. Does nothing (and emits nothing) when the value is unchanged. */
  set(q: string): void {
    if (q === query) return;
    query = q;
    eventBus.emit('search:changed', query);
  },

  /** Be told whenever the query changes. Returns the unsubscribe function. */
  subscribe(cb: (q: string) => void): () => void {
    return eventBus.on('search:changed', cb);
  },
};
