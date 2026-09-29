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

/** The knotIds a plan's `conflicts` list covers, order-insensitive. */
function conflictKnotIds(conflicts: RemoteEntry[]): string[] {
  return conflicts.map((e) => e.knotId);
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
    // CHANGED 2026-09-29 (was: 'local newer than remote -> push, not pull' with
    // no base). Newest-wins was rejected by the user; with no recorded base a
    // newer local copy is now a conflict. The push case below supplies a base.
    label: 'local newer than remote, base equals remote -> push, not pull',
    run: () => {
      const local: LocalEntry[] = [{ id: 'c', updatedAt: 200 }];
      const remote: RemoteEntry[] = [{ fileId: 'f2', knotId: 'c', updatedAt: 100 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['c', 100]]));
      assertSameSet(plan.push, ['c'], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
      assertSameSet(conflictKnotIds(plan.conflicts), [], 'conflicts');
    },
  },
  {
    // UNCHANGED expectations (push [], pull ['d']); now passes because no base
    // + remote newer + no pending job -> pull, not because newest wins.
    label: 'remote newer than local (no base, no pending job) -> pull, not push',
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
      assertSameSet(conflictKnotIds(plan.conflicts), [], 'conflicts');
      assert(plan.baseUpdates.length === 0, 'baseUpdates should be empty');
      assert(plan.checkOffPush.length === 0 && plan.checkOffPull.length === 0, 'no check-off ops');
    },
  },

  // ---------------- Base-aware content rules (added 2026-09-29) ----------------
  {
    label: 'both changed since base -> conflict, neither pushed nor pulled',
    run: () => {
      const local: LocalEntry[] = [{ id: 'x', updatedAt: 200 }];
      const remote: RemoteEntry[] = [{ fileId: 'fx', knotId: 'x', updatedAt: 300 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['x', 100]]));
      assertSameSet(conflictKnotIds(plan.conflicts), ['x'], 'conflicts');
      assert(plan.conflicts[0]?.fileId === 'fx' && plan.conflicts[0]?.updatedAt === 300, 'conflict carries the remote entry');
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
    },
  },
  {
    label: 'no base, remote newer, pending job -> conflict (local edit never reached Drive)',
    run: () => {
      const local: LocalEntry[] = [{ id: 'y', updatedAt: 100 }];
      const remote: RemoteEntry[] = [{ fileId: 'fy', knotId: 'y', updatedAt: 200 }];
      const plan = planSync(local, remote, new Set(), {}, new Map(), new Set(['y']));
      assertSameSet(conflictKnotIds(plan.conflicts), ['y'], 'conflicts');
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
    },
  },
  {
    label: 'no base, local newer -> conflict',
    run: () => {
      const local: LocalEntry[] = [{ id: 'z', updatedAt: 200 }];
      const remote: RemoteEntry[] = [{ fileId: 'fz', knotId: 'z', updatedAt: 100 }];
      const plan = planSync(local, remote, new Set(), {});
      assertSameSet(conflictKnotIds(plan.conflicts), ['z'], 'conflicts');
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
    },
  },
  {
    label: 'only local changed since base -> push',
    run: () => {
      const local: LocalEntry[] = [{ id: 'p', updatedAt: 200 }];
      const remote: RemoteEntry[] = [{ fileId: 'fp', knotId: 'p', updatedAt: 100 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['p', 100]]), new Set(['p']));
      assertSameSet(plan.push, ['p'], 'push');
      assertSameSet(conflictKnotIds(plan.conflicts), [], 'conflicts');
    },
  },
  {
    label: 'only remote changed since base -> pull (even with a pending job)',
    run: () => {
      const local: LocalEntry[] = [{ id: 'q', updatedAt: 100 }];
      const remote: RemoteEntry[] = [{ fileId: 'fq', knotId: 'q', updatedAt: 200 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['q', 100]]), new Set(['q']));
      assertSameSet(pullKnotIds(plan.pull), ['q'], 'pull');
      assertSameSet(plan.push, [], 'push');
      assertSameSet(conflictKnotIds(plan.conflicts), [], 'conflicts');
    },
  },
  {
    label: 'inconsistent state (local older than base) -> conflict',
    run: () => {
      const local: LocalEntry[] = [{ id: 'w', updatedAt: 50 }];
      const remote: RemoteEntry[] = [{ fileId: 'fw', knotId: 'w', updatedAt: 200 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['w', 100]]));
      assertSameSet(conflictKnotIds(plan.conflicts), ['w'], 'conflicts');
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
    },
  },
  {
    label: 'equal updatedAt -> baseUpdate (and not a conflict, push or pull)',
    run: () => {
      const local: LocalEntry[] = [{ id: 'e2', updatedAt: 150 }];
      const remote: RemoteEntry[] = [{ fileId: 'fe2', knotId: 'e2', updatedAt: 150 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['e2', 100]]));
      assert(
        plan.baseUpdates.length === 1 && plan.baseUpdates[0]?.knotId === 'e2' && plan.baseUpdates[0]?.updatedAt === 150,
        `baseUpdates: expected [{e2,150}], got ${JSON.stringify(plan.baseUpdates)}`
      );
      assertSameSet(conflictKnotIds(plan.conflicts), [], 'conflicts');
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
    },
  },
  {
    label: 'already-conflicted knot that still differs is skipped from push/pull and stays a conflict',
    run: () => {
      // Local newer than base and remote == base would normally push; being
      // conflicted overrides that.
      const local: LocalEntry[] = [{ id: 'c1', updatedAt: 200 }, { id: 'c2', updatedAt: 100 }];
      const remote: RemoteEntry[] = [
        { fileId: 'fc1', knotId: 'c1', updatedAt: 100 },
        { fileId: 'fc2', knotId: 'c2', updatedAt: 200 },
      ];
      const plan = planSync(
        local,
        remote,
        new Set(),
        {},
        new Map([['c1', 100], ['c2', 100]]),
        new Set(),
        new Set(['c1', 'c2'])
      );
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
      assertSameSet(conflictKnotIds(plan.conflicts), ['c1', 'c2'], 'conflicts');
    },
  },
  {
    label: 'conflicted knot that became equal -> baseUpdate, no longer reported as a conflict',
    run: () => {
      const local: LocalEntry[] = [{ id: 'c3', updatedAt: 300 }];
      const remote: RemoteEntry[] = [{ fileId: 'fc3', knotId: 'c3', updatedAt: 300 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['c3', 100]]), new Set(), new Set(['c3']));
      assert(
        plan.baseUpdates.length === 1 && plan.baseUpdates[0]?.knotId === 'c3' && plan.baseUpdates[0]?.updatedAt === 300,
        `baseUpdates: expected [{c3,300}], got ${JSON.stringify(plan.baseUpdates)}`
      );
      assertSameSet(conflictKnotIds(plan.conflicts), [], 'conflicts');
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
    },
  },
  {
    label: 'base-aware push still respects a cloud tombstone',
    run: () => {
      const local: LocalEntry[] = [{ id: 'ct', updatedAt: 200 }];
      const remote: RemoteEntry[] = [{ fileId: 'fct', knotId: 'ct', updatedAt: 100 }];
      const plan = planSync(local, remote, new Set(), { ct: 250 }, new Map([['ct', 100]]));
      assertSameSet(plan.push, [], 'push');
      assertSameSet(conflictKnotIds(plan.conflicts), [], 'conflicts');
    },
  },

  // ---------------- Check-off reconciliation (added 2026-09-29) ----------------
  {
    label: 'check-off: local newer -> checkOffPush',
    run: () => {
      const local: LocalEntry[] = [{ id: 'k1', updatedAt: 100, checkedOffAt: 500, checkOffChangedAt: 500 }];
      const remote: RemoteEntry[] = [{ fileId: 'fk1', knotId: 'k1', updatedAt: 100, checkedOffAt: null, checkOffChangedAt: 300 }];
      const plan = planSync(local, remote, new Set(), {});
      assert(plan.checkOffPush.length === 1, `expected 1 checkOffPush, got ${plan.checkOffPush.length}`);
      const op = plan.checkOffPush[0]!;
      assert(op.knotId === 'k1' && op.fileId === 'fk1' && op.checkedOffAt === 500 && op.checkOffChangedAt === 500, `bad checkOffPush ${JSON.stringify(op)}`);
      assert(plan.checkOffPull.length === 0, 'no checkOffPull');
    },
  },
  {
    label: 'check-off: local uncheck newer than remote check-off -> checkOffPush with null',
    run: () => {
      const local: LocalEntry[] = [{ id: 'k1u', updatedAt: 100, checkedOffAt: null, checkOffChangedAt: 600 }];
      const remote: RemoteEntry[] = [{ fileId: 'fk1u', knotId: 'k1u', updatedAt: 100, checkedOffAt: 500, checkOffChangedAt: 500 }];
      const plan = planSync(local, remote, new Set(), {});
      assert(plan.checkOffPush.length === 1 && plan.checkOffPush[0]?.checkedOffAt === null && plan.checkOffPush[0]?.checkOffChangedAt === 600, 'expected uncheck push');
    },
  },
  {
    label: 'check-off: remote newer -> checkOffPull (absent local clock counts as 0)',
    run: () => {
      const local: LocalEntry[] = [{ id: 'k2', updatedAt: 100 }];
      const remote: RemoteEntry[] = [{ fileId: 'fk2', knotId: 'k2', updatedAt: 100, checkedOffAt: 700, checkOffChangedAt: 700 }];
      const plan = planSync(local, remote, new Set(), {});
      assert(plan.checkOffPull.length === 1, `expected 1 checkOffPull, got ${plan.checkOffPull.length}`);
      const op = plan.checkOffPull[0]!;
      assert(op.knotId === 'k2' && op.checkedOffAt === 700 && op.checkOffChangedAt === 700, `bad checkOffPull ${JSON.stringify(op)}`);
      assert(plan.checkOffPush.length === 0, 'no checkOffPush');
    },
  },
  {
    label: 'check-off: equal clocks -> no check-off ops',
    run: () => {
      const local: LocalEntry[] = [{ id: 'k3', updatedAt: 100, checkedOffAt: 500, checkOffChangedAt: 500 }];
      const remote: RemoteEntry[] = [{ fileId: 'fk3', knotId: 'k3', updatedAt: 100, checkedOffAt: 500, checkOffChangedAt: 500 }];
      const plan = planSync(local, remote, new Set(), {});
      assert(plan.checkOffPush.length === 0 && plan.checkOffPull.length === 0, 'no check-off ops for equal clocks');
    },
  },
  {
    label: 'check-off change never adds to push/pull and never lifts a cloud tombstone',
    run: () => {
      // Same updatedAt on both sides, newer local check-off, and a cloud tombstone
      // for the knot: the check-off is pushed as metadata only; content is NOT.
      const local: LocalEntry[] = [{ id: 'k4', updatedAt: 100, checkedOffAt: 900, checkOffChangedAt: 900 }];
      const remote: RemoteEntry[] = [{ fileId: 'fk4', knotId: 'k4', updatedAt: 100, checkOffChangedAt: 0 }];
      const plan = planSync(local, remote, new Set(), { k4: 150 }, new Map([['k4', 100]]));
      assertSameSet(plan.push, [], 'push');
      assertSameSet(pullKnotIds(plan.pull), [], 'pull');
      assert(plan.checkOffPush.length === 1, 'check-off still reconciled');

      // Local-only cloud-tombstoned knot with a newer check-off: still not in push.
      const localOnly: LocalEntry[] = [{ id: 'k5', updatedAt: 100, checkedOffAt: 900, checkOffChangedAt: 900 }];
      const plan2 = planSync(localOnly, [], new Set(), { k5: 150 });
      assertSameSet(plan2.push, [], 'push (local-only, tombstoned)');
      assert(plan2.checkOffPush.length === 0, 'no check-off op without a remote file');
    },
  },
  {
    label: 'check-off: knot only local or only remote -> no check-off ops',
    run: () => {
      const local: LocalEntry[] = [{ id: 'lo', updatedAt: 100, checkedOffAt: 500, checkOffChangedAt: 500 }];
      const remote: RemoteEntry[] = [{ fileId: 'fro', knotId: 'ro', updatedAt: 100, checkedOffAt: 500, checkOffChangedAt: 500 }];
      const plan = planSync(local, remote, new Set(), {});
      assert(plan.checkOffPush.length === 0 && plan.checkOffPull.length === 0, 'no check-off ops when only one side has the knot');
      assertSameSet(plan.push, ['lo'], 'push');
      assertSameSet(pullKnotIds(plan.pull), ['ro'], 'pull');
    },
  },
  {
    label: 'check-off: a newer remote check-off survives a content push (pulled locally, never pushed back)',
    run: () => {
      // Base-aware content push (local edited, remote == base) while the remote
      // carries a NEWER check-off. Content push must not carry the stale local
      // check-off; the plan pulls the remote check-off instead.
      const local: LocalEntry[] = [{ id: 'k7', updatedAt: 200, checkedOffAt: null, checkOffChangedAt: 100 }];
      const remote: RemoteEntry[] = [{ fileId: 'fk7', knotId: 'k7', updatedAt: 100, checkedOffAt: 900, checkOffChangedAt: 900 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['k7', 100]]));
      assertSameSet(plan.push, ['k7'], 'push');
      assert(plan.checkOffPull.length === 1 && plan.checkOffPull[0]?.checkedOffAt === 900, 'remote check-off pulled');
      assert(plan.checkOffPush.length === 0, 'stale local check-off is never pushed');
    },
  },
  {
    label: 'check-off reconciles independently for a knot in a content conflict',
    run: () => {
      const local: LocalEntry[] = [{ id: 'k6', updatedAt: 200, checkedOffAt: 800, checkOffChangedAt: 800 }];
      const remote: RemoteEntry[] = [{ fileId: 'fk6', knotId: 'k6', updatedAt: 300, checkOffChangedAt: 0 }];
      const plan = planSync(local, remote, new Set(), {}, new Map([['k6', 100]]));
      assertSameSet(conflictKnotIds(plan.conflicts), ['k6'], 'conflicts');
      assert(plan.checkOffPush.length === 1 && plan.checkOffPush[0]?.knotId === 'k6', 'check-off pushed despite content conflict');
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
