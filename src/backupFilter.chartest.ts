// ============================================================
// e-Handkerchief — backupFilter
// Characterization/behaviour test for the pure Manage-backups filter (runs
// under plain node). Compile with tsc, then `node ./src/backupFilter.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import {
  filterBackups,
  backupMainLine,
  backupMatchesChips,
  backupFilterSummary,
  BACKUP_CHIPS,
} from './backupFilter.js';
import type { BackupFilterEntry, BackupChipId, BackupChipSelection } from './backupFilter.js';

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
/** Build a chip selection; no arguments = empty = All. */
const sel = (...chips: BackupChipId[]): BackupChipSelection => new Set(chips);

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
    'chips are exactly All, Backup only, Checked off, On device (in that order)',
    same(BACKUP_CHIPS.map((c) => c.label), ['All', 'Backup only', 'Checked off', 'On device']),
  );

  // --- main line ---
  check('main line: description wins', backupMainLine(entries[0], fmt) === entries[0].description);
  check('main line: knot without description uses the formatted time', backupMainLine(entries[3], fmt) === 'Backup from FMT(2026-03-05T10:00:00Z)');
  check('main line: old format fallback', backupMainLine(entries[4], fmt) === 'Old-format backup (note-legacy.json)');

  // --- chips, no text (empty selection = All) ---
  const run = (...chips: BackupChipId[]): string[] => ids(filterBackups(entries, local, '', sel(...chips), fmt));
  check('chip ids: All is not a selectable id, the others are', same(BACKUP_CHIPS.map((c) => c.id), ['all', 'backup-only', 'checked-off', 'on-device']));
  check('empty selection (All) keeps everything, old-format included', same(run(), ['a', 'b', 'c', 'd', 'e', 'f']));
  check('Backup only: knot kind and not on this device', same(run('backup-only'), ['b', 'd', 'f']));
  check('Checked off: checkedOffAt set', same(run('checked-off'), ['c', 'd']));
  check('On device: on this device', same(run('on-device'), ['a', 'c']));
  check('Checked off + Backup only = checked-off backups not on this device', same(run('checked-off', 'backup-only'), ['d']));
  check('Checked off + On device = checked-off knots on this device', same(run('checked-off', 'on-device'), ['c']));
  check('Backup only + On device = every knot backup (either place)', same(run('backup-only', 'on-device'), ['a', 'b', 'c', 'd', 'f']));
  check('all three chips = every checked-off knot backup', same(run('backup-only', 'on-device', 'checked-off'), ['c', 'd']));
  check('selection order does not matter', same(run('on-device', 'checked-off'), run('checked-off', 'on-device')));
  check(
    'old-format entries match only an empty selection',
    backupMatchesChips(entries[4], local, sel()) &&
      !backupMatchesChips(entries[4], local, sel('backup-only')) &&
      !backupMatchesChips(entries[4], local, sel('on-device')) &&
      !backupMatchesChips(entries[4], local, sel('checked-off')) &&
      !backupMatchesChips(entries[4], local, sel('backup-only', 'on-device')) &&
      !backupMatchesChips(entries[4], local, sel('backup-only', 'on-device', 'checked-off')),
  );
  check('checkedOffAt 0 still counts as checked off', backupMatchesChips(entry({ fileId: 'z', checkedOffAt: 0 }), local, sel('checked-off')));
  check('knot-kind entry with no knot id counts as Backup only, never On device', backupMatchesChips(entries[5], local, sel('backup-only')) && !backupMatchesChips(entries[5], local, sel('on-device')));
  check('empty local set: nothing is On device', filterBackups(entries, new Set(), '', sel('on-device'), fmt).length === 0);
  check('empty local set: Backup only = every knot backup', same(ids(filterBackups(entries, new Set(), '', sel('backup-only'), fmt)), ['a', 'b', 'c', 'd', 'f']));
  // --- text filter ---
  check('text: matches the description', same(ids(filterBackups(entries, local, 'dentist', sel(), fmt)), ['b']));
  check('text: ignores case and accents ("cafe" finds "Café")', same(ids(filterBackups(entries, local, 'CAFE', sel(), fmt)), ['a']));
  check('text: every word must match, any order', same(ids(filterBackups(entries, local, 'milk central', sel(), fmt)), ['a']));
  check('text: one missing word -> no match', filterBackups(entries, local, 'milk dentist', sel(), fmt).length === 0);
  check('text: date fragment in the description', same(ids(filterBackups(entries, local, '06 mar', sel(), fmt)), ['c']));
  check('text: matches the fallback main line (no description)', same(ids(filterBackups(entries, local, 'backup from', sel(), fmt)), ['d']));
  check('text: matches the formatted time in the fallback line', same(ids(filterBackups(entries, local, 'FMT', sel(), fmt)), ['d']));
  check('text: matches the old-format fallback line', same(ids(filterBackups(entries, local, 'legacy', sel(), fmt)), ['e']));
  check('text: does not match the "On this device" meta line', filterBackups(entries, local, 'device', sel(), fmt).length === 0);
  check('text: whitespace-only query = no text filter', same(ids(filterBackups(entries, local, '   ', sel(), fmt)), ['a', 'b', 'c', 'd', 'e', 'f']));

  // --- chip + text together ---
  check('chip and text combine (On device + "park")', same(ids(filterBackups(entries, local, 'park', sel('on-device'), fmt)), ['c']));
  check('chip and text combine (Checked off + On device + "park")', same(ids(filterBackups(entries, local, 'park', sel('checked-off', 'on-device'), fmt)), ['c']));
  check('chip and text combine (Backup only + On device + "dentist")', same(ids(filterBackups(entries, local, 'dentist', sel('backup-only', 'on-device'), fmt)), ['b']));
  check('chip and text combine (Backup only + "park" -> none)', filterBackups(entries, local, 'park', sel('backup-only'), fmt).length === 0);
  check('chip and text combine (Checked off + "backup from")', same(ids(filterBackups(entries, local, 'backup from', sel('checked-off'), fmt)), ['d']));

  // --- purity ---
  {
    const before = JSON.stringify(entries);
    filterBackups(entries, local, 'milk', sel('on-device'), fmt);
    check('filtering does not mutate its input', JSON.stringify(entries) === before);
  }
  check('empty list -> empty list', filterBackups([], local, 'x', sel(), fmt).length === 0);

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
