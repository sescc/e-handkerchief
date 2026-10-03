// ============================================================
// e-Handkerchief — syncPlan
// Pure decision logic for Google Drive two-way sync. No DOM and no
// imports beyond this file's own types, so it is trivially unit-testable
// and has no hidden dependency on the browser or the network.
//
// Content sync is BASE-AWARE (three-way): a knot's content is only pushed or
// pulled silently when just one side changed since the version both sides
// last agreed on (`base`). When both changed, it is reported as a conflict
// for the user to review — content is never resolved by last-write-wins.
// Check-off state is reconciled separately, on its own clock.
// ============================================================

export interface LocalEntry {
  id: string;
  /** Unix ms of the last CONTENT edit. */
  updatedAt: number;
  /** Unix ms the knot was checked off; null/absent = not checked off. */
  checkedOffAt?: number | null;
  /** Unix ms of the last check/uncheck (the check-off state's own clock); absent = 0. */
  checkOffChangedAt?: number;
}

export interface RemoteEntry {
  fileId: string;
  knotId: string;
  /** Unix ms of the last CONTENT edit, from the file's appProperties. */
  updatedAt: number;
  /** From the file's appProperties; "" / missing -> null. */
  checkedOffAt?: number | null;
  /** From the file's appProperties; missing -> 0. */
  checkOffChangedAt?: number;
}

/** A local check-off change that must be written to the remote file's appProperties. */
export interface CheckOffPush {
  knotId: string;
  fileId: string;
  checkedOffAt: number | null;
  checkOffChangedAt: number;
}

/** A remote check-off change that must be applied to the local knot (those two fields only). */
export interface CheckOffPull {
  knotId: string;
  checkedOffAt: number | null;
  checkOffChangedAt: number;
}

export interface SyncPlan {
  push: string[]; // knot ids
  pull: RemoteEntry[];
  deleteDupes: string[]; // fileIds
  remoteById: Map<string, RemoteEntry>;
  /** Knots whose content changed on both sides since base (or is otherwise inconsistent). Neither pushed nor pulled. */
  conflicts: RemoteEntry[];
  /** Knots whose base should be recorded as this updatedAt (both sides agree). Also resolves a recorded conflict. */
  baseUpdates: { knotId: string; updatedAt: number }[];
  checkOffPush: CheckOffPush[];
  checkOffPull: CheckOffPull[];
}

/**
 * Push guard: true when writing this device's copy of a knot must be REFUSED
 * (recorded as a conflict) because someone else changed the remote file since
 * the version this device last agreed on.
 *
 * - No remote file (`null`): nothing to overwrite -> false.
 * - Remote already equals the local version: nothing would be lost -> false.
 * - With a base: conflict only if the remote moved past it (`remote > base`).
 *   A remote OLDER than base is treated as not changed (-> false, push goes ahead).
 * - Without a base: any differing remote is a conflict.
 *
 * All values are unix ms of the last CONTENT edit.
 */
export function remoteChangedSinceBase(
  remoteUpdatedAt: number | null,
  baseUpdatedAt: number | null,
  localUpdatedAt: number
): boolean {
  if (remoteUpdatedAt === null) return false;
  if (remoteUpdatedAt === localUpdatedAt) return false;
  return baseUpdatedAt !== null ? remoteUpdatedAt > baseUpdatedAt : true;
}

/**
 * Decide what a sync pass should do, given the current local and remote
 * state. Pure and deterministic — no network, no DOM, no clock reads (every
 * timestamp is passed in by the caller).
 *
 * @param local Every knot on this device (id + updatedAt + check-off state).
 * @param remote Every `knot-*.json` file currently in the Drive
 *   appDataFolder, BEFORE de-duplication. Several devices can race and create
 *   more than one file for the same knot; this function reconciles that.
 * @param localTombstones Ids of knots deleted FROM THIS DEVICE. A local
 *   delete must never be undone by a pull, so these ids are never pulled.
 * @param cloudTombstones Map of knotId -> deletedAt for backups removed via
 *   "Manage backups". A push must not re-upload one of these unless the
 *   local knot was edited (updatedAt bumped) after the deletion.
 * @param base knotId -> the content updatedAt this device and Drive last
 *   agreed on. Only knots that have a recorded base appear here.
 * @param pendingJobKnotIds Knots with a pending, in-flight or failed upload
 *   job — i.e. a local edit that never reached Drive.
 * @param conflicted Knots already recorded as in conflict. They are skipped
 *   by push/pull until resolved.
 */
