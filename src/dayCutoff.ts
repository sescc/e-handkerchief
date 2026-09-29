// ============================================================
// e-Handkerchief — dayCutoff
// Pure helpers for the "new day starts at HH:MM" rule that decides when a
// checked-off knot leaves the Knots list. No DOM, no db/settingsStore imports —
// kept importable under plain `node` for the characterization test.
//
// Wall-clock arithmetic is done with Intl.DateTimeFormat#formatToParts, so it
// follows the IANA zone's real offsets (including DST and half-hour zones)
// without a date library.
// ============================================================

const DEFAULT_CUTOFF = '03:00';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Resolve the app's `timezone` setting to an IANA name: "auto" (or empty)
 * means the device's own zone; anything else is returned as-is.
 */
export function resolveTimeZone(setting: string | null | undefined): string {
  if (setting && setting !== 'auto') return setting;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** True when the knot is currently checked off (has a check-off timestamp). */
export function isCheckedOff(knot: { checkedOffAt?: number | null }): boolean {
  return typeof knot.checkedOffAt === 'number';
}

/** Parse "HH:MM"; a malformed value falls back to "03:00". */
function parseCutoff(cutoff: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((cutoff ?? '').trim());
  if (m) {
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }
  const [h, mi] = DEFAULT_CUTOFF.split(':');
  return { hour: parseInt(h, 10), minute: parseInt(mi, 10) };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Cached wall-clock formatter for a zone; an unknown zone degrades to UTC. */
function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    };
    try {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone });
    } catch {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' });
    }
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading of instant `t` in the zone, expressed as if it were UTC (ms). */
function wallAsUtc(t: number, timeZone: string): number {
  const map: Record<string, number> = {};
  for (const p of getFormatter(timeZone).formatToParts(new Date(t))) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  return Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
}

/** Zone offset (wall minus UTC, ms) at instant `t`. */
function offsetAt(t: number, timeZone: string): number {
  return wallAsUtc(t, timeZone) - Math.floor(t / 1000) * 1000;
}

/**
 * The instant at which the zone's wall clock reads `wall` (a wall time
 * expressed as UTC ms).
 * - Ambiguous (fall-back overlap): the FIRST occurrence.
 * - Nonexistent (spring-forward gap): the first instant after the gap.
 */
function instantForWall(wall: number, timeZone: string): number {
  const oBefore = offsetAt(wall - DAY_MS, timeZone);
  const oMid = offsetAt(wall, timeZone);
  const oAfter = offsetAt(wall + DAY_MS, timeZone);

  const valid: number[] = [];
  for (const o of new Set([oBefore, oMid, oAfter])) {
    const t = wall - o;
    if (wallAsUtc(t, timeZone) === wall) valid.push(t);
  }
  if (valid.length > 0) return Math.min(...valid);

  // Gap: bracket the transition and binary-search its first instant.
  let lo = Math.min(wall - oBefore, wall - oAfter);
  let hi = Math.max(wall - oBefore, wall - oAfter);
  const target = offsetAt(hi, timeZone);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid, timeZone) === target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * The first instant strictly after `ms` at which the wall clock in `timeZone`
 * reads `cutoff` ("HH:MM"; malformed values fall back to "03:00").
 *
 * DST: if the cutoff falls in a spring-forward gap, the first instant after
 * the gap is used; if it is ambiguous (fall-back), the FIRST occurrence of
 * that day is used (so a check-off between the two occurrences waits for the
 * next day's cutoff).
 */
export function nextCutoffAfter(ms: number, cutoff: string, timeZone: string): number {
  const { hour, minute } = parseCutoff(cutoff);
  const w = new Date(wallAsUtc(ms, timeZone));
  const y = w.getUTCFullYear();
  const mo = w.getUTCMonth();
  const d = w.getUTCDate();

  let best = Infinity;
  // Day offsets -1..2 cover the local date of `ms`, its neighbours and any
  // zone whose wall date jumps backwards at a transition.
  for (let dayOffset = -1; dayOffset <= 2; dayOffset++) {
    const t = instantForWall(Date.UTC(y, mo, d + dayOffset, hour, minute), timeZone);
    if (t > ms && t < best) best = t;
  }
  return best;
}

/**
 * Whether a knot should be listed in the Knots list right now.
 * - Not checked off (null/undefined) -> always visible.
 * - Checked off -> visible until the next cutoff after it was checked off.
 */
export function isCheckedOffVisible(
  checkedOffAt: number | null | undefined,
  now: number,
  cutoff: string,
  timeZone: string
): boolean {
  if (checkedOffAt === null || checkedOffAt === undefined) return true;
  return now < nextCutoffAfter(checkedOffAt, cutoff, timeZone);
}
