// ============================================================
// e-Handkerchief — locateFailure
// Characterization/behaviour test for `classifyLocateFailure` (pure, runs under
// plain node). Compile with tsc, then `node ./src/locateFailure.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { classifyLocateFailure, type LocateFailureReason } from './locateFailure.js';

type Perm = 'granted' | 'denied' | 'prompt' | null;

interface Scenario {
  label: string;
  code: number | null;
  perm: Perm;
  expected: LocateFailureReason;
}

const SCENARIOS: Scenario[] = [
  { label: 'code 1 + denied -> denied', code: 1, perm: 'denied', expected: 'denied' },
  { label: 'code 1 + granted -> off', code: 1, perm: 'granted', expected: 'off' },
  { label: 'code 1 + prompt -> unknown', code: 1, perm: 'prompt', expected: 'unknown' },
  { label: 'code 1 + null -> unknown', code: 1, perm: null, expected: 'unknown' },
  { label: 'code 2 + granted -> unavailable', code: 2, perm: 'granted', expected: 'unavailable' },
  { label: 'code 2 + denied -> unavailable', code: 2, perm: 'denied', expected: 'unavailable' },
  { label: 'code 2 + null -> unavailable', code: 2, perm: null, expected: 'unavailable' },
  { label: 'code 3 + granted -> unavailable', code: 3, perm: 'granted', expected: 'unavailable' },
  { label: 'code 3 + denied -> unavailable', code: 3, perm: 'denied', expected: 'unavailable' },
  { label: 'code 3 + null -> unavailable', code: 3, perm: null, expected: 'unavailable' },
  { label: 'null code + null -> unavailable', code: null, perm: null, expected: 'unavailable' },
  { label: 'null code + granted -> unavailable', code: null, perm: 'granted', expected: 'unavailable' },
];

let failureCount = 0;

function main(): void {
  console.log('Characterization test: locateFailure.classifyLocateFailure');
  for (const s of SCENARIOS) {
    const actual = classifyLocateFailure(s.code, s.perm);
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
