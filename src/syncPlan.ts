// ============================================================
// e-Handkerchief — syncPlan
// Pure decision logic for Google Drive two-way sync. No DOM and no
// imports beyond this file's own types, so it is trivially unit-testable
// and has no hidden dependency on the browser or the network.
// ============================================================

export interface LocalEntry {
  id: string;
  updatedAt: number;
}

export interface RemoteEntry {
  fileId: string;
  knotId: string;
  updatedAt: number;
}

export interface SyncPlan {
  push: string[]; // knot ids
  pull: RemoteEntry[];
  deleteDupes: string[]; // fileIds
  remoteById: Map<string, RemoteEntry>;
}

/**
 * Decide what a sync pass should do, given the current local and remote
 * state. Pure and deterministic — no network, no DOM, no clock reads (every
 * timestamp is passed in by the caller).
 *
 * @param local Every knot on this device (id + updatedAt).
 * @param remote Every `knot-*.json` file currently in the Drive
 *   appDataFolder (fileId + knotId + updatedAt), BEFORE de-duplication.
 *   Several devices can race and create more than one file for the same
 *   knot; this function reconciles that.
 * @param localTombstones Ids of knots deleted FROM THIS DEVICE. A local
 *   delete must never be undone by a pull, so these ids are never pulled.
 * @param cloudTombstones Map of knotId -> deletedAt for backups removed via
 *   "Manage backups". A push must not re-upload one of these unless the
 *   local knot was edited (updatedAt bumped) after the deletion.
 */
export function planSync(
  local: LocalEntry[],
  remote: RemoteEntry[],
  localTombstones: Set<string>,
  cloudTombstones: Record<string, number>
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

  // --- Push: local knots newer than (or absent from) the deduped remote,
  // unless a cloud tombstone at or after this local edit says the backup
  // was deliberately removed via "Manage backups" and should stay removed. ---
  const push: string[] = [];
  for (const entry of local) {
    const remoteEntry = remoteById.get(entry.id);
    const isNewerOrAbsent = !remoteEntry || entry.updatedAt > remoteEntry.updatedAt;
    if (!isNewerOrAbsent) continue; // remote is newer or equal — no-op

    const tombstonedAt = cloudTombstones[entry.id];
    const blockedByCloudTombstone = tombstonedAt !== undefined && tombstonedAt >= entry.updatedAt;
    if (blockedByCloudTombstone) continue;

    push.push(entry.id);
  }

  // --- Pull: deduped remote entries newer than (or absent from) local,
  // unless this device deliberately deleted that knot locally. Cloud
  // tombstones are NOT consulted here — a cloud-tombstoned knot that is
  // still present remotely (shouldn't normally happen) is pulled anyway. ---
  const pull: RemoteEntry[] = [];
  for (const entry of remoteById.values()) {
    if (localTombstones.has(entry.knotId)) continue;
    const localEntry = localById.get(entry.knotId);
    const isNewerOrAbsent = !localEntry || entry.updatedAt > localEntry.updatedAt;
    if (isNewerOrAbsent) pull.push(entry);
  }

  return { push, pull, deleteDupes, remoteById };
}
