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
who self-deploys the app deploys their own broker (see the main README).

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

3. **Check `ALLOWED_ORIGIN`** in `wrangler.toml`. It must list the PWA's origin (scheme + host,
   no path), e.g. `https://sescc.github.io`. A comma-separated list is supported. If it is
   **unset, every origin is denied**.

4. **Deploy**
   ```bash
   npx wrangler deploy
   ```
   Wrangler prints the Worker URL, e.g. `https://ehk-oauth.<your-subdomain>.workers.dev`.

5. **Add the URL to GitHub:** repo → Settings → Secrets and variables → Actions → New
   repository secret. Name it `OAUTH_BROKER_URL` and set the value to the Worker URL, with
   **no trailing slash**. The deploy workflow injects it into `config.js`.

---

## Local testing

```bash
cp .dev.vars.example .dev.vars   # fill in the client ID and secret
npm run dev                      # http://localhost:8787
```

To test from a local PWA, temporarily add its origin (e.g. `http://localhost:8080`) to
`ALLOWED_ORIGIN`.

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
- `ALLOWED_ORIGIN` is enforced by browsers (CORS). Google also refuses codes whose
  `redirect_uri` isn't registered on the OAuth client.
- Token values are never logged. `.dev.vars` is git-ignored.
