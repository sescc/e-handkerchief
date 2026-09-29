// ============================================================
// e-Handkerchief — ShareService
// Wraps the Web Share API (navigator.share) for one or several knots: email,
// copy, Bluetooth, messaging apps, and so on — via the platform's own share
// sheet. Falls back to copying the summary text when Web Share isn't available.
// ============================================================

import { knotsSummaryText, mediaFileName } from './knotSummary.js';
import { formatKnotTimestamp } from './dateFormat.js';
import { settingsStore } from './settingsStore.js';
import { toastService } from './toastService.js';
import type { Knot, AudioMediaItem, PhotoMediaItem, VideoMediaItem } from './types.js';

/** Files are only attached to the share when their combined size is <= this. */
const MAX_SHARE_FILES_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Build the File objects for one knot's photo/video/audio items, 1-based per
 * media type. `prefix` keeps filenames unique across knots in a multi-knot share.
 */
function buildShareFiles(knot: Knot, prefix: string): File[] {
  const files: File[] = [];
  let photoIndex = 0;
  let videoIndex = 0;
  let audioIndex = 0;

  for (const item of knot.mediaItems) {
    if (item.type === 'photo') {
      const photo = item as PhotoMediaItem;
      photoIndex += 1;
      files.push(new File([photo.blob], mediaFileName(photo, photoIndex, prefix), { type: photo.blob.type }));
    } else if (item.type === 'video') {
      const video = item as VideoMediaItem;
      videoIndex += 1;
      files.push(new File([video.blob], mediaFileName(video, videoIndex, prefix), { type: video.blob.type }));
    } else if (item.type === 'audio') {
      const audio = item as AudioMediaItem;
      audioIndex += 1;
      files.push(new File([audio.blob], mediaFileName(audio, audioIndex, prefix), { type: audio.blob.type }));
    }
  }

  return files;
}

/**
 * Share one or more knots via the platform share sheet: email, copy,
 * Bluetooth, messaging apps, and so on. Falls back to copying the summary text
 * to the clipboard when the Web Share API isn't available.
 *
 * Everything is built SYNCHRONOUSLY and this makes AT MOST ONE
 * `navigator.share()` call. A second call after a rejection would run
 * outside the click's original user-gesture / transient-activation window,
 * and some browsers throw NotAllowedError for that — so callers must invoke
 * this directly from a click handler with no `await` beforehand, and this
 * function itself must not retry.
 *
 * With several knots, the text is one combined summary (header, `———`
 * separators, a single footer) and attached files are named `knot<n>-…`
 * (1-based per knot) so they never collide. The 50 MB cap applies to the
 * combined size of all files.
 */
export async function shareKnots(knots: Knot[]): Promise<void> {
  if (knots.length === 0) return;

  const many = knots.length > 1;
  const attribute = settingsStore.getCurrent().shareAttribution !== false;
  const appUrl = location.origin + location.pathname;
  const text = knotsSummaryText(knots, formatKnotTimestamp, attribute ? { attribution: { appUrl } } : undefined);
  const title = many ? 'e-Handkerchief knots' : 'e-Handkerchief knot';

  if (typeof navigator.share !== 'function') {
    try {
      await navigator.clipboard.writeText(text);
      toastService.show(many ? 'Knots copied to clipboard' : 'Knot copied to clipboard');
    } catch {
      toastService.show("Sharing isn't supported in this browser");
    }
    return;
  }

  const files = knots.flatMap((knot, i) => buildShareFiles(knot, many ? `knot${i + 1}` : 'knot'));
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const canShareFiles =
    files.length > 0 && totalBytes <= MAX_SHARE_FILES_BYTES && !!navigator.canShare?.({ files });

  const shareData: ShareData = canShareFiles ? { title, text, files } : { title, text };

  try {
    // The ONE share call — see the doc comment above.
    await navigator.share(shareData);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return; // the user cancelled — stay silent
    }
    try {
      await navigator.clipboard.writeText(text);
      toastService.show(many ? "Couldn't share — knots copied to clipboard" : "Couldn't share — knot copied to clipboard");
    } catch {
      toastService.show(many ? "Couldn't share these knots" : "Couldn't share this knot");
    }
  }
}

/** Share a single knot. See `shareKnots`. */
export function shareKnot(knot: Knot): Promise<void> {
  return shareKnots([knot]);
}
