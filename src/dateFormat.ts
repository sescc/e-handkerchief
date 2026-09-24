// ============================================================
// e-Handkerchief — Shared date/time formatter
// Centralizes timestamp formatting so Knots, Capture, and
// KnotDetail screens all use the user's preferred format.
// ============================================================

import { settingsStore } from './settingsStore.js';
import type { AppSettings } from './types.js';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Format a knot's ISO timestamp according to the user's date/time/timezone settings.
 * Falls back gracefully to the raw ISO string on any error.
 */
export function formatKnotTimestamp(localISO: string, settings?: AppSettings): string {
  const s = settings ?? settingsStore.getCurrent();
  try {
    const d = new Date(localISO);
    if (isNaN(d.getTime())) return localISO;

    // Resolve timezone: 'auto' means use the OS/browser default.
    const tz = s.timezone && s.timezone !== 'auto' ? s.timezone : undefined;

    // Extract date/time parts in the target timezone using Intl with the
    // resolved timezone, then assemble according to the chosen format tokens.
    const parts = getDateParts(d, tz);

    const datePart = formatDatePart(parts, s.dateFormat);
    const timePart = formatTimePart(parts, s.timeFormat);
    return `${datePart} ${timePart}`;
  } catch {
    return localISO;
  }
}

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;  // 0-23
  minute: number;
}

function getDateParts(d: Date, tz: string | undefined): DateParts {
  // Use Intl.DateTimeFormat with the timezone to get the correct wall-clock parts.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  let hour = parseInt(map.hour ?? '0', 10);
  // Intl with hour12:false can emit '24' for midnight in some engines — normalize.
  if (hour === 24) hour = 0;
  return {
    year: parseInt(map.year ?? '1970', 10),
    month: parseInt(map.month ?? '1', 10),
    day: parseInt(map.day ?? '1', 10),
    hour,
    minute: parseInt(map.minute ?? '0', 10),
  };
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function formatDatePart(p: DateParts, format: AppSettings['dateFormat']): string {
  const mmm = MONTHS_SHORT[p.month - 1] ?? '';
  switch (format) {
    case 'DD MMM YYYY': return `${pad2(p.day)} ${mmm} ${p.year}`;
    case 'MMM DD, YYYY': return `${mmm} ${pad2(p.day)}, ${p.year}`;
    case 'YYYY-MM-DD': return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
    case 'DD/MM/YYYY': return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
    case 'MM/DD/YYYY': return `${pad2(p.month)}/${pad2(p.day)}/${p.year}`;
    default: return `${pad2(p.day)} ${mmm} ${p.year}`;
  }
}

function formatTimePart(p: DateParts, format: AppSettings['timeFormat']): string {
  if (format === '24h') {
    return `${pad2(p.hour)}:${pad2(p.minute)}`;
  }
  // 12h
  const period = p.hour >= 12 ? 'PM' : 'AM';
  let h12 = p.hour % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(p.minute)} ${period}`;
}

/**
 * Compute the current UTC offset text for an IANA timezone, formatted as `UTC±HH:MM`.
 * Returns null when the timezone is invalid or the runtime cannot resolve an offset.
 * Pure with respect to inputs except for the implicit "now" used to resolve DST.
 *
 * Examples: `GMT+8` -> `UTC+08:00`, `GMT+5:30` -> `UTC+05:30`,
 * `GMT` / `UTC` -> `UTC+00:00`, `GMT-5` -> `UTC-05:00`.
 */
export function formatTimezoneOffset(timeZone: string, at?: Date): string | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
    const parts = fmt.formatToParts(at ?? new Date());
    const token = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!token) return null;

    // Strip the GMT/UTC prefix; whatever remains is the signed offset (may be empty).
    const rest = token.replace(/^(?:GMT|UTC)/i, '').trim();

    // A bare prefix (no digits) means offset zero -> UTC+00:00.
    if (rest === '') return 'UTC+00:00';

    const m = rest.match(/^([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!m) return null;

    const sign = m[1];
    const hours = m[2].padStart(2, '0');
    const minutes = (m[3] ?? '00').padStart(2, '0');
    return `UTC${sign}${hours}:${minutes}`;
  } catch {
    return null;
  }
}

/**
 * Build a timezone option's display label: the humanized name, suffixed with the
 * current UTC offset (e.g. `Asia/Singapore (UTC+08:00)`) when it can be resolved,
 * otherwise the name-only label (graceful degradation).
 */
function buildTimezoneLabel(tz: string): string {
  const name = tz.replace(/_/g, ' ');
  const offset = formatTimezoneOffset(tz);
  return offset ? `${name} (${offset})` : name;
}

/** A curated list of common IANA timezones for the settings dropdown, plus "auto". */
export function getTimezoneOptions(): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [
    { value: 'auto', label: 'Automatic (follow device)' },
  ];
  // Try to use Intl.supportedValuesOf if available for a full list; otherwise a curated subset.
  const anyIntl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  if (typeof anyIntl.supportedValuesOf === 'function') {
    try {
      for (const tz of anyIntl.supportedValuesOf('timeZone')) {
        opts.push({ value: tz, label: buildTimezoneLabel(tz) });
      }
      return opts;
    } catch {
      // fall through to curated list
    }
  }
  const curated = [
    'UTC','Asia/Singapore','Asia/Kuala_Lumpur','Asia/Tokyo','Asia/Shanghai','Asia/Kolkata',
    'Asia/Dubai','Europe/London','Europe/Paris','Europe/Berlin','America/New_York',
    'America/Chicago','America/Denver','America/Los_Angeles','Australia/Sydney','Pacific/Auckland',
  ];
  for (const tz of curated) opts.push({ value: tz, label: buildTimezoneLabel(tz) });
  return opts;
}
