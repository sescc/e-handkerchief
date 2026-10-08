// ============================================================
// e-Handkerchief — CloudSyncService
// Google Drive OAuth2 PKCE integration: automatic two-way sync, a "Manage
// backups" API, and local/cloud delete tombstones so a delete on one device
// never silently resurrects on another.
//
// Content is synced against a per-knot BASE version (see syncPlan.ts): a
// silent push/pull only happens when one side changed; an edit made on two
// devices is recorded as a conflict for the user to review — it is never
// resolved by last-write-wins. Check-off state is separate: it lives in the
// backup file's appProperties and merges on its own clock without touching
// the content version.
// ============================================================

import { settingsStore } from './settingsStore.js';
import { knotStore } from './knotStore.js';
import { openDB, dbPut, dbDelete, dbGetAllByIndex } from './db.js';
import { toastService } from './toastService.js';
import { eventBus } from './eventBus.js';
import { formatKnotTimestamp } from './dateFormat.js';
import { planSync, remoteChangedSinceBase, type LocalEntry, type RemoteEntry } from './syncPlan.js';
import { deviceLabelFromUserAgent } from './deviceLabel.js';
import { backupStatus, type BackupBadge } from './backupStatus.js';
import type { Knot, CloudUploadJob, OAuthToken, TextMediaItem, AudioMediaItem } from './types.js';

// Both values are injected into config.js at deploy time (see deploy.yml).
const runtimeConfig = window as Window &
  typeof globalThis & { __GOOGLE_CLIENT_ID__?: string; __OAUTH_BROKER_URL__?: string };

const GOOGLE_CLIENT_ID = runtimeConfig.__GOOGLE_CLIENT_ID__ ?? '';

/**
 * Owner-operated Worker (oauth-worker/) that adds the client secret to Google
 * token requests. Google "Web application" clients require the secret even
 * with PKCE, and it must never ship in this static bundle.
 */
const OAUTH_BROKER_URL = runtimeConfig.__OAUTH_BROKER_URL__ ?? '';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/** Prefix for knot backup filenames in the Drive app-data folder. */
const DRIVE_FILE_PREFIX = 'knot-';

/**
 * File holding cloud delete tombstones: `{ [knotId]: deletedAt }`. Deliberately
 * does NOT start with `knot-`, so it is never mistaken for a knot backup by
 * the `knot-*.json` filters used everywhere else in this file.
 */
const CLOUD_TOMBSTONES_FILENAME = 'deleted-backups.json';

/** Refresh the access token when it has less than this long left. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

class TokenRefusedError extends Error {}

/** POST JSON to the OAuth broker; returns the parsed body or throws. */
async function callBroker(
  path: '/token' | '/refresh',
  body: Record<string, string>
): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const res = await fetch(`${OAUTH_BROKER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  } | null;
  if (!res.ok || !data || typeof data.access_token !== 'string') {
    // Log Google's error code/description only — never token values.
    console.warn(`OAuth broker ${path} failed (${res.status}):`, data?.error, data?.error_description);
    if (data?.error === 'invalid_grant') throw new TokenRefusedError(data.error);
    throw new Error(`OAuth broker ${path} failed: ${res.status}`);
  }
  return {
    access_token: data.access_token,
    expires_in: data.expires_in ?? 3600,
    refresh_token: data.refresh_token,
  };
}

/** Remove ?code=... (and other OAuth params) from the URL without reloading. */
function stripOAuthParams(): void {
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
}

/**
 * Return a usable access token, refreshing it via the broker when it is about
 * to expire (or when `force` is set after a 401). If Google refuses the refresh
 * token, the connection is cleared and the user is asked to reconnect.
 */
async function getAccessToken(force = false): Promise<string | null> {
  const token = settingsStore.getCurrent().cloudBackupToken;
  if (!token) return null;
  if (!force && token.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
    return token.accessToken;
  }
  if (!token.refreshToken) {
    await expireConnection();
    return null;
  }
  try {
    const data = await callBroker('/refresh', { refresh_token: token.refreshToken });
    const refreshed: OAuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    await settingsStore.save({ cloudBackupToken: refreshed });
    return refreshed.accessToken;
  } catch (err) {
    if (err instanceof TokenRefusedError) {
      await expireConnection();
      return null;
    }
    throw err;
  }
}

async function expireConnection(): Promise<void> {
  await settingsStore.save({ cloudBackupToken: null, cloudBackupProvider: null, cloudAccountEmail: null });
  notifyStatus('disconnected');
  toastService.show('Google Drive session expired — please reconnect');
}

/**
 * Build the Drive file `description`: local date, place, and a short text
 * snippet, joined with ' · '. Each part is omitted when not available.
 */
function buildKnotDescription(knot: Knot): string {
  const parts: string[] = [formatKnotTimestamp(knot.timestamp.localISO)];

  const place = knot.location
    ? (knot.location.resolvedAddress ??
        `${knot.location.latitude.toFixed(5)}, ${knot.location.longitude.toFixed(5)}`)
    : knot.manualLabel && knot.manualLabel.trim().length > 0
    ? knot.manualLabel.trim()
    : null;
  if (place) parts.push(place);

  const firstText = knot.mediaItems.find((m): m is TextMediaItem => m.type === 'text');
  const firstAudioTranscript = knot.mediaItems.find(
    (m): m is AudioMediaItem => m.type === 'audio' && !!m.transcript && m.transcript.trim().length > 0
  );
  const snippetSource = firstText?.content ?? firstAudioTranscript?.transcript;
  if (snippetSource && snippetSource.trim().length > 0) {
    parts.push(snippetSource.trim().slice(0, 80));
  }

  return parts.join(' · ');
}

/**
 * Upsert one knot's backup file. With `existingFileId`, PATCHes that file
 * (metadata must NOT include `parents` — Drive rejects that on update).
 * Without one, POSTs a new file into the appDataFolder.
 */
async function sendKnotToDrive(knot: Knot, existingFileId?: string): Promise<void> {
  const serialized = await knotToJSON(knot);

  // Drive merges appProperties key by key on update: keys we don't send stay
  // as they are. So a content PATCH sends ONLY knotId/updatedAt/editedOn and
  // deliberately NEVER the check-off keys — a stale local check-off value can
  // then never overwrite a newer one made on another device. Only creating a
  // new file writes the check-off keys along with the content.
  const appProperties: Record<string, string> = {
    knotId: knot.id,
    updatedAt: String(knot.updatedAt),
    editedOn: deviceLabelFromUserAgent(navigator.userAgent),
  };
  if (!existingFileId) {
    // An unchecked knot simply omits checkedOffAt (parsed as null).
    if (knot.checkedOffAt != null) appProperties.checkedOffAt = String(knot.checkedOffAt);
    appProperties.checkOffChangedAt = String(knot.checkOffChangedAt ?? 0);
  }

  const metadata: Record<string, unknown> = {
    name: `${DRIVE_FILE_PREFIX}${knot.id}.json`,
    appProperties,
    description: buildKnotDescription(knot),
  };
  if (!existingFileId) {
    metadata.parents = ['appDataFolder'];
  }

  const boundary = `boundary-${Date.now()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    serialized,
    `--${boundary}--`,
  ].join('\r\n');

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&spaces=appDataFolder';

  const res = await driveFetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
}

