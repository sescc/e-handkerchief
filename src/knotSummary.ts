// ============================================================
// e-Handkerchief — knotSummary
// Pure helpers for building a shareable text summary of a knot, and for
// naming its media attachments. No DOM, no settingsStore/db imports — kept
// importable under plain `node` for the characterization test.
// ============================================================

import type { Knot, AudioMediaItem, PhotoMediaItem, TextMediaItem, VideoMediaItem } from './types.js';
import { googleMapsUrl } from './mapsLink.js';

/**
 * Gather all transcripts to display for a knot.
 * Prefers per-audio-item transcripts (in media order); falls back to the
 * legacy knot-level transcription for back-compat with old knots.
 */
export function collectTranscripts(knot: Knot): string[] {
  const perItem = knot.mediaItems
    .filter((m): m is AudioMediaItem => m.type === 'audio' && !!m.transcript && m.transcript.trim().length > 0)
    .map((m) => m.transcript!.trim());
  if (perItem.length > 0) return perItem;
  if (knot.transcription && knot.transcription.trim().length > 0) return [knot.transcription.trim()];
  return [];
}

/**
 * Build the plain-text summary shared (or copied) for one knot: timestamp,
 * place, every text item, every transcript, and an attachment-count line.
 * Sections are joined with a single blank line each, so the result never has
 * doubled blank lines; trailing whitespace is trimmed.
 *
 * @param formatTimestamp Injected so this module stays DOM/settings-free —
 *   pass `formatKnotTimestamp` from dateFormat.ts in real use.
 */
export function knotSummaryText(knot: Knot, formatTimestamp: (iso: string) => string): string {
  const sections: string[] = [];

  // --- Header: timestamp + optional place (address/coords + Maps link, or
  // a manual label when there are no GPS coordinates). ---
  const headerLines: string[] = [formatTimestamp(knot.timestamp.localISO)];
  if (knot.location) {
    const address =
      knot.location.resolvedAddress ??
      `${knot.location.latitude.toFixed(5)}, ${knot.location.longitude.toFixed(5)}`;
    headerLines.push(`📍 ${address}`);
    headerLines.push(googleMapsUrl(knot.location));
  } else if (knot.manualLabel && knot.manualLabel.trim().length > 0) {
    headerLines.push(`📍 ${knot.manualLabel.trim()}`);
  }
  sections.push(headerLines.join('\n'));

  // --- Every text item's content, in media order, blank-line separated. ---
  const textBlocks = knot.mediaItems
    .filter((m): m is TextMediaItem => m.type === 'text')
    .map((m) => m.content.trim())
    .filter((t) => t.length > 0);
  if (textBlocks.length > 0) {
    sections.push(textBlocks.join('\n\n'));
  }

  // --- Transcripts, each prefixed with the mic emoji. ---
  const transcripts = collectTranscripts(knot);
  if (transcripts.length > 0) {
    sections.push(transcripts.map((t) => `🎙 ${t}`).join('\n\n'));
  }

  // --- Attachment counts, correctly pluralised, zero counts omitted. ---
  const photoCount = knot.mediaItems.filter((m) => m.type === 'photo').length;
  const videoCount = knot.mediaItems.filter((m) => m.type === 'video').length;
  const audioCount = knot.mediaItems.filter((m) => m.type === 'audio').length;
  const countParts: string[] = [];
  if (photoCount > 0) countParts.push(`${photoCount} photo${photoCount === 1 ? '' : 's'}`);
  if (videoCount > 0) countParts.push(`${videoCount} video${videoCount === 1 ? '' : 's'}`);
  if (audioCount > 0) {
    countParts.push(`${audioCount} voice recording${audioCount === 1 ? '' : 's'}`);
  }
  if (countParts.length > 0) {
    sections.push(`(${countParts.join(', ')} attached in e-Handkerchief)`);
  }

  return sections.join('\n\n').trimEnd();
}

/** MIME type (stripped of any `;codecs=…` parameter) -> file extension. */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
};

/** Look up a file extension for a MIME type, stripping any `;codecs=…` suffix first. */
function extensionForMimeType(mimeType: string): string {
  const base = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  return MIME_EXTENSIONS[base] ?? 'bin';
}

/**
 * Build a share-friendly filename for a media item, e.g. `knot-photo-1.jpg`.
 * The extension comes from the item's blob MIME type; `index` is embedded
 * verbatim, so callers decide the numbering (e.g. 1-based, per media type).
 */
export function mediaFileName(
  item: PhotoMediaItem | VideoMediaItem | AudioMediaItem,
  index: number
): string {
  const ext = extensionForMimeType(item.blob.type);
  return `knot-${item.type}-${index}.${ext}`;
}
