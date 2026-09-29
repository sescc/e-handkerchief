// ============================================================
// e-Handkerchief — dayCutoff
// Characterization test for `nextCutoffAfter`, `isCheckedOffVisible`,
// `isCheckedOff` and `resolveTimeZone`.
//
// dayCutoff.ts is pure (no DOM, no db/settingsStore imports), so it is
// exercised directly under plain `node`. Mirrors the style of
// knotSummary.chartest.ts: a tiny assertion helper, PASS/FAIL per scenario,
// and a non-zero exit code on failure. Run via `tsc` then
// `node ./src/dayCutoff.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { nextCutoffAfter, isCheckedOffVisible, isCheckedOff, resolveTimeZone } from './dayCutoff.js';

// ------------------------------------------------------------
// Assertion helper
// ------------------------------------------------------------

/** Thrown by `assert` so the runner can distinguish expected failures. */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/** Minimal assertion: throws an AssertionError when `condition` is falsy. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

/** ISO instant -> epoch ms. */
const t = (iso: string): number => Date.parse(iso);

/** Assert that nextCutoffAfter(from) equals the expected ISO instant. */
function assertNext(from: string, cutoff: string, tz: string, expected: string): void {
  const got = new Date(nextCutoffAfter(t(from), cutoff, tz)).toISOString();
  assert(
    got === new Date(t(expected)).toISOString(),
    `nextCutoffAfter(${from}, ${cutoff}, ${tz}) expected ${expected}, got ${got}`
  );
}

// ------------------------------------------------------------
// Scenario table
// ------------------------------------------------------------

interface Scenario {
  label: string;
  run: () => void;
}

