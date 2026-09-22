// ============================================================
// e-Handkerchief OAuth Broker Worker
// Completes Google's OAuth2 token exchange and refresh on behalf of
// the PWA. Google "Web application" clients require client_secret
// even with PKCE, and the secret must never ship in the static site,
// so it lives here as a Cloudflare secret (GOOGLE_CLIENT_SECRET).
// Token values are never logged.
// ============================================================

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(env, request) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  // Unlike the transcription Worker, an unset ALLOWED_ORIGIN denies every
  // origin: this Worker spends the site owner's client secret.
  const requestOrigin = request.headers.get('Origin') || '';
  if (requestOrigin && allowedOrigins(env).includes(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }
  return headers;
}

function jsonResponse(body, status, env, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(env, request),
    },
  });
}

/** POST form params to Google's token endpoint and relay the result. */
async function exchange(params, env, request) {
  let googleRes;
  try {
    googleRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
      }).toString(),
    });
  } catch {
    return jsonResponse({ error: 'Failed to reach Google' }, 502, env, request);
  }

  const data = await googleRes.json().catch(() => null);
  if (!googleRes.ok || !data || typeof data.access_token !== 'string') {
    return jsonResponse(
      {
        error: (data && data.error) || 'token_error',
        error_description: (data && data.error_description) || '',
      },
      googleRes.ok ? 502 : googleRes.status,
      env,
      request
    );
  }

  // Only relay the fields the app needs.
  const out = { access_token: data.access_token, expires_in: data.expires_in };
  if (typeof data.refresh_token === 'string') out.refresh_token = data.refresh_token;
  return jsonResponse(out, 200, env, request);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (path !== '/token' && path !== '/refresh') {
      return jsonResponse({ error: 'Not found' }, 404, env, request);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, env, request);
    }
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return jsonResponse({ error: 'OAuth not configured' }, 500, env, request);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Expected a JSON body' }, 400, env, request);
    }

    if (path === '/token') {
      const { code, code_verifier, redirect_uri } = body || {};
      if (![code, code_verifier, redirect_uri].every((v) => typeof v === 'string' && v)) {
        return jsonResponse(
          { error: 'code, code_verifier and redirect_uri are required' },
          400,
          env,
          request
        );
      }
      return exchange(
        { grant_type: 'authorization_code', code, code_verifier, redirect_uri },
        env,
        request
      );
    }

    const { refresh_token } = body || {};
    if (typeof refresh_token !== 'string' || !refresh_token) {
      return jsonResponse({ error: 'refresh_token is required' }, 400, env, request);
    }
    return exchange({ grant_type: 'refresh_token', refresh_token }, env, request);
  },
};
