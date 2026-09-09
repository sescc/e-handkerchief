// ============================================================
// e-Handkerchief — EventBus
// Lightweight typed publish/subscribe module.
// ============================================================

import type { Note, AppSettings } from './types.js';

type EventMap = {
  'note:saved': Note;
  'settings:changed': AppSettings;
  'sw:waiting': void;
};

type Handler<K extends keyof EventMap> = (data: EventMap[K]) => void;

const _handlers: Partial<{ [K in keyof EventMap]: Array<Handler<K>> }> = {};

export const eventBus = {
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const handlers = _handlers[event] as Array<Handler<K>> | undefined;
    if (handlers) {
      // Copy array before iterating to avoid mutation issues during dispatch
      [...handlers].forEach((h) => h(data));
    }
  },

  on<K extends keyof EventMap>(event: K, cb: Handler<K>): () => void {
    if (!_handlers[event]) {
      (_handlers as Record<string, unknown[]>)[event] = [];
    }
    (_handlers[event] as Array<Handler<K>>).push(cb);
    return () => {
      const arr = _handlers[event] as Array<Handler<K>> | undefined;
      if (!arr) return;
      const idx = arr.indexOf(cb);
      if (idx !== -1) arr.splice(idx, 1);
    };
  },
};
