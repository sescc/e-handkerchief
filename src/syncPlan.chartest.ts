// ============================================================
// e-Handkerchief — syncPlan
// Characterization/behaviour test for `planSync` (INFRASTRUCTURE + FIXTURE).
//
// planSync is pure (no DOM, no network, no clock reads), so it is exercised
// directly under plain `node`. Mirrors the style of router.chartest.ts and
// src/components/timezoneCombobox.proptest.ts: a tiny assertion helper,
// PASS/FAIL per scenario, and a non-zero exit code on failure. Run via `tsc`
// (which emits syncPlan.chartest.js next to this file) then
// `node ./src/syncPlan.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { planSync, type LocalEntry, type RemoteEntry, type SyncPlan } from './syncPlan.js';

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

/** Order-insensitive equality for small string arrays (ids/fileIds). */
function assertSameSet(actual: string[], expected: string[], label: string): void {
  const a = [...actual].sort();
  const b = [...expected].sort();
  const equal = a.length === b.length && a.every((v, i) => v === b[i]);
  assert(equal, `${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** The knotIds a plan's `pull` list covers, order-insensitive. */
function pullKnotIds(pull: RemoteEntry[]): string[] {
  return pull.map((e) => e.knotId);
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
    label: 'local-only knot is pushed, nothing is pulled',
    run: () => {
      const local: LocalEntry[] = [{ id: 'a', updatedAt: 100 }];
      const remote: RemoteEntry[] = [];
      const plan = planSync(local, remote, new Set(), {});
      assertSameSet(plan.push, ['a'], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
      assertSameSet(plan.deleteDupes, [], 'deleteDupes');
    },
  },
  {
    label: 'remote-only knot is pulled, nothing is pushed',
    run: () => {
      const local: LocalEntry[] = [];
      const remote: RemoteEntry[] = [{ fileId: 'f1', knotId: 'b', updatedAt: 100 }];
      const plan = planSync(local, remote, new Set(), {});
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), ['b'], 'pull');
      assert(plan.remoteById.get('b')?.fileId === 'f1', 'remoteById should hold the sole remote entry');
    },
  },
  {
    label: 'local newer than remote -> push, not pull',
    run: () => {
      const local: LocalEntry[] = [{ id: 'c', updatedAt: 200 }];
      const remote: RemoteEntry[] = [{ fileId: 'f2', knotId: 'c', updatedAt: 100 }];
      const plan = planSync(local, remote, new Set(), {});
      assertSameSet(plan.push, ['c'], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
    },
  },
  {
    label: 'remote newer than local -> pull, not push',
    run: () => {
      const local: LocalEntry[] = [{ id: 'd', updatedAt: 100 }];
      const remote: RemoteEntry[] = [{ fileId: 'f3', knotId: 'd', updatedAt: 200 }];
      const plan = planSync(local, remote, new Set(), {});
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), ['d'], 'pull');
    },
  },
  {
    label: 'equal updatedAt -> no-op (neither push nor pull)',
    run: () => {
      const local: LocalEntry[] = [{ id: 'e', updatedAt: 150 }];
      const remote: RemoteEntry[] = [{ fileId: 'f4', knotId: 'e', updatedAt: 150 }];
      const plan = planSync(local, remote, new Set(), {});
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
    },
  },
  {
    label: 'local tombstone blocks pull of an otherwise-newer remote knot',
    run: () => {
      const local: LocalEntry[] = [];
      const remote: RemoteEntry[] = [{ fileId: 'f5', knotId: 'g', updatedAt: 100 }];
      const plan = planSync(local, remote, new Set(['g']), {});
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
      assertSameSet(plan.push, [], 'push');
    },
  },
  {
    label: 'cloud tombstone >= local.updatedAt blocks push',
    run: () => {
      // Equal case: tombstonedAt === local.updatedAt still blocks (">=").
      const localEqual: LocalEntry[] = [{ id: 'h', updatedAt: 100 }];
      const planEqual = planSync(localEqual, [], new Set(), { h: 100 });
      assertSameSet(planEqual.push, [], 'push (tombstonedAt == updatedAt)');

      // Strictly-newer tombstone also blocks.
      const localOlder: LocalEntry[] = [{ id: 'h2', updatedAt: 100 }];
      const planNewer = planSync(localOlder, [], new Set(), { h2: 150 });
      assertSameSet(planNewer.push, [], 'push (tombstonedAt > updatedAt)');
    },
  },
  {
    label: 'cloud tombstone older than local.updatedAt allows push (knot edited again)',
    run: () => {
      const local: LocalEntry[] = [{ id: 'i', updatedAt: 200 }];
      const plan = planSync(local, [], new Set(), { i: 100 });
      assertSameSet(plan.push, ['i'], 'push');
    },
  },
  {
    label: 'duplicates: newest remote entry is kept, others go to deleteDupes; push/pull compare against the kept one',
    run: () => {
      const remote: RemoteEntry[] = [
        { fileId: 'd1', knotId: 'k', updatedAt: 100 },
        { fileId: 'd2', knotId: 'k', updatedAt: 300 }, // newest — kept
        { fileId: 'd3', knotId: 'k', updatedAt: 200 },
      ];
      const local: LocalEntry[] = [{ id: 'k', updatedAt: 250 }]; // between 200 and 300

      const plan = planSync(local, remote, new Set(), {});

      assertSameSet(plan.deleteDupes, ['d1', 'd3'], 'deleteDupes');
      assert(plan.remoteById.get('k')?.fileId === 'd2', 'remoteById should keep the newest (d2)');
      assert(plan.remoteById.size === 1, 'remoteById should have exactly one entry for k');

      // local (250) < kept remote (300) -> pulled, not pushed.
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), ['k'], 'pull');
      assert(plan.pull[0]?.fileId === 'd2', 'pulled entry should be the kept (newest) file');
    },
  },
  {
    label: 'duplicates: a tie keeps the first one seen',
    run: () => {
      const remote: RemoteEntry[] = [
        { fileId: 't1', knotId: 'm', updatedAt: 100 },
        { fileId: 't2', knotId: 'm', updatedAt: 100 }, // tie — first (t1) wins
      ];
      const plan = planSync([], remote, new Set(), {});
      assert(plan.remoteById.get('m')?.fileId === 't1', 'tie should keep the first-seen entry (t1)');
      assertSameSet(plan.deleteDupes, ['t2'], 'deleteDupes');
    },
  },
  {
    label: 'all inputs empty -> an empty plan',
    run: () => {
      const plan: SyncPlan = planSync([], [], new Set(), {});
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
      assertSameSet(plan.deleteDupes, [], 'deleteDupes');
      assert(plan.remoteById.size === 0, 'remoteById should be empty');
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
  console.log('Characterization test: syncPlan.planSync');
  for (const s of SCENARIOS) {
    runScenario(s);
  }
  finish();
}

main();
