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

// Audio formats Whisper (Groq) can transcribe: flac, mp3, mp4, mpeg, mpga,
// m4a, ogg, wav, webm. Raw AAC, WMA and AMR are deliberately not accepted.
//
// A known extension always wins over the reported type: Android providers
// report e.g. .m4a as audio/mp4a-latm, audio/aac, video/mp4, '' or
// application/octet-stream.
const AUDIO_EXTENSIONS: Record<string, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mpga: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
};

// MIME aliases (base type) -> the normalised stored type.
const AUDIO_MIME_ALIASES: Record<string, string> = {
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mp4a-latm': 'audio/mp4',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/x-mp3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/ogg': 'audio/ogg',
  'audio/opus': 'audio/ogg',
  'audio/flac': 'audio/flac',
  'audio/x-flac': 'audio/flac',
  'audio/webm': 'audio/webm',
};

/** Lowercase and strip any `;codecs=…` style parameters. */
function baseType(type: string): string {
  return (type || '').split(';')[0].trim().toLowerCase();
}

/** Lowercased extension after the last dot, or '' if none. */
function extensionOf(name: string): string {
  const dot = (name || '').lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Decide what kind of media a picked file is, or null if it isn't supported.
 */
export function classifyImport(type: string, name: string): ImportClassification | null {
  const byExt = AUDIO_EXTENSIONS[extensionOf(name)];
  if (byExt) return { kind: 'audio', mimeType: byExt };
  const t = baseType(type);
  const byMime = AUDIO_MIME_ALIASES[t];
  if (byMime) return { kind: 'audio', mimeType: byMime };
  if (PHOTO_TYPES.includes(t)) return { kind: 'photo', mimeType: t };
  if (VIDEO_TYPES.includes(t)) return { kind: 'video', mimeType: t };
  return null;
}
