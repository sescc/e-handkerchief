// ============================================================
// e-Handkerchief — backupFilter
// Characterization/behaviour test for the pure Manage-backups filter (runs
// under plain node). Compile with tsc, then `node ./src/backupFilter.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import {
  filterBackups,
  backupMainLine,
  backupMatchesChip,
  backupFilterSummary,
  BACKUP_CHIPS,
} from './backupFilter.js';
import type { BackupFilterEntry } from './backupFilter.js';

let failureCount = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}${detail ? `  -> ${detail}` : ''}`);
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

interface Entry extends BackupFilterEntry {
  fileId: string;
}

function entry(over: Partial<Entry> & { fileId: string }): Entry {
  return {
    name: 'knot-' + over.fileId + '.json',
    knotId: over.fileId,
    modifiedTime: '2026-03-05T10:00:00Z',
    description: null,
    kind: 'knot',
    checkedOffAt: null,
    ...over,
  };
}

/** Stand-in for formatKnotTimestamp: deterministic and recognisable. */
const fmt = (iso: string): string => `FMT(${iso})`;
const ids = (list: Entry[]): string[] => list.map((e) => e.fileId);

function main(): void {
  console.log('Characterization test: backupFilter');

  const entries: Entry[] = [
    entry({ fileId: 'a', description: '04 Mar 2026 · Café Central · Buy milk' }), // local
    entry({ fileId: 'b', description: '05 Mar 2026 · Home office · Call dentist' }), // backup only
    entry({ fileId: 'c', description: '06 Mar 2026 · Park', checkedOffAt: 1000 }), // local + checked off
    entry({ fileId: 'd', checkedOffAt: 2000 }), // backup only, checked off, no description
    entry({ fileId: 'e', kind: 'old', knotId: null, name: 'note-legacy.json' }), // old format
    entry({ fileId: 'f', knotId: null, description: 'No id at all' }), // knot kind without a knot id
  ];
  const local = new Set(['a', 'c']);

  // --- chip labels ---
  check(
    'chips are exactly All, Backup only, Checked off, Local (in that order)',
    same(BACKUP_CHIPS.map((c) => c.label), ['All', 'Backup only', 'Checked off', 'Local']),
  );

  // --- main line ---
  check('main line: description wins', backupMainLine(entries[0], fmt) === entries[0].description);
  check('main line: knot without description uses the formatted time', backupMainLine(entries[3], fmt) === 'Backup from FMT(2026-03-05T10:00:00Z)');
  check('main line: old format fallback', backupMainLine(entries[4], fmt) === 'Old-format backup (note-legacy.json)');

  // --- chips, no text ---
  check('All keeps everything', same(ids(filterBackups(entries, local, '', 'all', fmt)), ['a', 'b', 'c', 'd', 'e', 'f']));
  check('Backup only: knot kind and not on this device', same(ids(filterBackups(entries, local, '', 'backup-only', fmt)), ['b', 'd', 'f']));
  check('Checked off: checkedOffAt set', same(ids(filterBackups(entries, local, '', 'checked-off', fmt)), ['c', 'd']));
  check('Local: on this device', same(ids(filterBackups(entries, local, '', 'local', fmt)), ['a', 'c']));
  check('old-format entries appear only under All', !backupMatchesChip(entries[4], local, 'backup-only') && !backupMatchesChip(entries[4], local, 'local') && !backupMatchesChip(entries[4], local, 'checked-off') && backupMatchesChip(entries[4], local, 'all'));
  check('checkedOffAt 0 still counts as checked off', backupMatchesChip(entry({ fileId: 'z', checkedOffAt: 0 }), local, 'checked-off'));
  check('empty local set: nothing is Local', filterBackups(entries, new Set(), '', 'local', fmt).length === 0);

  // --- text filter ---
  check('text: matches the description', same(ids(filterBackups(entries, local, 'dentist', 'all', fmt)), ['b']));
  check('text: ignores case and accents ("cafe" finds "Café")', same(ids(filterBackups(entries, local, 'CAFE', 'all', fmt)), ['a']));
  check('text: every word must match, any order', same(ids(filterBackups(entries, local, 'milk central', 'all', fmt)), ['a']));
  check('text: one missing word -> no match', filterBackups(entries, local, 'milk dentist', 'all', fmt).length === 0);
  check('text: date fragment in the description', same(ids(filterBackups(entries, local, '06 mar', 'all', fmt)), ['c']));
  check('text: matches the fallback main line (no description)', same(ids(filterBackups(entries, local, 'backup from', 'all', fmt)), ['d']));
  check('text: matches the formatted time in the fallback line', same(ids(filterBackups(entries, local, 'FMT', 'all', fmt)), ['d']));
  check('text: matches the old-format fallback line', same(ids(filterBackups(entries, local, 'legacy', 'all', fmt)), ['e']));
  check('text: does not match the "On this device" meta line', filterBackups(entries, local, 'device', 'all', fmt).length === 0);
  check('text: whitespace-only query = no text filter', same(ids(filterBackups(entries, local, '   ', 'all', fmt)), ['a', 'b', 'c', 'd', 'e', 'f']));

  // --- chip + text together ---
  check('chip and text combine (Local + "park")', same(ids(filterBackups(entries, local, 'park', 'local', fmt)), ['c']));
  check('chip and text combine (Backup only + "park" -> none)', filterBackups(entries, local, 'park', 'backup-only', fmt).length === 0);
  check('chip and text combine (Checked off + "backup from")', same(ids(filterBackups(entries, local, 'backup from', 'checked-off', fmt)), ['d']));

  // --- purity ---
  {
    const before = JSON.stringify(entries);
    filterBackups(entries, local, 'milk', 'local', fmt);
    check('filtering does not mutate its input', JSON.stringify(entries) === before);
  }
  check('empty list -> empty list', filterBackups([], local, 'x', 'all', fmt).length === 0);

  // --- summary line ---
  check('summary: "Showing N of M"', backupFilterSummary(3, 6) === 'Showing 3 of 6');
  check('summary: all shown', backupFilterSummary(6, 6) === 'Showing 6 of 6');
  check('summary: none -> "No backups match"', backupFilterSummary(0, 6) === 'No backups match');

  if (failureCount > 0) {
    console.error(`\n${failureCount} case(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll cases passed.');
  }
}

main();
