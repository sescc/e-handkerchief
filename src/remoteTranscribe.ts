// ============================================================
// e-Handkerchief — remoteTranscribe
// Sends a saved audio blob to the configured transcription proxy
// (Cloudflare Worker → Groq Whisper) and returns the transcript.
// ============================================================

import { settingsStore } from './settingsStore.js';
import { extensionForMimeType } from './knotSummary.js';

export interface RemoteTranscribeResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/**
 * Send an audio blob to the configured transcription proxy (Cloudflare Worker
 * → Groq Whisper). Requires network + a configured server URL.
 */
export async function remoteTranscribe(blob: Blob, language?: string): Promise<RemoteTranscribeResult> {
  const url = settingsStore.getCurrent().transcriptionServerUrl.trim();
  if (!url) return { ok: false, error: 'No transcription server configured in Settings.' };
  if (!url.startsWith('http')) return { ok: false, error: 'Transcription server URL must start with https://' };
  if (!navigator.onLine) return { ok: false, error: 'No internet connection.' };

  try {
    const form = new FormData();
    // Give the file a sensible name/extension based on the blob type.
    // Shared MIME->extension table; unknown types fall back to webm (the
    // recorder's usual output) rather than 'bin'.
    const ext = extensionForMimeType(blob.type);
    form.append('file', blob, `audio.${ext === 'bin' ? 'webm' : ext}`);
    if (language) form.append('language', language);

    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json() as { error?: string }; detail = j.error ?? ''; } catch { /* ignore */ }
      return { ok: false, error: detail || `Server error (${res.status})` };
    }
    const data = await res.json() as { text?: string };
    if (typeof data.text !== 'string') return { ok: false, error: 'Unexpected server response.' };
    return { ok: true, text: data.text.trim() };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('remoteTranscribe failed:', err);
    return { ok: false, error: `Could not reach the transcription server: ${detail}` };
  }
}
