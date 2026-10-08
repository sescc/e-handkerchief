// ============================================================
// e-Handkerchief — mediaSummary
// Pure helper (no DOM) that summarises a knot's media per TYPE, used by the
// Calendar day list to show one small thumbnail per type.
// ============================================================

import type { MediaItem } from './types.js';

export interface MediaSummaryEntry {
  type: 'photo' | 'video' | 'audio';
  count: number;
  /** First item of this type, in array order. */
  first: MediaItem;
}

/** Fixed display order. */
const ORDER: ReadonlyArray<MediaSummaryEntry['type']> = ['photo', 'video', 'audio'];

/**
 * One entry per media type present (photo, video, audio — in that fixed order,
 * regardless of the input order). Text items are ignored; absent types omitted.
 */
export function summarizeMedia(items: readonly MediaItem[]): MediaSummaryEntry[] {
  const entries: MediaSummaryEntry[] = [];
  for (const type of ORDER) {
    let count = 0;
    let first: MediaItem | null = null;
    for (const item of items) {
      if (item.type !== type) continue;
      if (first === null) first = item;
      count += 1;
    }
    if (first !== null) entries.push({ type, count, first });
  }
  return entries;
}

const NOUNS: Record<MediaSummaryEntry['type'], { one: string; many: string }> = {
  photo: { one: 'photo', many: 'photos' },
  video: { one: 'video', many: 'videos' },
  audio: { one: 'voice recording', many: 'voice recordings' },
};

/** Accessible summary, e.g. "3 photos, 1 video, 1 voice recording". Empty -> ''. */
export function describeMediaSummary(entries: readonly MediaSummaryEntry[]): string {
  return entries
    .map((e) => `${e.count} ${e.count === 1 ? NOUNS[e.type].one : NOUNS[e.type].many}`)
    .join(', ');
}
