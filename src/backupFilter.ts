// ============================================================
// e-Handkerchief — backupFilter
// Pure filtering of the "Manage backups" list: a text filter plus a multi-select
// of three chips (empty selection = All). No DOM, no settings/db imports, so
// it runs under plain `node`.
// ============================================================

import { queryTokens, normalizeForSearch } from './knotSearch.js';

/** A selectable chip. "All" is not a selection: it is what an empty selection means. */
export type BackupChipId = 'backup-only' | 'checked-off' | 'on-device';
export type BackupChip = 'all' | BackupChipId;

/** The chips, in display order. "All" clears the selection. */
export const BACKUP_CHIPS: ReadonlyArray<{ id: BackupChip; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'backup-only', label: 'Backup only' },
  { id: 'checked-off', label: 'Checked off' },
  { id: 'on-device', label: 'On device' },
];

/** The chips currently on. Empty = All. */
export type BackupChipSelection = ReadonlySet<BackupChipId>;

/** The fields of a cloud backup entry that filtering and the row's main line need. */
export interface BackupFilterEntry {
  name: string;
  knotId: string | null;
  modifiedTime: string;
  description: string | null;
  kind: 'knot' | 'old';
  /** Unix ms the knot was checked off, or null. */
  checkedOffAt: number | null;
}

/**
 * The main line of a backup row: its description, or a fallback. The ONE place
 * this text is built, so the row and the filter can never disagree.
 * `formatTimestamp` is injected (pass `formatKnotTimestamp` from dateFormat.ts).
 */
export function backupMainLine(b: BackupFilterEntry, formatTimestamp: (iso: string) => string): string {
  if (b.description) return b.description;
  return b.kind === 'knot' ? `Backup from ${formatTimestamp(b.modifiedTime)}` : `Old-format backup (${b.name})`;
}

/** True when the backup's knot is on this device. */
function isLocal(b: BackupFilterEntry, localIds: Set<string>): boolean {
  return b.kind === 'knot' && b.knotId !== null && localIds.has(b.knotId);
}

/**
 * Does `b` pass the chip selection?
 * - Empty selection (= All): everything, old-format entries included.
 * - Otherwise old-format entries never match.
 * - The place chips (Backup only, On device) are alternatives: with either or
 *   both on, `b` must match at least one of them.
 * - Checked off is ANDed on top of whatever the place chips say.
 */
export function backupMatchesChips(b: BackupFilterEntry, localIds: Set<string>, selection: BackupChipSelection): boolean {
  if (selection.size === 0) return true;
  if (b.kind !== 'knot') return false;
  const onDevice = isLocal(b, localIds);
  const wantsBackupOnly = selection.has('backup-only');
  const wantsOnDevice = selection.has('on-device');
  if ((wantsBackupOnly || wantsOnDevice) && !((wantsBackupOnly && !onDevice) || (wantsOnDevice && onDevice))) {
    return false;
  }
  if (selection.has('checked-off') && (b.checkedOffAt === null || b.checkedOffAt === undefined)) return false;
  return true;
}

/**
 * Entries that pass the chip selection and whose main line contains every word of
 * `query` (accent- and case-insensitive; an empty or whitespace-only query
 * means no text filter). Keeps the original order.
 */
export function filterBackups<T extends BackupFilterEntry>(
  entries: T[],
  localIds: Set<string>,
  query: string,
  selection: BackupChipSelection,
  formatTimestamp: (iso: string) => string,
): T[] {
  const tokens = queryTokens(query);
  return entries.filter((b) => {
    if (!backupMatchesChips(b, localIds, selection)) return false;
    if (tokens.length === 0) return true;
    const line = normalizeForSearch(backupMainLine(b, formatTimestamp));
    return tokens.every((t) => line.includes(t));
  });
}

/** "Showing N of M" or "No backups match" for the status line under the filter. */
export function backupFilterSummary(shown: number, total: number): string {
  return shown === 0 ? 'No backups match' : `Showing ${shown} of ${total}`;
}
