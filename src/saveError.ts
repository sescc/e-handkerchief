// ============================================================
// e-Handkerchief — saveError
// Pure helpers (no DOM / IndexedDB imports, so they run under plain node)
// that turn a failed knot save into a user-facing message.
// ============================================================

/** Read a string property off an unknown thrown value, or '' when absent. */
function stringProp(err: unknown, key: 'message' | 'name'): string {
  if (typeof err !== 'object' || err === null) return '';
  const v = (err as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

/**
 * True when a save failure was caused by a media blob that IndexedDB could not
 * write or read (Chrome: "Failed to write blobs (InvalidBlob)", or a
 * NotReadableError DOMException) rather than e.g. a full disk.
 */
export function isMediaWriteError(err: unknown): boolean {
  return /blob/i.test(stringProp(err, 'message')) || stringProp(err, 'name') === 'NotReadableError';
}

/**
 * Build the toast text for a failed knot save. `prefix` is the lead-in, e.g.
 * 'Could not tie knot' (Capture) or 'Could not save changes' (Edit).
 */
export function saveErrorMessage(prefix: string, err: unknown): string {
  if (isMediaWriteError(err)) {
    return `${prefix} — a photo, video or audio file couldn't be saved. Remove it and pick it again.`;
  }
  const hasMessage =
    typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string';
  const detail = hasMessage ? (err as { message: string }).message : String(err);
  return `${prefix}: ${detail}`;
}
