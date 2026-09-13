// ============================================================
// e-Handkerchief — remoteTranscribe
// Sends a saved audio blob to the configured transcription proxy
// (Cloudflare Worker → Groq Whisper) and returns the transcript.
// ============================================================

import { settingsStore } from './settingsStore.js';

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
  if (!navigator.onLine) return { ok: false, error: 'No internet connection.' };

  try {
    const form = new FormData();
    // Give the file a sensible name/extension based on the blob type.
    const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
    form.append('file', blob, `audio.${ext}`);
    if (language) form.append('language', language);

    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json() as { error?: string }; detail = j.error ?? ''; } catch { /* ignore */ }
      return { ok: false, error: detail || `Server error (${res.status})` };
    }
    const data = await res.json() as { text?: string };
    if (typeof data.text !== 'string') return { ok: false, error: 'Unexpected server response.' };
    return { ok: true, text: data.text };
  } catch {
    return { ok: false, error: 'Could not reach the transcription server.' };
  }
}
