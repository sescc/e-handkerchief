// ============================================================
// e-Handkerchief — mergeMessage
// Characterization/behaviour test for `mergeResultMessage` (pure, runs under
// plain node). Compile with tsc, then `node ./src/mergeMessage.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { mergeResultMessage } from './mergeMessage.js';

interface Scenario {
  label: string;
  pulled: number;
  pushed: number;
  conflicts: number;
  expected: string;
}

const SCENARIOS: Scenario[] = [
  { label: '0/0/0 -> up to date', pulled: 0, pushed: 0, conflicts: 0, expected: 'Already up to date — nothing to merge' },
  { label: '1/0/0 -> singular knot', pulled: 1, pushed: 0, conflicts: 0, expected: 'Merged — 1 knot brought in' },
  { label: '0/1/0 -> backed up only', pulled: 0, pushed: 1, conflicts: 0, expected: 'Merged — 1 backed up' },
  { label: '2/3/0 -> plural knots', pulled: 2, pushed: 3, conflicts: 0, expected: 'Merged — 2 knots brought in, 3 backed up' },
  { label: '0/0/1 -> only conflicts', pulled: 0, pushed: 0, conflicts: 1, expected: 'Merged — 1 needs review' },
  { label: '1/2/2 -> everything, plural review', pulled: 1, pushed: 2, conflicts: 2, expected: 'Merged — 1 knot brought in, 2 backed up, 2 need review' },
];

let failureCount = 0;

function main(): void {
  console.log('Characterization test: mergeMessage.mergeResultMessage');
  for (const s of SCENARIOS) {
    const actual = mergeResultMessage(s.pulled, s.pushed, s.conflicts);
    if (actual === s.expected) {
      console.log(`PASS  ${s.label}`);
    } else {
      failureCount++;
      console.error(`FAIL  ${s.label}  -> expected ${JSON.stringify(s.expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (failureCount > 0) {
    console.error(`\n${failureCount} scenario(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll scenarios passed.');
  }
}

main();
