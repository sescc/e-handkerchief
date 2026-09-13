// ============================================================
// e-Handkerchief Transcription Worker
// Proxies audio to Groq's Whisper API. The GROQ_API_KEY is a
// Cloudflare secret and is never present in this source file.
// ============================================================

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';

function corsHeaders(env, request) {
  const configured = (env.ALLOWED_ORIGIN || '').trim();
  const requestOrigin = request.headers.get('Origin') || '';
  let allowOrigin = '*';

  if (configured) {
    const allowed = configured.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.includes('*')) {
      allowOrigin = '*';
    } else if (requestOrigin && allowed.includes(requestOrigin)) {
      allowOrigin = requestOrigin;
    } else {
      // Not allowed — return the first configured origin so the browser
      // blocks it (and it's clear in devtools which origins are permitted).
      allowOrigin = allowed[0] || '*';
    }
  }

  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Origin': allowOrigin,
  };
  // When echoing a specific origin, tell caches it varies by Origin.
  if (allowOrigin !== '*') headers['Vary'] = 'Origin';
  return headers;
}

function jsonResponse(body, status, env, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env, request),
    },
  });
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, env, request);
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse({ error: 'Server not configured (missing API key)' }, 500, env, request);
    }

    let incomingForm;
    try {
      incomingForm = await request.formData();
    } catch {
      return jsonResponse({ error: 'Expected multipart/form-data with a "file" field' }, 400, env, request);
    }

    const file = incomingForm.get('file');
    if (!file) {
      return jsonResponse({ error: 'No "file" field in form data' }, 400, env, request);
    }

    const language = incomingForm.get('language'); // optional

    // Build the form data for Groq.
    const groqForm = new FormData();
    groqForm.append('file', file, (file && file.name) || 'audio.webm');
    groqForm.append('model', GROQ_MODEL);
    groqForm.append('response_format', 'json');
    if (language) groqForm.append('language', language);

    let groqRes;
    try {
      groqRes = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: groqForm,
      });
    } catch (err) {
      return jsonResponse({ error: 'Failed to reach transcription service' }, 502, env, request);
    }

    if (!groqRes.ok) {
      const detail = await groqRes.text().catch(() => '');
      return jsonResponse(
        { error: 'Transcription service error', status: groqRes.status, detail: detail.slice(0, 500) },
        groqRes.status,
        env,
        request
      );
    }

    const data = await groqRes.json().catch(() => null);
    if (!data || typeof data.text !== 'string') {
      return jsonResponse({ error: 'Unexpected transcription response' }, 502, env, request);
    }

    return jsonResponse({ text: data.text }, 200, env, request);
  },
};
