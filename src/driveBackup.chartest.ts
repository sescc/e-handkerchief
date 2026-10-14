// ============================================================
// e-Handkerchief — driveBackup
// Characterization/behaviour test for `isDriveBackupEnabled` (pure, runs under
// plain node). Compile with tsc, then `node ./src/driveBackup.chartest.js`.
// ============================================================

// Note the `.js` extension per the project's ES2020 module setup.
import { isDriveBackupEnabled, driveBackupEnabled } from './driveBackup.js';

let failureCount = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failureCount++;
    console.error(`FAIL  ${label}${detail ? `  -> ${detail}` : ''}`);
  }
}

function main(): void {
  console.log('Characterization test: driveBackup');

  check("'off' disables", isDriveBackupEnabled('off') === false);
  check("'OFF' disables (case-insensitive)", isDriveBackupEnabled('OFF') === false);
  check("' off ' disables (trimmed)", isDriveBackupEnabled(' off ') === false);
  check("'' (unreplaced / local dev) is enabled", isDriveBackupEnabled('') === true);
  check('undefined (global not set) is enabled', isDriveBackupEnabled(undefined) === true);
  check('null is enabled', isDriveBackupEnabled(null) === true);
  check("'on' is enabled", isDriveBackupEnabled('on') === true);
  check("'false' is NOT treated as off (only 'off' opts out)", isDriveBackupEnabled('false') === true);
  check("'offline' is enabled (exact match only)", isDriveBackupEnabled('offline') === true);
  check('non-string values are enabled', isDriveBackupEnabled(0) === true && isDriveBackupEnabled(false) === true);

  const g = globalThis as { __DRIVE_BACKUP__?: unknown };
  check('driveBackupEnabled: global unset -> enabled', driveBackupEnabled() === true);
  g.__DRIVE_BACKUP__ = 'off';
  check("driveBackupEnabled: global 'off' -> disabled", driveBackupEnabled() === false);
  g.__DRIVE_BACKUP__ = '';
  check("driveBackupEnabled: global '' -> enabled", driveBackupEnabled() === true);
  delete g.__DRIVE_BACKUP__;

  if (failureCount > 0) {
    console.error(`\n${failureCount} case(s) failed.`);
    const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
    if (proc) proc.exitCode = 1;
  } else {
    console.log('\nAll cases passed.');
  }
}

main();