/** fetch() against the Drive API with auth; refreshes once and retries on 401. */
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (accessToken: string): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${accessToken}` },
    });

  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Google Drive not connected');
  const res = await send(accessToken);
  if (res.status !== 401) return res;

  const retryToken = await getAccessToken(true);
  if (!retryToken) return res;
  return send(retryToken);
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  appProperties?: Record<string, string>;
  description?: string;
}

/** List every file in appDataFolder whose exact name matches (usually 0 or 1, but races can create more). */
async function findExistingFiles(name: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${name}'`,
    fields: 'files(id,name,appProperties,modifiedTime)',
  });
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

/** A file's effective updatedAt: appProperties.updatedAt, falling back to modifiedTime. */
function fileUpdatedAt(f: DriveFile): number {
  const raw = f.appProperties?.updatedAt;
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : new Date(f.modifiedTime).getTime();
}

/** Parse an appProperties `checkedOffAt` value: "" / missing / non-numeric -> null. */
function parseCheckedOffAt(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parse an appProperties `checkOffChangedAt` value: missing / non-numeric -> 0. */
function parseCheckOffChangedAt(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Thrown by `upsertKnot` when the remote copy was edited on another device
 * since this device's base version, so writing would silently overwrite that
 * edit. The conflict has been recorded; the caller must NOT queue a retry.
 */
class ConflictError extends Error {
  constructor(readonly knotId: string) {
    super(`Knot ${knotId} was edited on another device`);
    this.name = 'ConflictError';
  }
}

/** The newest of a set of Drive files for one knot (by effective updatedAt). */
function newestFile(files: DriveFile[]): DriveFile | undefined {
  let target: DriveFile | undefined;
  for (const f of files) {
    if (!target || fileUpdatedAt(f) > fileUpdatedAt(target)) target = f;
  }
  return target;
}

/** Best-effort delete of duplicate backup files for a knot. */
async function deleteDuplicateFiles(files: DriveFile[], keepId: string | undefined): Promise<void> {
  for (const dupe of files.filter((f) => f.id !== keepId)) {
    try {
      await driveFetch(`https://www.googleapis.com/drive/v3/files/${dupe.id}`, { method: 'DELETE' });
    } catch {
      // Best effort — a leftover duplicate will be cleaned up by the next sync.
    }
  }
}

/**
 * Record `updatedAt` as the version this device and Drive agree on for a
 * knot, and clear any recorded conflict (agreement resolves it).
 */
async function setBase(knotId: string, updatedAt: number): Promise<void> {
  await knotStore.putSyncState({ knotId, baseUpdatedAt: updatedAt });
}

/** Number of knots currently awaiting conflict review. */
async function countConflicts(): Promise<number> {
  const states = await knotStore.listSyncStates();
  return states.filter((s) => s.conflict).length;
}

/** Record a conflict for a knot (keeping its base) and tell the app. */
async function recordConflict(knotId: string, fileId: string, remoteUpdatedAt: number): Promise<void> {
  const existing = await knotStore.getSyncState(knotId);
  await knotStore.putSyncState({
    knotId,
    baseUpdatedAt: existing?.baseUpdatedAt ?? null,
    conflict: { fileId, remoteUpdatedAt },
  });
  eventBus.emit('knots:conflicts', { count: await countConflicts() });
}

/**
 * Upsert a knot's backup: find any existing file(s) for it, PATCH the newest
 * (or POST if none exist), and best-effort delete any other duplicates.
 * Internal — does NOT queue a retry job on failure; callers decide that.
 *
 * Conflict guard: if a remote file exists and it was changed by someone else
 * since this device's base version (or there is no base and it differs from
 * this knot), nothing is written; the conflict is recorded and a
 * `ConflictError` thrown. A remote whose updatedAt already equals this knot's
 * is never a conflict (see `remoteChangedSinceBase`).
 *
 * Known leftover race: Drive API v3 has no conditional writes (no
 * ETag/If-Match), so the check and the write cannot be made atomic. Merge
 * (`doSyncAll` step 6) re-runs the same check right before each push, so the
 * only remaining window is the gap between the list call and the write —
 * two devices saving within that gap can both pass. Do NOT use the Drive
 * `version` field as a guard: check-off metadata PATCHes bump it too.
 */
async function upsertKnot(knot: Knot): Promise<void> {
  const existing = await findExistingFiles(`${DRIVE_FILE_PREFIX}${knot.id}.json`);
  const target = newestFile(existing);

  if (target) {
    const remoteU = fileUpdatedAt(target);
    const state = await knotStore.getSyncState(knot.id);
    if (remoteChangedSinceBase(remoteU, state?.baseUpdatedAt ?? null, knot.updatedAt)) {
      await recordConflict(knot.id, target.id, remoteU);
      throw new ConflictError(knot.id);
    }
  }

  await sendKnotToDrive(knot, target?.id);
  await setBase(knot.id, knot.updatedAt);
  await deleteDuplicateFiles(existing, target?.id);
}

/** Find the single `deleted-backups.json` file, if it exists. */
async function findCloudTombstonesFile(): Promise<{ id: string } | null> {
  const files = await findExistingFiles(CLOUD_TOMBSTONES_FILENAME);
  return files[0] ? { id: files[0].id } : null;
}

/** Read the cloud tombstones map. A missing file means no tombstones (`{}`). */
async function readCloudTombstones(): Promise<Record<string, number>> {
  const file = await findCloudTombstonesFile();
  if (!file) return {};
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
  if (!res.ok) return {};
  try {
    const data = (await res.json()) as Record<string, number>;
    return data ?? {};
  } catch {
    return {};
  }
}

/** Upsert-write the cloud tombstones map. */
async function writeCloudTombstones(tombstones: Record<string, number>): Promise<void> {
  const existing = await findCloudTombstonesFile();
  const metadata: Record<string, unknown> = { name: CLOUD_TOMBSTONES_FILENAME };
  if (!existing) metadata.parents = ['appDataFolder'];

  const boundary = `boundary-${Date.now()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(tombstones),
    `--${boundary}--`,
  ].join('\r\n');

  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&spaces=appDataFolder';

  const res = await driveFetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive tombstone write failed: ${res.status}`);
}

export type ConnectionStatus = 'connected' | 'disconnected';

const _statusListeners: Array<(s: ConnectionStatus) => void> = [];

function notifyStatus(s: ConnectionStatus): void {
  for (const l of _statusListeners) l(s);
  // Connecting or disconnecting changes which knots show a backup badge.
  eventBus.emit('backup:changed', undefined);
}

/** Ids of knots this device is uploading right now (in memory only). */
const uploadingIds = new Set<string>();

/** A best-effort nudge for the SW to retry a queued upload via Background Sync. */
function registerCloudSyncBackgroundSync(): void {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) =>
          (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register(
            'cloud-sync'
          )
        )
        .catch(() => {
          // Background Sync isn't supported everywhere (e.g. Safari) — ignore.
        });
    }
  } catch {
    // Feature-detection guard — ignore.
  }
}

