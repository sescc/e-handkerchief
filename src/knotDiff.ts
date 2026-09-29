// ============================================================
// e-Handkerchief — knotDiff
// Pure structural diff between two versions of the same knot, used by the
// edit-conflict review screen. No DOM, no db/settingsStore imports — kept
// importable under plain `node` for the characterization test.
//
// Direction: `local` is THIS DEVICE's version and `remote` is the cloud
// version. Everything is reported from the point of view of a user choosing
// between them:
//   - "onlyOnThisDevice": present locally, absent from the cloud copy;
//   - "onlyInCloud":      present in the cloud copy, absent locally;
//   - line diffs run local -> remote, so a 'del' line exists only on this
//     device and an 'add' line exists only in the cloud version.
//
// Check-off state (checkedOffAt / checkOffChangedAt) and the bookkeeping
// timestamps (updatedAt / createdAt) are deliberately ignored: check-off merges
// on its own clock and is never part of a content conflict.
// ============================================================

import type {
  Knot,
  KnotLocation,
  MediaItem,
  AudioMediaItem,
  PhotoMediaItem,
  TextMediaItem,
  VideoMediaItem,
} from './types.js';

/** One line of a line diff. */
export interface LineDiffOp {
  op: 'same' | 'add' | 'del';
  text: string;
}

/** A text item present on both sides whose content differs. */
export interface TextItemChange {
  /** Media item id (same on both sides). */
  id: string;
  /** Content on this device. */
  local: string;
  /** Content in the cloud version. */
  remote: string;
  /** Line diff local -> remote ('del' = only here, 'add' = only in cloud). */
  lines: LineDiffOp[];
}

/** Items that exist on only one side. */
export interface OneSidedItems<T> {
  onlyOnThisDevice: T[];
  onlyInCloud: T[];
}

/** A changed transcript, for an audio item present on both sides (or the legacy knot-level one). */
export interface TranscriptChange {
  /** Audio media item id, or null for the legacy knot-level `transcription`. */
  mediaId: string | null;
  /** Transcript on this device ('' when none). */
  local: string;
  /** Transcript in the cloud version ('' when none). */
  remote: string;
}

export interface KnotDiff {
  /** True when nothing in the compared content differs. */
  identical: boolean;
  text: OneSidedItems<TextMediaItem> & { changed: TextItemChange[] };
  photos: OneSidedItems<PhotoMediaItem>;
  videos: OneSidedItems<VideoMediaItem>;
  audios: OneSidedItems<AudioMediaItem>;
  transcripts: TranscriptChange[];
  /** Set when the GPS location differs (resolvedAddress or coordinates). */
  location: { local: KnotLocation | null; remote: KnotLocation | null } | null;
  /** Set when the manual location label differs ('' when none). */
  manualLabel: { local: string; remote: string } | null;
}

/** Split text into lines, normalising CRLF. */
function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Line diff local -> remote using a longest-common-subsequence table.
 * Replacements come out as the 'del' lines followed by the 'add' lines.
 */
export function diffLines(local: string, remote: string): LineDiffOp[] {
  const a = splitLines(local);
  const b = splitLines(remote);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = LCS length of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: LineDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ op: 'del', text: a[i] });
      i++;
    } else {
      ops.push({ op: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ op: 'del', text: a[i++] });
  while (j < m) ops.push({ op: 'add', text: b[j++] });
  return ops;
}

/** Items of one type on each side, keyed by id. */
function byId<T extends MediaItem>(items: MediaItem[], type: T['type']): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (item.type === type) map.set(item.id, item as T);
  }
  return map;
}

/** Items in `a` whose id is not in `b`, in `a`'s order. */
function missingFrom<T>(a: Map<string, T>, b: Map<string, T>): T[] {
  const out: T[] = [];
  for (const [id, item] of a) {
    if (!b.has(id)) out.push(item);
  }
  return out;
}

function oneSided<T extends MediaItem>(local: Knot, remote: Knot, type: T['type']): OneSidedItems<T> {
  const l = byId<T>(local.mediaItems, type);
  const r = byId<T>(remote.mediaItems, type);
  return { onlyOnThisDevice: missingFrom(l, r), onlyInCloud: missingFrom(r, l) };
}

function locationsEqual(a: KnotLocation | null, b: KnotLocation | null): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    (a.resolvedAddress ?? '') === (b.resolvedAddress ?? '')
  );
}

function trimmed(s: string | undefined): string {
  return (s ?? '').trim();
}

/**
 * Compare this device's knot with the cloud version of it. See the file
 * header for the direction convention and for what is ignored.
 */
export function diffKnots(local: Knot, remote: Knot): KnotDiff {
  // --- Text items: added / removed / changed, matched by media id. ---
  const localText = byId<TextMediaItem>(local.mediaItems, 'text');
  const remoteText = byId<TextMediaItem>(remote.mediaItems, 'text');
  const changed: TextItemChange[] = [];
  for (const [id, l] of localText) {
    const r = remoteText.get(id);
    if (r && r.content !== l.content) {
      changed.push({ id, local: l.content, remote: r.content, lines: diffLines(l.content, r.content) });
    }
  }
  const text = {
    onlyOnThisDevice: missingFrom(localText, remoteText),
    onlyInCloud: missingFrom(remoteText, localText),
    changed,
  };

  // --- Photos / videos / audio: added / removed by id. ---
  const photos = oneSided<PhotoMediaItem>(local, remote, 'photo');
  const videos = oneSided<VideoMediaItem>(local, remote, 'video');
  const audios = oneSided<AudioMediaItem>(local, remote, 'audio');

  // --- Transcripts: per audio item present on both sides, then legacy. ---
  const transcripts: TranscriptChange[] = [];
  const localAudio = byId<AudioMediaItem>(local.mediaItems, 'audio');
  const remoteAudio = byId<AudioMediaItem>(remote.mediaItems, 'audio');
  for (const [id, l] of localAudio) {
    const r = remoteAudio.get(id);
    if (r && trimmed(l.transcript) !== trimmed(r.transcript)) {
      transcripts.push({ mediaId: id, local: trimmed(l.transcript), remote: trimmed(r.transcript) });
    }
  }
  if (trimmed(local.transcription) !== trimmed(remote.transcription)) {
    transcripts.push({ mediaId: null, local: trimmed(local.transcription), remote: trimmed(remote.transcription) });
  }

  // --- Location and manual label. ---
  const location = locationsEqual(local.location, remote.location)
    ? null
    : { local: local.location, remote: remote.location };
  const manualLabel =
    trimmed(local.manualLabel) !== trimmed(remote.manualLabel)
      ? { local: trimmed(local.manualLabel), remote: trimmed(remote.manualLabel) }
      : null;

  const identical =
    text.onlyOnThisDevice.length === 0 &&
    text.onlyInCloud.length === 0 &&
    text.changed.length === 0 &&
    photos.onlyOnThisDevice.length === 0 &&
    photos.onlyInCloud.length === 0 &&
    videos.onlyOnThisDevice.length === 0 &&
    videos.onlyInCloud.length === 0 &&
    audios.onlyOnThisDevice.length === 0 &&
    audios.onlyInCloud.length === 0 &&
    transcripts.length === 0 &&
    location === null &&
    manualLabel === null;

  return { identical, text, photos, videos, audios, transcripts, location, manualLabel };
}
