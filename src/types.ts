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
  mediaItems: MediaItem[];
  /** Attached if transcription succeeded */
  transcription?: string;
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
  emailSummaryEnabled: boolean;
  emailSummaryRecipient: string | null;
  cloudBackupProvider: 'google-drive' | null;
  cloudBackupToken: OAuthToken | null;
  notificationPermissionRequested: boolean;
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