export interface BackupEntry {
  fileId: string;
  name: string;
  knotId: string | null;
  updatedAt: number | null;
  modifiedTime: string;
  description: string | null;
  kind: 'knot' | 'old';
  /** Unix ms the knot was checked off (from the file's appProperties), or null if not checked off. */
  checkedOffAt: number | null;
}

export interface CloudSyncServiceAPI {
  getConnectionStatus(): ConnectionStatus;
  onStatusChange(cb: (s: ConnectionStatus) => void): () => void;
  connect(): Promise<void>;
  handleOAuthCallback(code: string): Promise<void>;
  /**
   * Handle Google redirecting back with `?error=...` (e.g. `access_denied`
   * when consent is cancelled): clears the PKCE verifier and the URL params
   * and shows a toast. Never changes the connection status or tokens.
   */
  handleOAuthError(error: string): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Fetch the connected Google account's email via Drive `about.get` (no
   * extra scope needed) and save it. Never throws — logs and returns on any
   * failure, leaving the connection untouched.
   */
  refreshAccountInfo(): Promise<void>;
  /** The connected Google account's email, or null if unknown/not connected. */
  getAccountEmail(): string | null;
  /** Per-save upload path: upsert now, or queue a retry job on any failure. */
  uploadKnot(knot: Knot): Promise<void>;
  /**
   * Retry queued upload jobs (upsert path; does not create new jobs).
   * Resolves with the number of jobs uploaded successfully this run.
   */
  uploadPending(): Promise<number>;
  /**
   * Full two-way sync: push local changes, pull remote changes, reconcile
   * duplicates and check-off state. `conflicts` is the number of knots
   * currently awaiting conflict review after the pass (0 if the sync didn't run).
   */
  syncAll(): Promise<SyncResult>;
  /**
   * Write a knot's check-off state to its Drive backup as a METADATA-ONLY
   * appProperties PATCH. Does nothing if not connected, if the knot has no
   * backup file yet, or if the backup is cloud-tombstoned (a check-off never
   * recreates a deleted backup). Throws on a failed request — callers fire and
   * forget with `.catch`; there is no retry queue, the next full sync reconciles it.
   */
  pushCheckOff(knot: Knot): Promise<void>;
  /** Knots currently awaiting conflict review. */
  listConflicts(): Promise<Array<{ knotId: string; fileId: string; remoteUpdatedAt: number }>>;
  /**
   * Download the newest cloud copy of a knot, for the conflict review screen.
   * Throws if offline, not connected, or the backup no longer exists.
   */
  fetchRemoteKnot(
    knotId: string
  ): Promise<{ knot: Knot; updatedAt: number; editedOn: string | null; fileId: string }>;
  /**
   * Resolve a conflict. Re-reads the cloud copy's updatedAt first; if it
   * differs from `expectedRemoteUpdatedAt` (another device pushed again while
   * the review was open) nothing is written and `{ ok:false, reason:'changed-again' }`
   * is returned. 'local' keeps this device's version (pushed with a fresh
   * updatedAt); 'remote' replaces the local copy with the cloud one; 'both'
   * keeps local AND saves the cloud copy as a NEW knot.
   */
  resolveConflict(
    knotId: string,
    choice: 'local' | 'remote' | 'both',
    expectedRemoteUpdatedAt: number
  ): Promise<{ ok: true } | { ok: false; reason: 'changed-again' }>;
  /** Reset every 'failed' upload job to 'pending' and run a full sync. */
  retryFailed(): Promise<void>;
  /** List every backup file in the Drive appDataFolder (for "Manage backups"). */
  listBackups(): Promise<BackupEntry[]>;
  /** Delete one backup file from Drive; if knotId is given, record a cloud tombstone. */
  deleteBackup(fileId: string, knotId: string | null): Promise<void>;
  /** The plain-language confirm() text for a LOCAL delete, based on connection status. */
  localDeleteConfirmText(): string;
  /**
   * Which of these knots are not in Google Drive, for the "Not backed up" /
   * "Backup deleted" badges. Every badge is 'none' when Drive isn't connected.
   */
  getBackupStatuses(knots: Knot[]): Promise<Map<string, BackupBadge>>;
}

/** What a `syncAll()` pass did. */
export interface SyncResult {
  /** Knots brought in from Drive (content pulls). */
  pulled: number;
  /** Knots backed up to Drive (queued uploads flushed + content pushes). */
  pushed: number;
  /** Knots currently awaiting conflict review after the pass. */
  conflicts: number;
}

let _syncPromise: Promise<SyncResult> | null = null;

