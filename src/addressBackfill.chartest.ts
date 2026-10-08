// ============================================================
// e-Handkerchief — addressBackfill
// Characterization/behaviour test for the pure helpers in addressBackfill.ts
// (runs under plain node). Compile with tsc, then
// `node ./src/addressBackfill.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { needsAddress, addPending, removePending } from './addressBackfill.js';
import type { Knot, KnotLocation } from './types.js';

function knot(location: KnotLocation | null, manualLabel?: string): Knot {
  return {
    id: 'k1',
    timestamp: { localISO: '2026-01-01T00:00:00.000Z', utcOffset: '+00:00' },
    location,
    manualLabel,
    mediaItems: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

const coords = (resolvedAddress?: string): KnotLocation => ({
  latitude: 1.3,
  longitude: 103.8,
  accuracyMeters: 10,
  resolvedAddress,
});

let failureCount = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}  -> expected ${e}, got ${a}`);
  }
}

function main(): void {
  console.log('Characterization test: addressBackfill');

  check('location null -> false', needsAddress(knot(null)), false);
  check('location null with label -> false', needsAddress(knot(null, 'Home')), false);
  check('address present -> false', needsAddress(knot(coords('1 Main St'))), false);
  check('address whitespace, no label -> true', needsAddress(knot(coords('   '))), true);
  check('address empty string -> true', needsAddress(knot(coords(''))), true);
  check('manualLabel present -> false', needsAddress(knot(coords(undefined), 'Cafe')), false);
  check('manualLabel whitespace -> true', needsAddress(knot(coords(undefined), '  ')), true);
  check('both empty -> true', needsAddress(knot(coords(undefined))), true);

  check('addPending undefined -> [id]', addPending(undefined, 'a'), ['a']);
  check('addPending appends in order', addPending(['a', 'b'], 'c'), ['a', 'b', 'c']);
  check('addPending dedupes', addPending(['a', 'b'], 'a'), ['a', 'b']);
  const original = ['a'];
  addPending(original, 'b');
  check('addPending does not mutate input', original, ['a']);

  check('removePending removes id', removePending(['a', 'b', 'c'], 'b'), ['a', 'c']);
  check('removePending missing id -> unchanged', removePending(['a', 'b'], 'z'), ['a', 'b']);
  check('removePending undefined -> []', removePending(undefined, 'a'), []);

  if (failureCount > 0) {
    console.error(`\n${failureCount} scenario(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll scenarios passed.');
  }
}

main();
