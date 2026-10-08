// ============================================================
// e-Handkerchief — backupStatus
// Characterization/behaviour test for `backupStatus` (pure, runs under plain
// node). Compile with tsc, then `node ./src/backupStatus.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { backupStatus } from './backupStatus.js';
import type { BackupBadge, BackupStatusInput } from './backupStatus.js';
import type { SyncStateRecord } from './types.js';

let failureCount = 0;
let passCount = 0;

function check(label: string, actual: BackupBadge, expected: BackupBadge): void {
  if (actual === expected) {
    passCount++;
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}  -> expected ${expected}, got ${actual}`);
  }
}

const U = 1000; // the knot's updatedAt

function input(over: Partial<BackupStatusInput> & { state?: SyncStateRecord | undefined }): BackupStatusInput {
  return {
    connected: true,
    uploading: false,
    knot: { updatedAt: U },
    state: { knotId: 'k', baseUpdatedAt: U },
    hasJob: false,
    ...over,
  };
}

const backedUp: SyncStateRecord = { knotId: 'k', baseUpdatedAt: U };
const conflict: SyncStateRecord = {
  knotId: 'k',
  baseUpdatedAt: 500,
  conflict: { fileId: 'f', remoteUpdatedAt: 2000 },
};

function main(): void {
  console.log('Characterization test: backupStatus');

  // Rule 1
  check('1 not connected -> none', backupStatus(input({ connected: false, state: undefined })), 'none');
  check('1 not connected beats everything', backupStatus(input({
    connected: false, uploading: true, hasJob: true, state: { ...conflict, backupDeletedAt: U },
  })), 'none');

  // Rule 2
  check('2 uploading, never synced -> none', backupStatus(input({ uploading: true, state: undefined })), 'none');
  check('2 uploading beats backup-deleted', backupStatus(input({
    uploading: true, state: { knotId: 'k', baseUpdatedAt: null, backupDeletedAt: U + 5 },
  })), 'none');
  check('2 uploading beats not-backed-up with a job', backupStatus(input({ uploading: true, hasJob: true })), 'none');

  // Rule 3
  check('3 conflict -> none', backupStatus(input({ state: conflict })), 'none');
  check('3 conflict beats backup-deleted', backupStatus(input({
    state: { ...conflict, backupDeletedAt: U + 5 },
  })), 'none');
  check('3 conflict with a job -> none', backupStatus(input({ state: conflict, hasJob: true })), 'none');

  // Rule 4
  check('4 backup deleted after the edit -> backup-deleted', backupStatus(input({
    state: { knotId: 'k', baseUpdatedAt: U, backupDeletedAt: U + 5 },
  })), 'backup-deleted');
  check('4 backup deleted at the same time as updatedAt -> backup-deleted', backupStatus(input({
    state: { knotId: 'k', baseUpdatedAt: U, backupDeletedAt: U },
  })), 'backup-deleted');
  check('4 backup-deleted beats a matching base', backupStatus(input({
    state: { knotId: 'k', baseUpdatedAt: U, backupDeletedAt: U + 1 }, hasJob: false,
  })), 'backup-deleted');
  check('4 deleted then knot edited later -> not-backed-up', backupStatus(input({
    knot: { updatedAt: U + 10 }, state: { knotId: 'k', baseUpdatedAt: U, backupDeletedAt: U + 5 },
  })), 'not-backed-up');
  check('4 backupDeletedAt 0 still counts when updatedAt is 0', backupStatus(input({
    knot: { updatedAt: 0 }, state: { knotId: 'k', baseUpdatedAt: null, backupDeletedAt: 0 },
  })), 'backup-deleted');

  // Rule 5
  check('5 base equals updatedAt, no job -> none', backupStatus(input({ state: backedUp })), 'none');
  check('5 base equals updatedAt but a job exists -> not-backed-up', backupStatus(input({
    state: backedUp, hasJob: true,
  })), 'not-backed-up');

  // Rule 6
  check('6 no state at all -> not-backed-up', backupStatus(input({ state: undefined })), 'not-backed-up');
  check('6 base null (no base yet) -> not-backed-up', backupStatus(input({
    state: { knotId: 'k', baseUpdatedAt: null },
  })), 'not-backed-up');
  check('6 base older than the knot (edited since) -> not-backed-up', backupStatus(input({
    knot: { updatedAt: U + 1 }, state: backedUp,
  })), 'not-backed-up');
  check('6 base newer than the knot -> not-backed-up', backupStatus(input({
    knot: { updatedAt: U - 1 }, state: backedUp,
  })), 'not-backed-up');
  check('6 no state with a job -> not-backed-up', backupStatus(input({ state: undefined, hasJob: true })), 'not-backed-up');

  if (failureCount > 0) {
    console.error(`\n${failureCount} check(s) failed, ${passCount} passed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
    return;
  }
  console.log(`\nAll ${passCount} checks passed.`);
}

main();