export const cloudSyncService: CloudSyncServiceAPI = {
  getConnectionStatus(): ConnectionStatus {
    const token = settingsStore.getCurrent().cloudBackupToken;
    return token ? 'connected' : 'disconnected';
  },

  onStatusChange(cb: (s: ConnectionStatus) => void): () => void {
    _statusListeners.push(cb);
    return () => {
      const i = _statusListeners.indexOf(cb);
      if (i !== -1) _statusListeners.splice(i, 1);
    };
  },

  async connect(): Promise<void> {
    if (!GOOGLE_CLIENT_ID || !OAUTH_BROKER_URL) {
      toastService.show('Google Drive client ID not configured');
      return;
    }
    try {
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      sessionStorage.setItem('pkce_verifier', verifier);

      const redirectUri = `${location.origin}${location.pathname}`;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', DRIVE_SCOPE);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('access_type', 'offline');
      // Without prompt=consent Google omits the refresh token on re-consent.
      authUrl.searchParams.set('prompt', 'consent');

      window.location.href = authUrl.toString();
    } catch {
      toastService.show('Could not connect to Google Drive');
    }
  },

  async handleOAuthCallback(code: string): Promise<void> {
    const verifier = sessionStorage.getItem('pkce_verifier');
    sessionStorage.removeItem('pkce_verifier');
    // Codes are single-use: strip them up front so a reload can't replay one.
    const redirectUri = `${location.origin}${location.pathname}`;
    stripOAuthParams();
    if (!verifier) return;

    try {
      const data = await callBroker('/token', {
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });

      const token: OAuthToken = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? '',
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      await settingsStore.save({
        cloudBackupToken: token,
        cloudBackupProvider: 'google-drive',
      });
      notifyStatus('connected');
      await cloudSyncService.refreshAccountInfo();
      // Kick off a full sync now that we're connected.
      void cloudSyncService.syncAll().catch(() => {});
    } catch {
      toastService.show('Could not connect to Google Drive');
    }
  },

  async handleOAuthError(error: string): Promise<void> {
    // Google redirected back with ?error=... (e.g. the user cancelled consent).
    // Drop the now-useless verifier and the dirty URL; connection state and
    // tokens are deliberately left untouched.
    sessionStorage.removeItem('pkce_verifier');
    stripOAuthParams();
    if (error === 'access_denied') {
      toastService.show('Google Drive connection cancelled');
    } else {
      console.warn('Google OAuth returned an error:', error);
      toastService.show('Could not connect to Google Drive');
    }
  },

  async disconnect(): Promise<void> {
    const token = settingsStore.getCurrent().cloudBackupToken;
    if (token) {
      try {
        // Revoking the refresh token also invalidates its access tokens.
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: token.refreshToken || token.accessToken,
          }).toString(),
        });
      } catch {
        // Ignore revocation errors — always clear locally
      }
    }
    await settingsStore.save({ cloudBackupToken: null, cloudBackupProvider: null, cloudAccountEmail: null });
    notifyStatus('disconnected');
  },

  async refreshAccountInfo(): Promise<void> {
    try {
      const res = await driveFetch(
        'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)'
      );
      if (!res.ok) {
        console.warn(`cloudSyncService: about.get failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { user?: { emailAddress?: unknown; displayName?: unknown } };
      const email = data.user?.emailAddress;
      if (typeof email !== 'string') {
        console.warn('cloudSyncService: about.get response missing user.emailAddress');
        return;
      }
      await settingsStore.save({ cloudAccountEmail: email });
      notifyStatus('connected');
    } catch (err) {
      console.warn('cloudSyncService: failed to refresh account info', err);
    }
  },

  getAccountEmail(): string | null {
    return settingsStore.getCurrent().cloudAccountEmail;
  },

  async uploadKnot(knot: Knot): Promise<void> {
    const token = settingsStore.getCurrent().cloudBackupToken;
    if (!token) return;

    // Mark the knot as "being sent" so its list badge doesn't flash while the
    // upload is in flight.
    uploadingIds.add(knot.id);
    eventBus.emit('backup:changed', undefined);
    try {
      try {
        await upsertKnot(knot);
      } catch (err) {
        // An edit conflict is owned by the review flow now: no retry job (a
        // retry would just hit the same guard), and it isn't an upload failure.
        if (err instanceof ConflictError) return;
        // Queue for retry on any failure — HTTP error, offline, or the OAuth
        // broker being unreachable during a token refresh. Avoid creating a
        // second pending job for the same knot.
        const db = await openDB();
        const pendingJobs = await dbGetAllByIndex<CloudUploadJob>(
          db,
          'cloudUploadJobs',
          'status',
          IDBKeyRange.only('pending')
        );
        const alreadyQueued = pendingJobs.some((j) => j.knotId === knot.id);
        if (!alreadyQueued) {
          const job: CloudUploadJob = {
            id: crypto.randomUUID(),
            knotId: knot.id,
            provider: 'google-drive',
            createdAt: Date.now(),
            attempts: 0,
            lastAttemptAt: null,
            status: 'pending',
          };
          await dbPut(db, 'cloudUploadJobs', job);
          registerCloudSyncBackgroundSync();
        }
        throw err;
      }
    } finally {
      uploadingIds.delete(knot.id);
      eventBus.emit('backup:changed', undefined);
    }
  },

  async uploadPending(): Promise<number> {
    const db = await openDB();
    const jobs = await dbGetAllByIndex<CloudUploadJob>(
      db,
      'cloudUploadJobs',
      'status',
      IDBKeyRange.only('pending')
    );

    const newlyFailed: CloudUploadJob[] = [];
    let uploaded = 0;

    for (const job of jobs) {
      const inFlight: CloudUploadJob = {
        ...job,
        status: 'in-flight',
        attempts: job.attempts + 1,
        lastAttemptAt: Date.now(),
      };
      await dbPut(db, 'cloudUploadJobs', inFlight);

      const knot = await knotStore.get(job.knotId);
      if (!knot) {
        // Knot deleted — remove orphaned job
        await dbDelete(db, 'cloudUploadJobs', job.id);
        continue;
      }

      try {
        // Upsert directly (not via uploadKnot) so a failed retry doesn't
        // enqueue a duplicate job alongside this one.
        await upsertKnot(knot);
        await dbDelete(db, 'cloudUploadJobs', job.id);
        uploaded++;
      } catch (err) {
        if (err instanceof ConflictError) {
          // The conflict now owns this edit; the job would only re-hit the guard.
          await dbDelete(db, 'cloudUploadJobs', job.id);
          continue;
        }
        if (inFlight.attempts >= 3) {
          const failed: CloudUploadJob = { ...inFlight, status: 'failed' };
          await dbPut(db, 'cloudUploadJobs', failed);
          newlyFailed.push(failed);
        } else {
          const retry: CloudUploadJob = { ...inFlight, status: 'pending' };
          await dbPut(db, 'cloudUploadJobs', retry);
        }
      }
    }

    // At most one toast per run, regardless of how many jobs newly failed.
    if (newlyFailed.length === 1) {
      const job = newlyFailed[0]!;
      toastService.showPersistent(
        `Backup failed after 3 attempts — knot ${job.knotId.slice(0, 8)} not backed up. Tap to retry.`,
        () => void cloudSyncService.retryFailed().catch(() => {})
      );
    } else if (newlyFailed.length > 1) {
      toastService.showPersistent(
        `${newlyFailed.length} knots not backed up. Tap to retry.`,
        () => void cloudSyncService.retryFailed().catch(() => {})
      );
    }

    return uploaded;
  },

  async retryFailed(): Promise<void> {
    const db = await openDB();
    const jobs = await dbGetAllByIndex<CloudUploadJob>(
      db,
      'cloudUploadJobs',
      'status',
      IDBKeyRange.only('failed')
    );
    for (const job of jobs) {
      const reset: CloudUploadJob = { ...job, status: 'pending', attempts: 0 };
      await dbPut(db, 'cloudUploadJobs', reset);
    }
    await cloudSyncService.syncAll();
  },

  async syncAll(): Promise<SyncResult> {
    if (_syncPromise) return _syncPromise;

    const token = settingsStore.getCurrent().cloudBackupToken;
    if (!token || !navigator.onLine) {
      return { pulled: 0, pushed: 0, conflicts: 0 };
    }

    const promise = doSyncAll().finally(() => {
      if (_syncPromise === promise) _syncPromise = null;
      // Success or failure: uploads were retried and bases may have changed.
      eventBus.emit('backup:changed', undefined);
    });
    _syncPromise = promise;
    return promise;
  },

  async pushCheckOff(knot: Knot): Promise<void> {
    if (!settingsStore.getCurrent().cloudBackupToken) return;

    const existing = await findExistingFiles(`${DRIVE_FILE_PREFIX}${knot.id}.json`);
    const target = newestFile(existing);
    if (!target) return; // no backup yet — the first upload carries the check-off keys

    // A deleted (tombstoned) backup is never recreated or touched by a check-off.
    const tombstones = await readCloudTombstones();
    const tombstonedAt = tombstones[knot.id];
    if (tombstonedAt !== undefined && tombstonedAt >= knot.updatedAt) return;

    // Metadata-only PATCH. Drive merges appProperties per key, so only the two
    // check-off keys change; null clears a key ("unchecked" -> no checkedOffAt).
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appProperties: {
          checkedOffAt: knot.checkedOffAt != null ? String(knot.checkedOffAt) : null,
          checkOffChangedAt: String(knot.checkOffChangedAt ?? 0),
        },
      }),
    });
    if (!res.ok) throw new Error(`Drive check-off update failed: ${res.status}`);
  },

  async listConflicts(): Promise<Array<{ knotId: string; fileId: string; remoteUpdatedAt: number }>> {
    const states = await knotStore.listSyncStates();
    const out: Array<{ knotId: string; fileId: string; remoteUpdatedAt: number }> = [];
    for (const s of states) {
      if (s.conflict) {
        out.push({ knotId: s.knotId, fileId: s.conflict.fileId, remoteUpdatedAt: s.conflict.remoteUpdatedAt });
      }
    }
    return out;
  },

  async fetchRemoteKnot(
    knotId: string
  ): Promise<{ knot: Knot; updatedAt: number; editedOn: string | null; fileId: string }> {
    if (!settingsStore.getCurrent().cloudBackupToken) throw new Error('Google Drive not connected');
    if (!navigator.onLine) throw new Error('Offline');

    const files = await findExistingFiles(`${DRIVE_FILE_PREFIX}${knotId}.json`);
    const target = newestFile(files);
    if (!target) throw new Error('Cloud backup not found');
    const knot = await downloadKnot(target);
    return {
      knot,
      updatedAt: fileUpdatedAt(target),
      editedOn: target.appProperties?.editedOn ?? null,
      fileId: target.id,
    };
  },

  async resolveConflict(
    knotId: string,
    choice: 'local' | 'remote' | 'both',
    expectedRemoteUpdatedAt: number
  ): Promise<{ ok: true } | { ok: false; reason: 'changed-again' }> {
    if (!settingsStore.getCurrent().cloudBackupToken) throw new Error('Google Drive not connected');

    const files = await findExistingFiles(`${DRIVE_FILE_PREFIX}${knotId}.json`);
    const target = newestFile(files);
    if (!target) throw new Error('Cloud backup not found');

    // Another device pushed again while the review was open: don't overwrite
    // anything. Record the new remote version so the review can be re-opened.
    const remoteU = fileUpdatedAt(target);
    if (remoteU !== expectedRemoteUpdatedAt) {
      await recordConflict(knotId, target.id, remoteU);
      return { ok: false, reason: 'changed-again' };
    }

    const local = await knotStore.get(knotId);
    if (!local) throw new Error('Knot not found on this device');

    // Download BEFORE any write so a failed download leaves everything untouched.
    const remoteKnot = choice === 'local' ? null : await downloadKnot(target);

    if (choice === 'remote') {
      await knotStore.saveFromSync(withCheckOffRule(remoteKnot!, local));
      await setBase(knotId, remoteU);
    } else {
      // 'both' protects the cloud version BEFORE overwriting it. Order:
      //   1. (above) the cloud version is already downloaded;
      //   2. build the copy of it as a brand-new knot: new id, created now,
      //      original timestamp/location/media preserved, check-off state cleared;
      //   3. save the copy LOCALLY. If this fails, nothing has been overwritten
      //      (neither Drive nor the local knot) and the conflict is still recorded;
      //   4. the 'local' half: overwrite the Drive file with this device's version;
      //   5. POST the copy and record its base. If this fails, the copy is
      //      already safe locally as a local-only knot and the next sync pushes it.
      let copy: Knot | null = null;
      if (choice === 'both') {
        const now = Date.now();
        copy = { ...remoteKnot!, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
        delete copy.checkedOffAt;
        delete copy.checkOffChangedAt;
        await knotStore.save(copy); // step 3
      }

      // 'local' half (also the whole of choice 'local'): keep this device's
      // version. A fresh updatedAt (strictly above the cloud's, even under clock
      // skew) makes it the newest content everywhere. Written straight to the
      // existing file with sendKnotToDrive, deliberately bypassing the conflict guard.
      const kept: Knot = { ...local, updatedAt: Math.max(Date.now(), remoteU + 1) };
      await knotStore.save(kept);
      await sendKnotToDrive(kept, target.id);
      await setBase(knotId, kept.updatedAt);
      await deleteDuplicateFiles(files, target.id);

      if (copy) {
        await sendKnotToDrive(copy); // step 5
        await setBase(copy.id, copy.updatedAt);
      }
    }

    eventBus.emit('knots:synced', {
      pulled: choice === 'local' ? 0 : 1,
      pushed: choice === 'remote' ? 0 : choice === 'both' ? 2 : 1,
    });
    eventBus.emit('knots:conflicts', { count: await countConflicts() });
    return { ok: true };
  },

  async listBackups(): Promise<BackupEntry[]> {
    const files = await listAllAppDataFiles();

    const backups: BackupEntry[] = files
      .filter((f) => f.name !== CLOUD_TOMBSTONES_FILENAME)
      .map((f) => {
        const knotId = f.appProperties?.knotId ?? null;
        const isKnot = f.name.startsWith(DRIVE_FILE_PREFIX) && knotId !== null;
        const updatedAtRaw = f.appProperties?.updatedAt;
        const updatedAt =
          isKnot && updatedAtRaw !== undefined && Number.isFinite(Number(updatedAtRaw))
            ? Number(updatedAtRaw)
            : null;
        return {
          fileId: f.id,
          name: f.name,
          knotId: isKnot ? knotId : null,
          updatedAt,
          modifiedTime: f.modifiedTime,
          description: f.description ?? null,
          kind: (isKnot ? 'knot' : 'old') as 'knot' | 'old',
          checkedOffAt: isKnot ? parseCheckedOffAt(f.appProperties?.checkedOffAt) : null,
        };
      });

    backups.sort((a, b) => {
      const aTime = a.updatedAt ?? new Date(a.modifiedTime).getTime();
      const bTime = b.updatedAt ?? new Date(b.modifiedTime).getTime();
      return bTime - aTime; // newest first
    });

    return backups;
  },

  async deleteBackup(fileId: string, knotId: string | null): Promise<void> {
    // Write the cloud tombstone BEFORE deleting the file. If the tombstone
    // write fails, we don't delete the file — throw so the UI shows an
    // error, leaving the backup intact for a retry. Deleting first would
    // risk the opposite failure mode: if the tombstone write then failed,
    // another device holding this knot would re-upload it on its next
    // sync, silently undoing the delete the user just asked for.
    let deletedAt: number | null = null;
    if (knotId) {
      const tombstones = await readCloudTombstones();
      deletedAt = Date.now();
      tombstones[knotId] = deletedAt;
      await writeCloudTombstones(tombstones);
    }

    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Drive delete failed: ${res.status}`);

    // Remember on this device that the knot's backup is gone, so its list badge
    // can say so. Best effort: the Drive delete already succeeded.
    if (knotId && deletedAt !== null) {
      try {
        const existing = await knotStore.getSyncState(knotId);
        await knotStore.putSyncState({
          ...(existing ?? { knotId, baseUpdatedAt: null }),
          knotId,
          backupDeletedAt: deletedAt,
        });
      } catch (err) {
        console.warn('cloudSyncService: failed to record backup deletion for knot', knotId, err);
      }
    }
    eventBus.emit('backup:changed', undefined);
  },

  async getBackupStatuses(knots: Knot[]): Promise<Map<string, BackupBadge>> {
    const result = new Map<string, BackupBadge>();
    if (cloudSyncService.getConnectionStatus() !== 'connected') {
      for (const k of knots) result.set(k.id, 'none');
      return result;
    }
    const [states, jobs] = await Promise.all([knotStore.listSyncStates(), listUnfinishedJobs()]);
    const stateById = new Map(states.map((s) => [s.knotId, s]));
    const jobKnotIds = new Set(jobs.map((j) => j.knotId));
    for (const k of knots) {
      result.set(
        k.id,
        backupStatus({
          connected: true,
          uploading: uploadingIds.has(k.id),
          knot: k,
          state: stateById.get(k.id),
          hasJob: jobKnotIds.has(k.id),
        })
      );
    }
    return result;
  },

  localDeleteConfirmText(): string {
    if (cloudSyncService.getConnectionStatus() === 'connected') {
      return 'Delete this knot from this device? Its cloud backup is kept — you can remove it in Settings › Cloud Backup › Manage backups.';
    }
    return 'Delete this knot from this device? This cannot be undone.';
  },
};

/** List every file in appDataFolder, paginated (pageSize 1000). */
async function listAllAppDataFiles(): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      pageSize: '1000',
      fields: 'nextPageToken,files(id,name,modifiedTime,appProperties,description)',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    const data = (await res.json()) as { nextPageToken?: string; files?: DriveFile[] };
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * The full two-way sync pass. Only ever run through `syncAll()`'s
 * single-flight + preconditions wrapper — never called directly.
 */
async function doSyncAll(): Promise<SyncResult> {
  // 1. Flush any queued retries first so they don't race with the full sync.
  //    Their successes count toward `pushed`.
  const flushed = await cloudSyncService.uploadPending();

  // 2. List ALL appDataFolder files, paginated.
  const files = await listAllAppDataFiles();

  // 3. Knot entries are the `knot-*.json` files with appProperties.knotId + updatedAt.
  const remote: RemoteEntry[] = [];
  for (const f of files) {
    if (!f.name.startsWith(DRIVE_FILE_PREFIX) || !f.name.endsWith('.json')) continue;
    const knotId = f.appProperties?.knotId;
    const updatedAtRaw = f.appProperties?.updatedAt;
    if (!knotId || updatedAtRaw === undefined) {
      console.warn(`cloudSyncService: skipping ${f.name} — missing appProperties`);
      continue;
    }
    const updatedAt = Number(updatedAtRaw);
    if (!Number.isFinite(updatedAt)) {
      console.warn(`cloudSyncService: skipping ${f.name} — non-numeric updatedAt`);
      continue;
    }
    remote.push({
      fileId: f.id,
      knotId,
      updatedAt,
      checkedOffAt: parseCheckedOffAt(f.appProperties?.checkedOffAt),
      checkOffChangedAt: parseCheckOffChangedAt(f.appProperties?.checkOffChangedAt),
    });
  }

  // 4. Local knots + local tombstones + cloud tombstones + sync bookkeeping
  //    (read AFTER uploadPending, which may have set bases or recorded conflicts).
  const [localKnots, localTombstoneRecords, cloudTombstones, syncStates, jobs] = await Promise.all([
    knotStore.listAll(),
    knotStore.listTombstones(),
    readCloudTombstones(),
    knotStore.listSyncStates(),
    listUnfinishedJobs(),
  ]);
  const local: LocalEntry[] = localKnots.map((k) => ({
    id: k.id,
    updatedAt: k.updatedAt,
    checkedOffAt: k.checkedOffAt ?? null,
    checkOffChangedAt: k.checkOffChangedAt ?? 0,
  }));
  const localTombstones = new Set(localTombstoneRecords.map((t) => t.id));

  const base = new Map<string, number>();
  const conflicted = new Set<string>();
  const stateById = new Map(syncStates.map((s) => [s.knotId, s]));
  for (const s of syncStates) {
    if (s.baseUpdatedAt !== null) base.set(s.knotId, s.baseUpdatedAt);
    if (s.conflict) conflicted.add(s.knotId);
  }
  // Knots with a pending, in-flight or failed upload job hold a local edit
  // that never reached Drive.
  const pendingJobKnotIds = new Set(jobs.map((j) => j.knotId));

  const plan = planSync(local, remote, localTombstones, cloudTombstones, base, pendingJobKnotIds, conflicted);

  let pulled = 0;
  let pushed = flushed;
  let checkOffPulled = 0;
  let conflictsCleared = 0;

  // 5. Delete duplicate remote files, best effort — a per-item failure is
  // counted and logged but never aborts the sync.
  for (const fileId of plan.deleteDupes) {
    try {
      await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('cloudSyncService: failed to delete duplicate backup', fileId, err);
    }
  }

  // 6. Push each knot that needs it, upserting onto its existing file (if any).
  //    The plan was built from a listing taken earlier in this merge, so right
  //    before each write we re-list that knot's files and re-run the same
  //    guard as upsertKnot: another device may have pushed in the meantime.
  //    A detected conflict is recorded (and counted via countConflicts()), not
  //    pushed and not a failure.
  const pushedIds: string[] = [];
  const raceConflictIds = new Set<string>();
  for (const knotId of plan.push) {
    const knot = localKnots.find((k) => k.id === knotId);
    if (!knot) continue;
    try {
      const fresh = await findExistingFiles(`${DRIVE_FILE_PREFIX}${knotId}.json`);
      const target = newestFile(fresh);
      const remoteU = target ? fileUpdatedAt(target) : null;
      const baseNow = (await knotStore.getSyncState(knotId))?.baseUpdatedAt ?? null;
      if (target && remoteU !== null && remoteChangedSinceBase(remoteU, baseNow, knot.updatedAt)) {
        await recordConflict(knotId, target.id, remoteU);
        raceConflictIds.add(knotId);
        continue;
      }
      await sendKnotToDrive(knot, target?.id);
      await setBase(knotId, knot.updatedAt);
      if (conflicted.has(knotId)) conflictsCleared++;
      pushed++;
      pushedIds.push(knotId);
    } catch (err) {
      console.warn('cloudSyncService: failed to push knot', knotId, err);
    }
  }

  // 7. Pull each remote entry that needs it.
  for (const entry of plan.pull) {
    try {
      const remoteKnot = await downloadKnot({ id: entry.fileId, appProperties: propsFromEntry(entry) });
      // Check-off comes from the file's appProperties (already overlaid by
      // downloadKnot), or the local values if those are newer — never from
      // the possibly stale JSON body.
      const knot = withCheckOffRule(remoteKnot, await knotStore.get(entry.knotId));
      // saveFromSync deliberately does not emit knot:saved — a pull is not a
      // local edit. knots:synced (below) is how screens learn to reload.
      await knotStore.saveFromSync(knot);
      await setBase(entry.knotId, entry.updatedAt);
      if (conflicted.has(entry.knotId)) conflictsCleared++;
      pulled++;
    } catch (err) {
      console.warn('cloudSyncService: failed to pull knot', entry.knotId, err);
    }
  }

  // 7b. Record agreed versions (also resolves conflicts that became equal).
  for (const u of plan.baseUpdates) {
    try {
      if (conflicted.has(u.knotId)) conflictsCleared++;
      await setBase(u.knotId, u.updatedAt);
    } catch (err) {
      console.warn('cloudSyncService: failed to record base for knot', u.knotId, err);
    }
  }

  // 7c. Record new/continuing conflicts. Neither side was touched.
  const conflictIds = new Set<string>();
  for (const entry of plan.conflicts) {
    conflictIds.add(entry.knotId);
    try {
      await knotStore.putSyncState({
        knotId: entry.knotId,
        baseUpdatedAt: stateById.get(entry.knotId)?.baseUpdatedAt ?? null,
        conflict: { fileId: entry.fileId, remoteUpdatedAt: entry.updatedAt },
      });
    } catch (err) {
      console.warn('cloudSyncService: failed to record conflict for knot', entry.knotId, err);
    }
  }

  // 7d. A recorded conflict whose knot is gone locally or remotely can no
  // longer be reviewed — drop it (a local delete already clears it; this
  // covers a backup deleted in Manage backups). Ones the pass just cleared
  // through push/pull/equality had their record replaced by setBase above.
  const localIds = new Set(localKnots.map((k) => k.id));
  for (const id of conflicted) {
    if (conflictIds.has(id)) continue;
    const stillRecorded = (await knotStore.getSyncState(id))?.conflict;
    if (!stillRecorded) continue;
    if (!localIds.has(id) || !plan.remoteById.has(id)) {
      conflictsCleared++;
      await knotStore.putSyncState({ knotId: id, baseUpdatedAt: stateById.get(id)?.baseUpdatedAt ?? null });
    }
  }

  // 7d2. Remember backups deleted in Manage backups (possibly from another
  // device): a local knot that a cloud tombstone blocks from being pushed and
  // that is not on Drive gets `backupDeletedAt`, so its list badge can say so.
  // Preserves base/conflict and only writes when the value changed. Best
  // effort per item. Pushes/pulls above replaced their records via setBase,
  // which clears the flag; conflict paths may drop it, and the next pass
  // re-marks it.
  for (const knot of localKnots) {
    const tombstonedAt = cloudTombstones[knot.id];
    if (tombstonedAt === undefined || tombstonedAt < knot.updatedAt) continue;
    if (plan.remoteById.has(knot.id)) continue;
    try {
      const current = await knotStore.getSyncState(knot.id);
      if (current?.backupDeletedAt === tombstonedAt) continue;
      await knotStore.putSyncState({
        ...(current ?? { knotId: knot.id, baseUpdatedAt: null }),
        knotId: knot.id,
        backupDeletedAt: tombstonedAt,
      });
    } catch (err) {
      console.warn('cloudSyncService: failed to record backup deletion for knot', knot.id, err);
    }
  }

  // 7e. Check-off: independent of content. Pushes are metadata-only PATCHes;
  // pulls touch only the two check-off fields, via saveFromSync (no event).
  for (const op of plan.checkOffPush) {
    try {
      const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${op.fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appProperties: {
            checkedOffAt: op.checkedOffAt !== null ? String(op.checkedOffAt) : null,
            checkOffChangedAt: String(op.checkOffChangedAt),
          },
        }),
      });
      if (!res.ok) throw new Error(`Drive check-off update failed: ${res.status}`);
    } catch (err) {
      console.warn('cloudSyncService: failed to push check-off for knot', op.knotId, err);
    }
  }
  for (const op of plan.checkOffPull) {
    try {
      // Re-read: the list above may be stale, and a content pull may already
      // have applied this state.
      const current = await knotStore.get(op.knotId);
      if (!current) continue;
      if ((current.checkOffChangedAt ?? 0) >= op.checkOffChangedAt) continue;
      await knotStore.saveFromSync({
        ...current,
        checkedOffAt: op.checkedOffAt,
        checkOffChangedAt: op.checkOffChangedAt,
      });
      checkOffPulled++;
    } catch (err) {
      console.warn('cloudSyncService: failed to apply check-off for knot', op.knotId, err);
    }
  }

  // 8. Clear queued upload jobs for knots that were just pushed successfully,
  // and for knots now in conflict (the conflict owns that local edit).
  const clearJobsFor = new Set<string>([...pushedIds, ...conflictIds, ...raceConflictIds]);
  if (clearJobsFor.size > 0) {
    const db = await openDB();
    for (const job of await listUnfinishedJobs()) {
      if (job.status !== 'in-flight' && clearJobsFor.has(job.knotId)) {
        await dbDelete(db, 'cloudUploadJobs', job.id);
      }
    }
  }

  // 9. Record sync time.
  await settingsStore.save({ lastSyncAt: Date.now() });

  // 10. Notify screens so they can reload pulled knots / check-off changes.
  if (pulled > 0 || checkOffPulled > 0) {
    eventBus.emit('knots:synced', { pulled, pushed });
  }

  // 11. Conflicts: emit the current count when there are any, or when this
  // pass cleared some (so a badge/toast for them can go away).
  const conflicts = await countConflicts();
  if (conflicts > 0 || conflictsCleared > 0) {
    eventBus.emit('knots:conflicts', { count: conflicts });
  }

  return { pulled, pushed, conflicts };
}

