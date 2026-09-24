// ============================================================
// e-Handkerchief — CloudSyncService
// Google Drive OAuth2 PKCE integration: automatic two-way sync (newest
// updatedAt wins), a "Manage backups" API, and local/cloud delete
// tombstones so a delete on one device never silently resurrects on another.
// ============================================================

import { settingsStore } from './settingsStore.js';
import { knotStore } from './knotStore.js';
import { openDB, dbPut, dbDelete, dbGetAllByIndex } from './db.js';
import { toastService } from './toastService.js';
import { eventBus } from './eventBus.js';
import { formatKnotTimestamp } from './dateFormat.js';
import { planSync, type LocalEntry, type RemoteEntry } from './syncPlan.js';
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

  const metadata: Record<string, unknown> = {
    name: `${DRIVE_FILE_PREFIX}${knot.id}.json`,
    appProperties: { knotId: knot.id, updatedAt: String(knot.updatedAt) },
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

/**
 * Upsert a knot's backup: find any existing file(s) for it, PATCH the newest
 * (or POST if none exist), and best-effort delete any other duplicates.
 * Internal — does NOT queue a retry job on failure; callers decide that.
 */
async function upsertKnot(knot: Knot): Promise<void> {
  const existing = await findExistingFiles(`${DRIVE_FILE_PREFIX}${knot.id}.json`);

  let target: DriveFile | undefined;
  for (const f of existing) {
    if (!target || fileUpdatedAt(f) > fileUpdatedAt(target)) target = f;
  }

  await sendKnotToDrive(knot, target?.id);

  const dupes = existing.filter((f) => f.id !== target?.id);
  for (const dupe of dupes) {
    try {
      await driveFetch(`https://www.googleapis.com/drive/v3/files/${dupe.id}`, { method: 'DELETE' });
    } catch {
      // Best effort — a leftover duplicate will be cleaned up by the next sync.
    }
  }
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
}

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
}

export interface CloudSyncServiceAPI {
  getConnectionStatus(): ConnectionStatus;
  onStatusChange(cb: (s: ConnectionStatus) => void): () => void;
  connect(): Promise<void>;
  handleOAuthCallback(code: string): Promise<void>;
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
  /** Retry queued upload jobs (upsert path; does not create new jobs). */
  uploadPending(): Promise<void>;
  /** Full two-way sync: push local changes, pull remote changes, reconcile duplicates. */
  syncAll(): Promise<{ pulled: number; pushed: number }>;
  /** Reset every 'failed' upload job to 'pending' and run a full sync. */
  retryFailed(): Promise<void>;
  /** List every backup file in the Drive appDataFolder (for "Manage backups"). */
  listBackups(): Promise<BackupEntry[]>;
  /** Delete one backup file from Drive; if knotId is given, record a cloud tombstone. */
  deleteBackup(fileId: string, knotId: string | null): Promise<void>;
  /** The plain-language confirm() text for a LOCAL delete, based on connection status. */
  localDeleteConfirmText(): string;
}

let _syncPromise: Promise<{ pulled: number; pushed: number }> | null = null;

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

    try {
      await upsertKnot(knot);
    } catch (err) {
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
  },

  async uploadPending(): Promise<void> {
    const db = await openDB();
    const jobs = await dbGetAllByIndex<CloudUploadJob>(
      db,
      'cloudUploadJobs',
      'status',
      IDBKeyRange.only('pending')
    );

    const newlyFailed: CloudUploadJob[] = [];

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
      } catch {
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

  async syncAll(): Promise<{ pulled: number; pushed: number }> {
    if (_syncPromise) return _syncPromise;

    const token = settingsStore.getCurrent().cloudBackupToken;
    if (!token || !navigator.onLine) {
      return { pulled: 0, pushed: 0 };
    }

    const promise = doSyncAll().finally(() => {
      if (_syncPromise === promise) _syncPromise = null;
    });
    _syncPromise = promise;
    return promise;
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
    if (knotId) {
      const tombstones = await readCloudTombstones();
      tombstones[knotId] = Date.now();
      await writeCloudTombstones(tombstones);
    }

    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Drive delete failed: ${res.status}`);
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
async function doSyncAll(): Promise<{ pulled: number; pushed: number }> {
  // 1. Flush any queued retries first so they don't race with the full sync.
  await cloudSyncService.uploadPending();

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
    remote.push({ fileId: f.id, knotId, updatedAt });
  }

  // 4. Local knots + local tombstones + cloud tombstones.
  const [localKnots, localTombstoneRecords, cloudTombstones] = await Promise.all([
    knotStore.listAll(),
    knotStore.listTombstones(),
    readCloudTombstones(),
  ]);
  const local: LocalEntry[] = localKnots.map((k) => ({ id: k.id, updatedAt: k.updatedAt }));
  const localTombstones = new Set(localTombstoneRecords.map((t) => t.id));

  const plan = planSync(local, remote, localTombstones, cloudTombstones);

  let pulled = 0;
  let pushed = 0;

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
  const pushedIds: string[] = [];
  for (const knotId of plan.push) {
    const knot = localKnots.find((k) => k.id === knotId);
    if (!knot) continue;
    try {
      const existingFileId = plan.remoteById.get(knotId)?.fileId;
      await sendKnotToDrive(knot, existingFileId);
      pushed++;
      pushedIds.push(knotId);
    } catch (err) {
      console.warn('cloudSyncService: failed to push knot', knotId, err);
    }
  }

  // 7. Pull each remote entry that needs it.
  for (const entry of plan.pull) {
    try {
      const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${entry.fileId}?alt=media`);
      if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
      const json = await res.text();
      const knot = jsonToKnot(json);
      if (!knot) throw new Error('Could not parse downloaded knot');
      // saveFromSync deliberately does not emit knot:saved — a pull is not a
      // local edit. knots:synced (below) is how screens learn to reload.
      await knotStore.saveFromSync(knot);
      pulled++;
    } catch (err) {
      console.warn('cloudSyncService: failed to pull knot', entry.knotId, err);
    }
  }

  // 8. Clear any queued upload jobs for knots that were just pushed successfully.
  if (pushedIds.length > 0) {
    const db = await openDB();
    const [pendingJobs, failedJobs] = await Promise.all([
      dbGetAllByIndex<CloudUploadJob>(db, 'cloudUploadJobs', 'status', IDBKeyRange.only('pending')),
      dbGetAllByIndex<CloudUploadJob>(db, 'cloudUploadJobs', 'status', IDBKeyRange.only('failed')),
    ]);
    for (const job of [...pendingJobs, ...failedJobs]) {
      if (pushedIds.includes(job.knotId)) {
        await dbDelete(db, 'cloudUploadJobs', job.id);
      }
    }
  }

  // 9. Record sync time.
  await settingsStore.save({ lastSyncAt: Date.now() });

  // 10. Notify screens so they can reload pulled knots.
  if (pulled > 0) {
    eventBus.emit('knots:synced', { pulled, pushed });
  }

  return { pulled, pushed };
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
