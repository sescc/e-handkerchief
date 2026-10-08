// ============================================================
// e-Handkerchief — backupStatus
// Pure decision: should a knot show a "not in Google Drive" badge?
// Types-only imports, so it runs under plain node.
// ============================================================

import type { SyncStateRecord } from './types.js';

/** Which badge (if any) a knot shows. */
export type BackupBadge = 'none' | 'not-backed-up' | 'backup-deleted';

export interface BackupStatusInput {
  /** Google Drive is connected. */
  connected: boolean;
  /** This device is uploading this knot right now. */
  uploading: boolean;
  knot: { updatedAt: number };
  /** The knot's sync bookkeeping, if any. */
  state: SyncStateRecord | undefined;
  /** An unfinished (pending / in-flight / failed) upload job exists for it. */
  hasJob: boolean;
}

/**
 * Rules, in order:
 * 1. not connected -> none
 * 2. uploading now -> none (avoids flashing the badge on a just-tied knot)
 * 3. in conflict -> none (the "Also edited on another device" badge covers it)
 * 4. backup deleted in Manage backups and the knot unchanged since -> backup-deleted
 * 5. base equals the knot's version and no unfinished job -> none (backed up)
 * 6. otherwise -> not-backed-up
 */
export function backupStatus(i: BackupStatusInput): BackupBadge {
  if (!i.connected) return 'none';
  if (i.uploading) return 'none';
  if (i.state?.conflict) return 'none';
  if (i.state?.backupDeletedAt !== undefined && i.state.backupDeletedAt >= i.knot.updatedAt) {
    return 'backup-deleted';
  }
  if (i.state?.baseUpdatedAt === i.knot.updatedAt && !i.hasJob) return 'none';
  return 'not-backed-up';
}