/** Upload jobs that hold an edit not yet on Drive: pending, in-flight or failed. */
async function listUnfinishedJobs(): Promise<CloudUploadJob[]> {
  const db = await openDB();
  const groups = await Promise.all(
    (['pending', 'in-flight', 'failed'] as const).map((status) =>
      dbGetAllByIndex<CloudUploadJob>(db, 'cloudUploadJobs', 'status', IDBKeyRange.only(status))
    )
  );
  return groups.flat();
}

/** The subset of appProperties `downloadKnot` needs, rebuilt from a planned RemoteEntry. */
function propsFromEntry(entry: RemoteEntry): Record<string, string> {
  const props: Record<string, string> = {
    knotId: entry.knotId,
    updatedAt: String(entry.updatedAt),
    checkOffChangedAt: String(entry.checkOffChangedAt ?? 0),
  };
  if (entry.checkedOffAt != null) props.checkedOffAt = String(entry.checkedOffAt);
  return props;
}

/**
 * Download and parse one backup file. The check-off fields are then taken from
 * the file's appProperties (authoritative) — never from the JSON body, which
 * can be stale because content writes leave the check-off keys alone.
 */
async function downloadKnot(file: Pick<DriveFile, 'id' | 'appProperties'>): Promise<Knot> {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  const knot = jsonToKnot(await res.text());
  if (!knot) throw new Error('Could not parse downloaded knot');
  knot.checkedOffAt = parseCheckedOffAt(file.appProperties?.checkedOffAt);
  knot.checkOffChangedAt = parseCheckOffChangedAt(file.appProperties?.checkOffChangedAt);
  return knot;
}

