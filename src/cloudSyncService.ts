// ============================================================
// e-Handkerchief — CloudSyncService
// Google Drive OAuth2 PKCE integration for note backup/restore.
// ============================================================

import { settingsStore } from './settingsStore.js';
import { noteStore } from './noteStore.js';
import { openDB, dbPut, dbDelete, dbGetAllByIndex } from './db.js';
import { toastService } from './toastService.js';
import type { Note, CloudUploadJob, OAuthToken } from './types.js';

const GOOGLE_CLIENT_ID =
  (
    window as Window &
      typeof globalThis & { __GOOGLE_CLIENT_ID__?: string }
  ).__GOOGLE_CLIENT_ID__ ?? '';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

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
    if (!GOOGLE_CLIENT_ID) {
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

      window.location.href = authUrl.toString();
    } catch {
      toastService.show('Could not connect to Google Drive');
    }
  },

  async handleOAuthCallback(code: string): Promise<void> {
    const verifier = sessionStorage.getItem('pkce_verifier');
    sessionStorage.removeItem('pkce_verifier');
    if (!verifier) return;

    const redirectUri = `${location.origin}${location.pathname}`;
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }).toString(),
      });

      if (!res.ok) {
        toastService.show('Could not connect to Google Drive');
        return;
      }

      const data = await res.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      const token: OAuthToken = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      await settingsStore.save({
        cloudBackupToken: token,
        cloudBackupProvider: 'google-drive',
      });
      notifyStatus('connected');

      // Remove ?code=... from URL without a full page reload
      const clean = `${location.pathname}${location.hash}`;
      history.replaceState(null, '', clean);
    } catch {
      toastService.show('Could not connect to Google Drive');
    }
  },

  async disconnect(): Promise<void> {
    const token = settingsStore.getCurrent().cloudBackupToken;
    if (token) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${token.accessToken}`,
          { method: 'POST' }
        );
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

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&spaces=appDataFolder',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!res.ok) {
      // Queue for retry
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
      throw new Error(`Drive upload failed: ${res.status}`);
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
        await cloudSyncService.uploadNote(note);
        // uploadNote succeeded — remove the pending job
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

    const listRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)',
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );
    if (!listRes.ok) return { imported: 0, skipped: 0 };

    const listData = await listRes.json() as { files: Array<{ id: string; name: string }> };

    for (const file of listData.files) {
      if (!file.name.startsWith('note-') || !file.name.endsWith('.json')) continue;

      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
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
