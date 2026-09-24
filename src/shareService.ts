// ============================================================
// e-Handkerchief — ShareService
// Wraps the Web Share API (navigator.share) for a single knot: email, copy,
// Bluetooth, messaging apps, and so on — via the platform's own share sheet.
// Falls back to copying the summary text when Web Share isn't available.
// ============================================================

import { knotSummaryText, mediaFileName } from './knotSummary.js';
import { formatKnotTimestamp } from './dateFormat.js';
import { toastService } from './toastService.js';
import type { Knot, AudioMediaItem, PhotoMediaItem, VideoMediaItem } from './types.js';

/** Files are only attached to the share when their combined size is <= this. */
const MAX_SHARE_FILES_BYTES = 50 * 1024 * 1024; // 50 MB

/** Build the File objects for a knot's photo/video/audio items, 1-based per media type. */
function buildShareFiles(knot: Knot): File[] {
  const files: File[] = [];
  let photoIndex = 0;
  let videoIndex = 0;
  let audioIndex = 0;

  for (const item of knot.mediaItems) {
    if (item.type === 'photo') {
      const photo = item as PhotoMediaItem;
      photoIndex += 1;
      files.push(new File([photo.blob], mediaFileName(photo, photoIndex), { type: photo.blob.type }));
    } else if (item.type === 'video') {
      const video = item as VideoMediaItem;
      videoIndex += 1;
      files.push(new File([video.blob], mediaFileName(video, videoIndex), { type: video.blob.type }));
    } else if (item.type === 'audio') {
      const audio = item as AudioMediaItem;
      audioIndex += 1;
      files.push(new File([audio.blob], mediaFileName(audio, audioIndex), { type: audio.blob.type }));
    }
  }

  return files;
}

/**
 * Share one knot via the platform share sheet: email, copy, Bluetooth,
 * messaging apps, and so on. Falls back to copying the summary text to the
 * clipboard when the Web Share API isn't available.
 *
 * Everything is built SYNCHRONOUSLY and this makes AT MOST ONE
 * `navigator.share()` call. A second call after a rejection would run
 * outside the click's original user-gesture / transient-activation window,
 * and some browsers throw NotAllowedError for that — so callers must invoke
 * this directly from a click handler with no `await` beforehand, and this
 * function itself must not retry.
 */
export async function shareKnot(knot: Knot): Promise<void> {
  const text = knotSummaryText(knot, formatKnotTimestamp);
  const title = 'e-Handkerchief knot';

  if (typeof navigator.share !== 'function') {
    try {
      await navigator.clipboard.writeText(text);
      toastService.show('Knot copied to clipboard');
    } catch {
      toastService.show("Sharing isn't supported in this browser");
    }
    return;
  }

  const files = buildShareFiles(knot);
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
      toastService.show("Couldn't share — knot copied to clipboard");
    } catch {
      toastService.show("Couldn't share this knot");
    }
  }
}
