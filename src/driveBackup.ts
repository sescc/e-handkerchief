// ============================================================
// e-Handkerchief — driveBackup
// Whether Google Drive backup is part of this deployment. A fork can opt out by
// setting the repository variable DRIVE_BACKUP to "off"; the deploy workflow
// then injects "off" into config.js (window.__DRIVE_BACKUP__) and the app hides
// Cloud Backup and never talks to Google. Anything else (including unset or
// the unreplaced local-dev value) means enabled.
// ============================================================

/** Pure: only the string "off" (any case, surrounding spaces ignored) disables Drive backup. */
export function isDriveBackupEnabled(value: unknown): boolean {
  return !(typeof value === 'string' && value.trim().toLowerCase() === 'off');
}

/** Reads the deploy-time global set by config.js. */
export function driveBackupEnabled(): boolean {
  return isDriveBackupEnabled((globalThis as { __DRIVE_BACKUP__?: unknown }).__DRIVE_BACKUP__);
}
