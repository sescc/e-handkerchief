// ============================================================
// e-Handkerchief — backupFilter
// Pure filtering of the "Manage backups" list: a text filter plus one of four
// chips. No DOM, no settings/db imports, so it runs under plain `node`.
// ============================================================

import { queryTokens, normalizeForSearch } from './knotSearch.js';

export type BackupChip = 'all' | 'backup-only' | 'checked-off' | 'local';

/** The chips, in display order. */
export const BACKUP_CHIPS: ReadonlyArray<{ id: BackupChip; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'backup-only', label: 'Backup only' },
  { id: 'checked-off', label: 'Checked off' },
  { id: 'local', label: 'Local' },
];

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

/** Does `b` belong under `chip`? Old-format entries belong only under "All". */
export function backupMatchesChip(b: BackupFilterEntry, localIds: Set<string>, chip: BackupChip): boolean {
  switch (chip) {
    case 'all':
      return true;
    case 'backup-only':
      return b.kind === 'knot' && !isLocal(b, localIds);
    case 'checked-off':
      return b.checkedOffAt !== null && b.checkedOffAt !== undefined;
    case 'local':
      return isLocal(b, localIds);
  }
}

/**
 * Entries that pass the chip and whose main line contains every word of
 * `query` (accent- and case-insensitive; an empty or whitespace-only query
 * means no text filter). Keeps the original order.
 */
export function filterBackups<T extends BackupFilterEntry>(
  entries: T[],
  localIds: Set<string>,
  query: string,
  chip: BackupChip,
  formatTimestamp: (iso: string) => string,
): T[] {
  const tokens = queryTokens(query);
  return entries.filter((b) => {
    if (!backupMatchesChip(b, localIds, chip)) return false;
    if (tokens.length === 0) return true;
    const line = normalizeForSearch(backupMainLine(b, formatTimestamp));
    return tokens.every((t) => line.includes(t));
  });
}

/** "Showing N of M" or "No backups match" for the status line under the filter. */
export function backupFilterSummary(shown: number, total: number): string {
  return shown === 0 ? 'No backups match' : `Showing ${shown} of ${total}`;
}
