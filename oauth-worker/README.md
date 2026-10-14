# e-Handkerchief OAuth Broker Worker

A tiny [Cloudflare Worker](https://developers.cloudflare.com/workers/) that completes Google's
OAuth2 token exchange and token refresh for the e-Handkerchief PWA's Google Drive backup.

```
Browser (PWA) ──{ code, code_verifier, redirect_uri }──▶ Worker ──+ client_secret──▶ Google token endpoint
     ▲                                                                                   │
     └────────────────────  { access_token, refresh_token, expires_in }  ◀─────────────┘
```

## Why a broker?

Google OAuth clients of type **Web application** require the `client_secret` on the token
endpoint, even when PKCE is used. The PWA is a static site. Anything built into it, including
values injected from GitHub Actions secrets, can be read by anyone at `config.js`. The
secret therefore lives only here, as an encrypted Cloudflare secret.

This Worker is **operated by the site owner** and is tied to the owner's Google OAuth client.
Unlike the transcription Worker, other users do not point the app at their own copy. Someone
who self-deploys the app deploys their own broker (see `docs/guide/self-hosting.md`).

---

## Setup & Deploy

1. **Install and log in**
   ```bash
   cd oauth-worker
   npm install
   npx wrangler login
   ```

2. **Set the Google OAuth credentials as secrets.** Get them from Google Cloud Console →
   APIs & Services → Credentials → your OAuth 2.0 Web client.
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

3. **Set `ALLOWED_ORIGIN` as a secret** (it is deliberately not in `wrangler.toml`, so the repo
   names no site). It must list the PWA's origin (scheme + host, no path):
   ```bash
   npx wrangler secret put ALLOWED_ORIGIN    # e.g. https://<your-user>.github.io
   ```
   A comma-separated list is supported, for example
   `https://<your-user>.github.io,https://notes.example.com`. Matching is exact, so `*` is
   **not** supported here, and if the secret is **unset, every origin is denied**. A secret takes
   effect immediately; no redeploy is needed to change it.

4. **Deploy**
   ```bash
   npx wrangler deploy
   ```
   Wrangler prints the Worker URL, e.g. `https://ehk-oauth.<your-subdomain>.workers.dev`.

   **Migrating an existing deployment** that still has `ALLOWED_ORIGIN` as a plain variable:
   deploy this version of `wrangler.toml` first (that removes the plain variable, and until the
   secret exists the Worker denies all origins), then run `npx wrangler secret put
   ALLOWED_ORIGIN` straight away.

5. **Add the URL to GitHub:** repo → Settings → Secrets and variables → Actions → New
   repository secret. Name it `OAUTH_BROKER_URL` and set the value to the Worker URL, with
   **no trailing slash**. The deploy workflow injects it into `config.js`.

---

## Local testing

```bash
cp .dev.vars.example .dev.vars   # fill in the client ID and secret
npm run dev                      # http://localhost:8787
```

`wrangler dev` doesn't read the deployed secrets, so `.dev.vars` must also set `ALLOWED_ORIGIN`
(the example uses `http://localhost:8080`, the origin of a local PWA); otherwise every origin is
denied.

---

## API

**`POST /token`**: exchange an authorization code.
- Body (JSON): `{ "code", "code_verifier", "redirect_uri" }`
- `200`: `{ "access_token", "expires_in", "refresh_token" }`

**`POST /refresh`**: renew an access token.
- Body (JSON): `{ "refresh_token" }`
- `200`: `{ "access_token", "expires_in" }`

**`OPTIONS`**: CORS preflight, returns `204`.

### Error responses

| Status | Meaning |
| ------ | ------- |
| `400`  | Missing or invalid JSON fields, or Google's `invalid_grant` etc. (passed through as `{ error, error_description }`) |
| `404`  | Unknown path |
| `405`  | Method not allowed |
| `500`  | Worker misconfigured (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` not set) |
| `502`  | Couldn't reach Google, or Google returned an unexpected response |

## Security notes

- The client ID and secret come **only** from Worker secrets, never from the request, so the
  Worker can't be used with other OAuth clients. It only proxies the `authorization_code`
  and `refresh_token` grants.
- `ALLOWED_ORIGIN` (a Worker secret) is enforced by browsers (CORS). Google also refuses codes whose
  `redirect_uri` isn't registered on the OAuth client.
- Token values are never logged. `.dev.vars` is git-ignored.