/**
 * Check-off merge rule for a knot coming from Drive: take the remote check-off
 * state if its clock is at least as new as the local one, else keep the local.
 */
function withCheckOffRule(remote: Knot, local: Knot | undefined): Knot {
  const localClock = local?.checkOffChangedAt ?? 0;
  if ((remote.checkOffChangedAt ?? 0) >= localClock) return remote;
  return { ...remote, checkedOffAt: local?.checkedOffAt ?? null, checkOffChangedAt: localClock };
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

async function knotToJSON(knot: Knot): Promise<string> {
  const serializedItems = await Promise.all(
    knot.mediaItems.map(async (m): Promise<Record<string, unknown>> => {
      if (m.type === 'text') return { ...m };
      if (m.type === 'audio') {
        return { ...m, blob: await blobToBase64(m.blob), mimeType: m.blob.type };
      }
      // photo or video — both have blob + thumbnailBlob
      return {
        ...m,
        blob: await blobToBase64(m.blob),
        mimeType: m.blob.type,
        thumbnailBlob: await blobToBase64(m.thumbnailBlob),
        thumbnailMimeType: m.thumbnailBlob.type,
      };
    })
  );
  return JSON.stringify({ ...knot, mediaItems: serializedItems });
}

function jsonToKnot(json: string): Knot | null {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const rawItems = (obj['mediaItems'] as Array<Record<string, unknown>>) ?? [];

    const restoredItems = rawItems.map((m) => {
      if (m['type'] === 'text') return m;

      const defaultMimeType =
        m['type'] === 'audio'
          ? 'audio/webm'
          : m['type'] === 'photo'
          ? 'image/jpeg'
          : 'video/mp4';
      const mimeType = typeof m['mimeType'] === 'string' ? (m['mimeType'] as string) : defaultMimeType;

      const restored: Record<string, unknown> = {
        ...m,
        blob: base64ToBlob(m['blob'] as string, mimeType),
      };

      if (typeof m['thumbnailBlob'] === 'string') {
        const thumbMimeType =
          typeof m['thumbnailMimeType'] === 'string' ? (m['thumbnailMimeType'] as string) : 'image/jpeg';
        restored['thumbnailBlob'] = base64ToBlob(m['thumbnailBlob'], thumbMimeType);
      }
      return restored;
    });

    return { ...obj, mediaItems: restoredItems } as unknown as Knot;
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, type: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type });
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
