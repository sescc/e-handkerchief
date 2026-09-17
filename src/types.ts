// ============================================================
// e-Handkerchief — shared TypeScript interfaces
// ============================================================

export interface NoteTimestamp {
  /** ISO 8601 local time, e.g. "2024-07-04T14:30:00+01:00" */
  localISO: string;
  /** UTC offset string, e.g. "+01:00" */
  utcOffset: string;
}

export interface NoteLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  /** Human-readable address, up to 100 characters. Absent if reverse-geocoding failed. */
  resolvedAddress?: string;
}

export type MediaItemType = 'audio' | 'photo' | 'video' | 'text';

export interface MediaItemBase {
  /** UUID v4 */
  id: string;
  type: MediaItemType;
  createdAt: number;
}

export interface AudioMediaItem extends MediaItemBase {
  type: 'audio';
  blob: Blob;
  durationSeconds: number;
  /** Transcript text for THIS audio clip (live-captured, remote, or hand-edited). */
  transcript?: string;
  /** Transcription lifecycle for THIS audio clip. */
  transcriptionStatus?: 'none' | 'live' | 'pending' | 'done' | 'failed';
}

export interface PhotoMediaItem extends MediaItemBase {
  type: 'photo';
  blob: Blob;
  widthPx: number;
  heightPx: number;
  /** 80×80 JPEG thumbnail */
  thumbnailBlob: Blob;
}

export interface VideoMediaItem extends MediaItemBase {
  type: 'video';
  blob: Blob;
  durationSeconds: number;
  /** First-frame JPEG thumbnail, min 80×80 */
  thumbnailBlob: Blob;
}

export interface TextMediaItem extends MediaItemBase {
  type: 'text';
  /** 1–2000 characters */
  content: string;
}

export type MediaItem = AudioMediaItem | PhotoMediaItem | VideoMediaItem | TextMediaItem;

export interface Note {
  /** UUID v4 */
  id: string;
  timestamp: NoteTimestamp;
  location: NoteLocation | null;
  /** Manually-entered location label used when there are no GPS coordinates (note.location is null). Plain text, no map link. */
  manualLabel?: string;
  mediaItems: MediaItem[];
  /** @deprecated Legacy note-level transcription; new code uses per-AudioMediaItem transcript. Retained for backward compatibility with old notes. */
  transcription?: string;
  /** @deprecated Legacy note-level transcription; new code uses per-AudioMediaItem transcript. Retained for backward compatibility with old notes. */
  transcriptionStatus?: 'none' | 'live' | 'pending' | 'done' | 'failed';
  /** Unix ms — used for Journal sort order */
  createdAt: number;
  updatedAt: number;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  /** Unix ms */
  expiresAt: number;
}

export interface AppSettings {
  transcriptionEnabled: boolean;
  /** URL of the Groq/Whisper transcription proxy (Cloudflare Worker). Empty = not configured. */
  transcriptionServerUrl: string;
  emailSummaryEnabled: boolean;
  emailSummaryRecipient: string | null;
  cloudBackupProvider: 'google-drive' | null;
  cloudBackupToken: OAuthToken | null;
  notificationPermissionRequested: boolean;
  /** IANA timezone name (e.g. "Asia/Singapore") or "auto" to follow the OS. Default "auto". */
  timezone: string;
  /** Date format token. Default "DD MMM YYYY". */
  dateFormat: 'DD MMM YYYY' | 'MMM DD, YYYY' | 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  /** Time format. Default "24h". */
  timeFormat: '24h' | '12h';
}

export type EmailJobStatus = 'pending' | 'in-flight' | 'failed';

export interface EmailJob {
  /** UUID v4 */
  id: string;
  noteId: string;
  recipient: string;
  subject: string;
  bodyText: string;
  /** Note media item IDs */
  attachmentRefs: string[];
  createdAt: number;
  /** 0–3 */
  attempts: number;
  lastAttemptAt: number | null;
  status: EmailJobStatus;
}

export type UploadJobStatus = 'pending' | 'in-flight' | 'failed';

export interface CloudUploadJob {
  id: string;
  noteId: string;
  provider: 'google-drive';
  createdAt: number;
  /** 0–3 */
  attempts: number;
  lastAttemptAt: number | null;
  status: UploadJobStatus;
}
