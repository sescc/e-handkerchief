// ============================================================
// e-Handkerchief — mediaImport
// Pure classification of a file picked from the Library into a media kind.
// No DOM, so it runs under plain node (see mediaImport.chartest.ts).
// ============================================================

export type ImportKind = 'photo' | 'video' | 'audio';

export interface ImportClassification {
  kind: ImportKind;
  /** The MIME type the item should be stored with (normalised for audio). */
  mimeType: string;
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
// Types that external recorder apps / Android providers report for m4a audio.
const M4A_TYPES = ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mp4a-latm'];

/** Lowercase and strip any `;codecs=…` style parameters. */
function baseType(type: string): string {
  return (type || '').split(';')[0].trim().toLowerCase();
}

/**
 * Decide what kind of media a picked file is, or null if it isn't supported.
 * A `.m4a` file name always wins: Android providers report that file as
 * audio/mp4a-latm, audio/aac, video/mp4, '' or application/octet-stream.
 */
export function classifyImport(type: string, name: string): ImportClassification | null {
  if ((name || '').toLowerCase().endsWith('.m4a')) {
    return { kind: 'audio', mimeType: 'audio/mp4' };
  }
  const t = baseType(type);
  if (M4A_TYPES.includes(t)) return { kind: 'audio', mimeType: 'audio/mp4' };
  if (PHOTO_TYPES.includes(t)) return { kind: 'photo', mimeType: t };
  if (VIDEO_TYPES.includes(t)) return { kind: 'video', mimeType: t };
  return null;
}