export function planSync(
  local: LocalEntry[],
  remote: RemoteEntry[],
  localTombstones: Set<string>,
  cloudTombstones: Record<string, number>,
  base: Map<string, number> = new Map(),
  pendingJobKnotIds: Set<string> = new Set(),
  conflicted: Set<string> = new Set()
): SyncPlan {
  // --- De-duplicate remote entries by knotId: keep the greatest updatedAt;
  // on a tie, keep the first one seen (stable w.r.t. input order). Every
  // entry that loses out is queued for deletion in `deleteDupes`. ---
  const remoteById = new Map<string, RemoteEntry>();
  const deleteDupes: string[] = [];

  for (const entry of remote) {
    const existing = remoteById.get(entry.knotId);
    if (!existing) {
      remoteById.set(entry.knotId, entry);
      continue;
    }
    if (entry.updatedAt > existing.updatedAt) {
      deleteDupes.push(existing.fileId);
      remoteById.set(entry.knotId, entry);
    } else {
      // Tie or older than the entry already kept — drop this one.
      deleteDupes.push(entry.fileId);
    }
  }

  const localById = new Map<string, LocalEntry>();
  for (const entry of local) localById.set(entry.id, entry);

  const push: string[] = [];
  const pull: RemoteEntry[] = [];
  const conflicts: RemoteEntry[] = [];
  const baseUpdates: { knotId: string; updatedAt: number }[] = [];
  const checkOffPush: CheckOffPush[] = [];
  const checkOffPull: CheckOffPull[] = [];

  /** Push is allowed unless a cloud tombstone at or after this local edit says the backup was deliberately removed. */
  const pushAllowed = (entry: LocalEntry): boolean => {
    const tombstonedAt = cloudTombstones[entry.id];
    return !(tombstonedAt !== undefined && tombstonedAt >= entry.updatedAt);
  };

  // --- Content: knots that exist only locally. ---
  for (const entry of local) {
    if (remoteById.has(entry.id)) continue;
    if (pushAllowed(entry)) push.push(entry.id);
  }

  // --- Content: knots that exist only remotely. Pulled unless this device
  // deliberately deleted that knot. Cloud tombstones are NOT consulted here —
  // a cloud-tombstoned knot still present remotely (shouldn't normally
  // happen) is pulled anyway. ---
  for (const entry of remoteById.values()) {
    if (localById.has(entry.knotId)) continue;
    if (localTombstones.has(entry.knotId)) continue;
    pull.push(entry);
  }

  // --- Content: knots present on both sides. ---
  for (const entry of local) {
    const remoteEntry = remoteById.get(entry.id);
    if (!remoteEntry) continue;

    const l = entry.updatedAt;
    const r = remoteEntry.updatedAt;

    if (localTombstones.has(entry.id)) {
      // Deleted locally yet somehow still present (shouldn't normally
      // happen): never pull; only push a strictly newer local copy.
      if (l > r && pushAllowed(entry)) push.push(entry.id);
      continue;
    }

    if (l === r) {
      // Both sides agree. Also resolves a previously recorded conflict.
      baseUpdates.push({ knotId: entry.id, updatedAt: l });
      continue;
    }

    if (conflicted.has(entry.id)) {
      // Still differing: keep reporting it, never push or pull it.
      conflicts.push(remoteEntry);
      continue;
    }

    const b = base.get(entry.id);
    if (b !== undefined) {
      if (l > b && r === b) {
        if (pushAllowed(entry)) push.push(entry.id);
      } else if (r > b && l === b) {
        pull.push(remoteEntry);
      } else {
        // Both changed since base, or an inconsistent state (e.g. either
        // side older than base): never guess, ask the user.
        conflicts.push(remoteEntry);
      }
      continue;
    }

    // No base recorded (knots that predate base tracking). Before base
    // tracking every local edit either uploaded at once or queued a job, so
    // a newer remote with no job for this knot means the local copy is
    // merely stale. Anything else could lose an edit, so it is reviewed.
    if (r > l && !pendingJobKnotIds.has(entry.id)) {
      pull.push(remoteEntry);
    } else {
      conflicts.push(remoteEntry);
    }
  }

  // --- Check-off: independent of content. For every knot present locally
  // AND remotely, the greater checkOffChangedAt wins. Never looks at
  // updatedAt, tombstones or conflicts, and never affects push/pull. ---
  for (const entry of local) {
    const remoteEntry = remoteById.get(entry.id);
    if (!remoteEntry) continue;
    const lc = entry.checkOffChangedAt ?? 0;
    const rc = remoteEntry.checkOffChangedAt ?? 0;
    if (lc > rc) {
      checkOffPush.push({
        knotId: entry.id,
        fileId: remoteEntry.fileId,
        checkedOffAt: entry.checkedOffAt ?? null,
        checkOffChangedAt: lc,
      });
    } else if (rc > lc) {
      checkOffPull.push({
        knotId: entry.id,
        checkedOffAt: remoteEntry.checkedOffAt ?? null,
        checkOffChangedAt: rc,
      });
    }
  }

  return { push, pull, deleteDupes, remoteById, conflicts, baseUpdates, checkOffPush, checkOffPull };
}
