// ============================================================
// e-Handkerchief — shared TypeScript interfaces
// ============================================================

export interface KnotTimestamp {
  /** ISO 8601 local time, e.g. "2024-07-04T14:30:00+01:00" */
  localISO: string;
  /** UTC offset string, e.g. "+01:00" */
  utcOffset: string;
}

export interface KnotLocation {
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

export interface Knot {
  /** UUID v4 */
  id: string;
  timestamp: KnotTimestamp;
  location: KnotLocation | null;
  /** Manually-entered location label used when there are no GPS coordinates (knot.location is null). Plain text, no map link. */
  manualLabel?: string;
  mediaItems: MediaItem[];
  /** @deprecated Legacy knot-level transcription; new code uses per-AudioMediaItem transcript. Retained for backward compatibility with old knots. */
  transcription?: string;
  /** @deprecated Legacy knot-level transcription; new code uses per-AudioMediaItem transcript. Retained for backward compatibility with old knots. */
  transcriptionStatus?: 'none' | 'live' | 'pending' | 'done' | 'failed';
  /** Unix ms — used for Knots sort order */
  createdAt: number;
  /**
   * Unix ms of the last CONTENT edit. Drives sync/conflict detection.
   * Checking a knot off or unchecking it deliberately does NOT bump this.
   */
  updatedAt: number;
  /**
   * Unix ms when the knot was checked off; null/absent = not checked off.
   * Deliberately does NOT bump `updatedAt` (check-off is not a content edit,
   * so it never causes a conflict, never lifts a cloud tombstone and never
   * re-uploads media). It merges across devices on `checkOffChangedAt`.
   */
  checkedOffAt?: number | null;
  /**
   * Unix ms of the last check or uncheck — the check-off state's own
   * last-write-wins clock. Absent = 0. Also deliberately does NOT bump
   * `updatedAt`.
   */
  checkOffChangedAt?: number;
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
  /** Unix ms of the last successful cloud sync, or null if never synced. */
  lastSyncAt: number | null;
  /** Email address of the connected Google account, or null if not connected / not yet fetched. */
  cloudAccountEmail: string | null;
  /** IANA timezone name (e.g. "Asia/Singapore") or "auto" to follow the OS. Default "auto". */
  timezone: string;
  /** Date format token. Default "DD MMM YYYY". */
  dateFormat: 'DD MMM YYYY' | 'MMM DD, YYYY' | 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  /** Time format. Default "24h". */
  timeFormat: '24h' | '12h';
  /** "HH:MM" local time at which a new day starts; checked-off knots leave the Knots list then. Default "03:00". */
  dayCutoff: string;
  /** Append the "Shared from e-Handkerchief" footer to shared knots. Default true. */
  shareAttribution: boolean;
  /** Keep a quick-capture notification in the notification drawer (once permission is granted). Default true. */
  quickCaptureNotification: boolean;
}

export type UploadJobStatus = 'pending' | 'in-flight' | 'failed';

export interface CloudUploadJob {
  id: string;
  knotId: string;
  provider: 'google-drive';
  createdAt: number;
  /** 0–3 */
  attempts: number;
  lastAttemptAt: number | null;
  status: UploadJobStatus;
}

/**
 * A local record marking that a knot was deleted FROM THIS DEVICE.
 * Local deletes never delete the Drive backup (Drive is an archive), so this
 * tombstone exists purely to stop a later sync from pulling that knot back
 * onto this device.
 */
export interface KnotTombstone {
  id: string;
  deletedAt: number;
}

/**
 * Per-knot sync bookkeeping, stored locally (IndexedDB `syncState`, keyed by
 * `knotId`). `baseUpdatedAt` is the content version (`updatedAt`) this device
 * and Drive last agreed on — the "base" of the three-way comparison that
 * detects edit conflicts. `conflict` is set while the knot was edited on two
 * devices and is waiting for the user to review it.
 */
export interface SyncStateRecord {
  knotId: string;
  /** Content `updatedAt` last agreed with Drive; null if none recorded yet. */
  baseUpdatedAt: number | null;
  /** Present while this knot awaits conflict review. */
  conflict?: {
    /** Drive file id of the newest remote copy when the conflict was recorded. */
    fileId: string;
    /** That remote copy's content `updatedAt`. */
    remoteUpdatedAt: number;
  };
}
