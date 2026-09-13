// ============================================================
// e-Handkerchief Transcription Worker
// Proxies audio to Groq's Whisper API. The GROQ_API_KEY is a
// Cloudflare secret and is never present in this source file.
// ============================================================

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';

function corsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  });
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, env);
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse({ error: 'Server not configured (missing API key)' }, 500, env);
    }

    let incomingForm;
    try {
      incomingForm = await request.formData();
    } catch {
      return jsonResponse({ error: 'Expected multipart/form-data with a "file" field' }, 400, env);
    }

    const file = incomingForm.get('file');
    if (!file) {
      return jsonResponse({ error: 'No "file" field in form data' }, 400, env);
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
      return jsonResponse({ error: 'Failed to reach transcription service' }, 502, env);
    }

    if (!groqRes.ok) {
      const detail = await groqRes.text().catch(() => '');
      return jsonResponse(
        { error: 'Transcription service error', status: groqRes.status, detail: detail.slice(0, 500) },
        groqRes.status,
        env
      );
    }

    const data = await groqRes.json().catch(() => null);
    if (!data || typeof data.text !== 'string') {
      return jsonResponse({ error: 'Unexpected transcription response' }, 502, env);
    }

    return jsonResponse({ text: data.text }, 200, env);
  },
};