const SCENARIOS: Scenario[] = [
  {
    label: 'checked off at 01:00 with a 03:00 cutoff: hides at 03:00 the same day',
    run: () => {
      assertNext('2026-01-15T01:00:00Z', '03:00', 'Europe/London', '2026-01-15T03:00:00Z');
    },
  },
  {
    label: 'checked off at 23:00: hides at 03:00 the next day',
    run: () => {
      assertNext('2026-01-15T23:00:00Z', '03:00', 'Europe/London', '2026-01-16T03:00:00Z');
    },
  },
  {
    label: 'checked off exactly at 03:00: hides at the NEXT day\'s 03:00',
    run: () => {
      assertNext('2026-01-15T03:00:00Z', '03:00', 'Europe/London', '2026-01-16T03:00:00Z');
    },
  },
  {
    label: 'a 00:00 cutoff: next midnight, and exactly midnight rolls to the following one',
    run: () => {
      assertNext('2026-01-15T10:00:00Z', '00:00', 'UTC', '2026-01-16T00:00:00Z');
      assertNext('2026-01-16T00:00:00Z', '00:00', 'UTC', '2026-01-17T00:00:00Z');
    },
  },
  {
    label: 'non-UTC zone: Asia/Singapore (UTC+8) 03:00 local = 19:00Z the previous day',
    run: () => {
      // 2026-01-15T12:00Z = 20:00 SGT on the 15th -> next 03:00 SGT is the 16th = 2026-01-15T19:00Z.
      assertNext('2026-01-15T12:00:00Z', '03:00', 'Asia/Singapore', '2026-01-15T19:00:00Z');
    },
  },
  {
    label: 'Europe/London ordinary DST day: 03:00 BST on 2026-03-29 is 02:00Z',
    run: () => {
      assertNext('2026-03-28T12:00:00Z', '03:00', 'Europe/London', '2026-03-29T02:00:00Z');
    },
  },
  {
    label: 'Europe/London spring-forward GAP: 01:30 does not exist on 2026-03-29 -> first instant after the gap',
    run: () => {
      // Clocks jump 01:00 GMT -> 02:00 BST at 01:00Z; the cutoff resolves to that transition instant.
      assertNext('2026-03-28T12:00:00Z', '01:30', 'Europe/London', '2026-03-29T01:00:00Z');
      // Strictly after: from the transition instant itself, the next day's 01:30 BST (= 00:30Z).
      assertNext('2026-03-29T01:00:00Z', '01:30', 'Europe/London', '2026-03-30T00:30:00Z');
    },
  },
  {
    label: 'Europe/London fall-back OVERLAP: 01:30 occurs twice on 2026-10-25 -> first occurrence (00:30Z)',
    run: () => {
      assertNext('2026-10-24T12:00:00Z', '01:30', 'Europe/London', '2026-10-25T00:30:00Z');
      // Between the two occurrences the first one has passed: next day's 01:30 GMT (= 01:30Z).
      assertNext('2026-10-25T00:45:00Z', '01:30', 'Europe/London', '2026-10-26T01:30:00Z');
    },
  },
  {
    label: 'Pacific/Kiritimati (UTC+14): 03:00 local is 13:00Z the previous UTC day',
    run: () => {
      // 2026-01-15T00:00Z = 14:00 local on the 15th -> next 03:00 local = the 16th = 2026-01-15T13:00Z.
      assertNext('2026-01-15T00:00:00Z', '03:00', 'Pacific/Kiritimati', '2026-01-15T13:00:00Z');
    },
  },
  {
    label: 'Etc/GMT+12 (UTC-12): 03:00 local is 15:00Z',
    run: () => {
      // 2026-01-15T00:00Z = 12:00 local on the 14th -> next 03:00 local = the 15th = 2026-01-15T15:00Z.
      assertNext('2026-01-15T00:00:00Z', '03:00', 'Etc/GMT+12', '2026-01-15T15:00:00Z');
    },
  },
  {
    label: 'malformed cutoff falls back to 03:00',
    run: () => {
      assertNext('2026-01-15T01:00:00Z', 'abc', 'UTC', '2026-01-15T03:00:00Z');
      assertNext('2026-01-15T01:00:00Z', '25:00', 'UTC', '2026-01-15T03:00:00Z');
      assertNext('2026-01-15T01:00:00Z', '', 'UTC', '2026-01-15T03:00:00Z');
    },
  },
  {
    label: 'isCheckedOffVisible: null / undefined checkedOffAt is always visible',
    run: () => {
      const now = t('2026-01-15T12:00:00Z');
      assert(isCheckedOffVisible(null, now, '03:00', 'UTC') === true, 'null should be visible');
      assert(isCheckedOffVisible(undefined, now, '03:00', 'UTC') === true, 'undefined should be visible');
    },
  },
  {
    label: 'isCheckedOffVisible: visible before the cutoff, hidden at and after it',
    run: () => {
      const checkedOffAt = t('2026-01-15T23:00:00Z'); // hides at 2026-01-16T03:00Z
      const before = t('2026-01-16T02:59:59Z');
      const at = t('2026-01-16T03:00:00Z');
      const after = t('2026-01-17T12:00:00Z');
      assert(isCheckedOffVisible(checkedOffAt, before, '03:00', 'UTC') === true, 'visible just before the cutoff');
      assert(isCheckedOffVisible(checkedOffAt, at, '03:00', 'UTC') === false, 'hidden exactly at the cutoff');
      assert(isCheckedOffVisible(checkedOffAt, after, '03:00', 'UTC') === false, 'hidden after the cutoff');
    },
  },
  {
    label: 'isCheckedOff: true only for a numeric checkedOffAt',
    run: () => {
      assert(isCheckedOff({ checkedOffAt: 5 }) === true, 'number is checked off');
      assert(isCheckedOff({ checkedOffAt: null }) === false, 'null is not checked off');
      assert(isCheckedOff({}) === false, 'absent is not checked off');
    },
  },
  {
    label: 'resolveTimeZone: "auto"/empty resolve to the device zone; an IANA name passes through',
    run: () => {
      assert(resolveTimeZone('Asia/Tokyo') === 'Asia/Tokyo', 'IANA name passes through');
      const auto = resolveTimeZone('auto');
      assert(typeof auto === 'string' && auto.length > 0, 'auto resolves to a non-empty zone');
      assert(resolveTimeZone('') === auto && resolveTimeZone(null) === auto, 'empty/null behave like auto');
    },
  },
];

// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------

let failureCount = 0;

function runScenario(s: Scenario): void {
  try {
    s.run();
    console.log(`PASS  ${s.label}`);
  } catch (err) {
    failureCount++;
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`FAIL  ${s.label}  -> ${detail}`);
  }
}

function finish(): void {
  if (failureCount > 0) {
    console.error(`\n${failureCount} scenario(s) failed.`);
    // Prefer process.exitCode over process.exit so pending output flushes.
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll scenarios passed.');
  }
}

function main(): void {
  console.log('Characterization test: dayCutoff.nextCutoffAfter / isCheckedOffVisible');
  for (const s of SCENARIOS) {
    runScenario(s);
  }
  finish();
}

main();
