// ============================================================
// e-Handkerchief — knotSearch
// Pure text search over knots: accent- and case-insensitive, every query word
// must match somewhere (AND, any order), no fuzzy matching. No DOM, no
// settings/db imports (type-only import of ./types.js), so it runs under plain
// `node` for the characterization test.
//
// Fields searched: text items' content, audio items' transcripts, the legacy
// knot-level transcription, the resolved address and the manual label.
// ============================================================

import type { Knot } from './types.js';

/** A half-open range [start, end) of UTF-16 indices into the ORIGINAL text. */
export type MatchRange = [number, number];

/** Fold one code point: NFD, drop combining marks, lowercase (marks dropped again). */
function foldCodePoint(ch: string): string {
  return ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\p{M}/gu, '');
}

interface Folded {
  /** The folded text. */
  folded: string;
  /** For each UTF-16 unit of `folded`: index in the original where its code point starts. */
  starts: number[];
  /** For each unit of `folded`: index in the original just after its code point (and any marks that fold away after it). */
  ends: number[];
}

/**
 * Fold `s` code point by code point, remembering where every folded unit came
 * from. Doing it per code point (never on the whole string) keeps the result
 * independent of context, so `knotMatches` and `matchRanges` always agree.
 */
function foldWithMap(s: string): Folded {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of s) {
    const next = i + ch.length;
    const f = ch.length === 1 && ch.charCodeAt(0) < 128 ? ch.toLowerCase() : foldCodePoint(ch);
    if (f.length === 0) {
      // A combining mark: extend the previous unit so a highlight never splits
      // a base letter from its accent.
      if (ends.length > 0) ends[ends.length - 1] = next;
    } else {
      for (let k = 0; k < f.length; k++) {
        starts.push(i);
        ends.push(next);
      }
      folded += f;
    }
    i = next;
  }
  return { folded, starts, ends };
}

const NON_ASCII = /[^\x00-\x7f]/;

/**
 * NFD, strip combining marks (\p{M}), lowercase. "Café" -> "cafe".
 * Pure-ASCII text (the common case) takes a fast path with identical output,
 * so searching a large store stays quick on a phone.
 */
export function normalizeForSearch(s: string): string {
  if (!NON_ASCII.test(s)) return s.toLowerCase();
  return foldWithMap(s).folded;
}

/**
 * Split a query into normalized, de-duplicated words (any whitespace
 * separates them). An empty or whitespace-only query gives `[]`, which every
 * caller treats as "no search active".
 */
export function queryTokens(q: string): string[] {
  const out: string[] = [];
  for (const t of normalizeForSearch(q).split(/\s+/u)) {
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

/** The raw searchable strings of a knot, in display order. */
export function knotSearchFields(knot: Knot): string[] {
  const fields: string[] = [];
  for (const m of knot.mediaItems) {
    if (m.type === 'text') fields.push(m.content);
    else if (m.type === 'audio' && m.transcript) fields.push(m.transcript);
  }
  if (knot.transcription) fields.push(knot.transcription);
  if (knot.location?.resolvedAddress) fields.push(knot.location.resolvedAddress);
  if (knot.manualLabel) fields.push(knot.manualLabel);
  return fields.filter((f) => f.length > 0);
}

/**
 * True when EVERY token occurs (as a substring) in at least one searchable
 * field. `tokens` must come from `queryTokens`. An empty token list is
 * vacuously true (but callers should use `searchKnots`, which treats it as
 * "no search").
 */
export function knotMatches(knot: Knot, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const fields = knotSearchFields(knot).map(normalizeForSearch);
  return tokens.every((t) => fields.some((f) => f.includes(t)));
}

/**
 * The knots matching `q`, in their original order.
 * Returns `null` (not the full list) when the query has no words (empty or
 * whitespace only): "no search active, do not filter".
 */
export function searchKnots(knots: Knot[], q: string): Knot[] | null {
  const tokens = queryTokens(q);
  if (tokens.length === 0) return null;
  return knots.filter((k) => knotMatches(k, tokens));
}

/**
 * Ranges of `text` (UTF-16 indices into the ORIGINAL string) that match any
 * token, sorted, with overlapping and adjacent ranges merged. `tokens` must
 * come from `queryTokens`.
 */
export function matchRanges(text: string, tokens: string[]): MatchRange[] {
  if (text.length === 0 || tokens.length === 0) return [];
  const { folded, starts, ends } = foldWithMap(text);
  const raw: MatchRange[] = [];
  for (const t of tokens) {
    if (t.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = folded.indexOf(t, from);
      if (at === -1) break;
      raw.push([starts[at], ends[at + t.length - 1]]);
      from = at + 1; // allow overlapping occurrences; merged below
    }
  }
  if (raw.length === 0) return [];
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: MatchRange[] = [[raw[0][0], raw[0][1]]];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    if (raw[i][0] <= last[1]) {
      if (raw[i][1] > last[1]) last[1] = raw[i][1];
    } else {
      merged.push([raw[i][0], raw[i][1]]);
    }
  }
  return merged;
}

/**
 * A short single-line excerpt (at most about `maxLen` characters, with "…" where
 * cut) of the first field that contains any token, positioned so the match is
 * visible. Null when no field contains a token. Callers highlight it by running
 * `matchRanges` on the returned string itself.
 */
export function matchSnippet(knot: Knot, tokens: string[], maxLen = 80): string | null {
  for (const raw of knotSearchFields(knot)) {
    const field = raw.replace(/\s+/g, ' ').trim();
    const ranges = matchRanges(field, tokens);
    if (ranges.length === 0) continue;
    if (field.length <= maxLen) return field;
    let start = Math.max(0, ranges[0][0] - 20);
    let end = Math.min(field.length, start + maxLen);
    start = Math.max(0, end - maxLen);
    let snippet = field.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < field.length) snippet += '…';
    return snippet;
  }
  return null;
}
