// ============================================================
// e-Handkerchief — CloudSyncService
// Google Drive OAuth2 PKCE integration for note backup/restore.
// ============================================================

import { settingsStore } from './settingsStore.js';
import { noteStore } from './noteStore.js';
import { openDB, dbPut, dbDelete, dbGetAllByIndex } from './db.js';
import { toastService } from './toastService.js';
import type { Note, CloudUploadJob, OAuthToken } from './types.js';

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
  await settingsStore.save({ cloudBackupToken: null, cloudBackupProvider: null });
  notifyStatus('disconnected');
  toastService.show('Google Drive session expired — please reconnect');
}

/** Upload one note to the Drive app-data folder; throws on any failure. */
async function sendNoteToDrive(note: Note): Promise<void> {
  const serialized = await noteToJSON(note);

  // Use multipart upload so we can set both metadata and content in one request
  const metadata = JSON.stringify({
    name: `note-${note.id}.json`,
    parents: ['appDataFolder'],
  });

  const boundary = `boundary-${Date.now()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    serialized,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&spaces=appDataFolder',
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
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

export type ConnectionStatus = 'connected' | 'disconnected';

const _statusListeners: Array<(s: ConnectionStatus) => void> = [];

function notifyStatus(s: ConnectionStatus): void {
  for (const l of _statusListeners) l(s);
}

export interface CloudSyncServiceAPI {
  getConnectionStatus(): ConnectionStatus;
  onStatusChange(cb: (s: ConnectionStatus) => void): () => void;
  connect(): Promise<void>;
  handleOAuthCallback(code: string): Promise<void>;
  disconnect(): Promise<void>;
  uploadNote(note: Note): Promise<void>;
  uploadPending(): Promise<void>;
  importAll(): Promise<{ imported: number; skipped: number }>;
}

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
    await settingsStore.save({ cloudBackupToken: null, cloudBackupProvider: null });
    notifyStatus('disconnected');
  },

  async uploadNote(note: Note): Promise<void> {
    const token = settingsStore.getCurrent().cloudBackupToken;
    if (!token) return;

    try {
      await sendNoteToDrive(note);
    } catch (err) {
      // Queue for retry on any failure — HTTP error, offline, or the OAuth
      // broker being unreachable during a token refresh.
      const db = await openDB();
      const job: CloudUploadJob = {
        id: crypto.randomUUID(),
        noteId: note.id,
        provider: 'google-drive',
        createdAt: Date.now(),
        attempts: 0,
        lastAttemptAt: null,
        status: 'pending',
      };
      await dbPut(db, 'cloudUploadJobs', job);
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

    for (const job of jobs) {
      const inFlight: CloudUploadJob = {
        ...job,
        status: 'in-flight',
        attempts: job.attempts + 1,
        lastAttemptAt: Date.now(),
      };
      await dbPut(db, 'cloudUploadJobs', inFlight);

      const note = await noteStore.get(job.noteId);
      if (!note) {
        // Note deleted — remove orphaned job
        await dbDelete(db, 'cloudUploadJobs', job.id);
        continue;
      }

      try {
        // Upload directly (not via uploadNote) so a failed retry doesn't
        // enqueue a duplicate job alongside this one.
        await sendNoteToDrive(note);
        // Upload succeeded — remove the pending job
        await dbDelete(db, 'cloudUploadJobs', job.id);
      } catch {
        if (inFlight.attempts >= 3) {
          const failed: CloudUploadJob = { ...inFlight, status: 'failed' };
          await dbPut(db, 'cloudUploadJobs', failed);
          toastService.show(
            `Upload failed after 3 attempts — note ${note.id.slice(0, 8)} not backed up`
          );
        } else {
          const retry: CloudUploadJob = { ...inFlight, status: 'pending' };
          await dbPut(db, 'cloudUploadJobs', retry);
        }
      }
    }
  },

  async importAll(): Promise<{ imported: number; skipped: number }> {
    const token = settingsStore.getCurrent().cloudBackupToken;
    if (!token) return { imported: 0, skipped: 0 };

    let imported = 0;
    let skipped = 0;

    const listRes = await driveFetch(
      'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)'
    );
    if (!listRes.ok) return { imported: 0, skipped: 0 };

    const listData = await listRes.json() as { files: Array<{ id: string; name: string }> };

    for (const file of listData.files) {
      if (!file.name.startsWith('note-') || !file.name.endsWith('.json')) continue;

      const dlRes = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
      );
      if (!dlRes.ok) continue;

      const json = await dlRes.text();
      const note = jsonToNote(json);
      if (!note) continue;

      const existing = await noteStore.get(note.id);
      if (existing && existing.createdAt === note.createdAt) {
        skipped++;
        continue;
      }

      await noteStore.save(note);
      imported++;
    }

    return { imported, skipped };
  },
};

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

async function noteToJSON(note: Note): Promise<string> {
  const serializedItems = await Promise.all(
    note.mediaItems.map(async (m): Promise<Record<string, unknown>> => {
      if (m.type === 'text') return { ...m };
      if (m.type === 'audio') {
        return { ...m, blob: await blobToBase64(m.blob) };
      }
      // photo or video — both have blob + thumbnailBlob
      return {
        ...m,
        blob: await blobToBase64(m.blob),
        thumbnailBlob: await blobToBase64(m.thumbnailBlob),
      };
    })
  );
  return JSON.stringify({ ...note, mediaItems: serializedItems });
}

function jsonToNote(json: string): Note | null {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const rawItems = (obj['mediaItems'] as Array<Record<string, unknown>>) ?? [];

    const restoredItems = rawItems.map((m) => {
      if (m['type'] === 'text') return m;

      const mimeType =
        m['type'] === 'audio'
          ? 'audio/webm'
          : m['type'] === 'photo'
          ? 'image/jpeg'
          : 'video/mp4';

      const restored: Record<string, unknown> = {
        ...m,
        blob: base64ToBlob(m['blob'] as string, mimeType),
      };

      if (typeof m['thumbnailBlob'] === 'string') {
        restored['thumbnailBlob'] = base64ToBlob(m['thumbnailBlob'], 'image/jpeg');
      }
      return restored;
    });

    return { ...obj, mediaItems: restoredItems } as unknown as Note;
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
