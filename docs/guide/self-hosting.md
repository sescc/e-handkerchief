# Self-hosting

e-Handkerchief is three independently deployed parts. You can run all of them in your own accounts, or just the site.

| Part | Where it runs | Required? |
| ---- | ------------- | --------- |
| The site (the PWA) | GitHub Pages, via `.github/workflows/deploy.yml` | **Yes** |
| `oauth-worker/` | Your Cloudflare account | Only for Google Drive backup |
| `transcribe-worker/` | Your Cloudflare account | Optional: transcribing saved audio later. Each user pastes its URL into Settings. |

The repository contains **no secrets**. The Google client secret, the Groq key and the allowed origins are Cloudflare Worker secrets, and the Google client ID and broker URL are public values injected into the site at deploy time.

## Build and preview locally

```sh
npm ci                          # installs TypeScript
npx tsc                         # compiles src/**/*.ts to .js beside the sources
npx tsc -p tsconfig.sw.json     # compiles sw.ts to sw.js (separate lib)
python -m http.server 8080      # or: npx serve .
```

Open `http://localhost:8080`. No bundler and no runtime dependencies: the output is plain static files.

HTTPS is required for the service worker, geolocation and microphone recording on real devices (`localhost` is exempt). For device testing, use a tunnel such as `ngrok http 8080`.

Locally, the committed `config.js` holds only placeholders, so Connect shows "Google Drive client ID not configured". Neither value is ever committed.

## Deploy the site to GitHub Pages

The app is designed to run from a **subpath** such as `https://<your-user>.github.io/<repo-name>/`. All asset, manifest, service-worker and OAuth paths are relative, so no configuration is needed for the subpath.

1. Fork or push the repo to GitHub (default branch `main`). On a fork, GitHub keeps Actions disabled until you enable them in the **Actions** tab.
2. In the repo go to **Settings → Pages → Source** and select **GitHub Actions**.
3. The workflow `.github/workflows/deploy.yml` runs on every push to `main` (and manually from the **Actions** tab via *workflow_dispatch*). It compiles the TypeScript, injects a build version into `sw.js`, checks that `sw.js` still parses as a classic script, copies the PWA's files (`index.html app.css manifest.webmanifest sw.js config.js`, `src/` and `icons/`) into `_site`, removes TypeScript sources and compiled test files, injects the Google configuration (below) into `config.js`, and publishes to Pages. The `transcribe-worker/` and `oauth-worker/` folders are not part of the deployed site.
4. When it finishes, the app is live at `https://<your-user>.github.io/<repo-name>/`. On a phone, open it and **Add to Home Screen**.

A `.nojekyll` file at the project root stops Jekyll processing, so the `src/` folder is served verbatim. The compiled `.js` is rebuilt in CI; the source of truth is the TypeScript in `src/` and `sw.ts`.

## Google Drive backup

Google "Web application" OAuth clients require the client secret at the token endpoint even when PKCE is used. The site is static and everything built into it is publicly readable at `config.js`, so the secret can't live there (and putting it in a GitHub Actions secret doesn't help: Actions secrets are only hidden inside CI, and anything injected into the site is public). It lives in `oauth-worker/`, a small Cloudflare Worker that does the token exchange and refresh. The client ID is designed to be public.

### 1. Create the Google OAuth client

In **Google Cloud Console**, enable the Google Drive API and create an **OAuth 2.0 Web application** client. Add an **Authorized redirect URI** and a matching **JavaScript origin** that **exactly** match your deployed URL: `https://<your-user>.github.io/<repo-name>/`, including the trailing slash (this equals `location.origin + location.pathname` at runtime). Note the client ID and client secret.

Also configure the **OAuth consent screen**. While an external app's publishing status is *Testing*, only the **test users** you list can sign in, and Google expires its refresh tokens after **7 days** (the app then shows "Google Drive session expired — please reconnect" about weekly). Add yourself (and any other users) as test users, or publish the app, to avoid the weekly expiry.

### 2. Deploy the OAuth Worker

```sh
cd oauth-worker
npm install
npx wrangler login
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ALLOWED_ORIGIN      # e.g. https://<your-user>.github.io
npx wrangler deploy
```

`ALLOWED_ORIGIN` is the site's origin (scheme and host, no path); a comma-separated list is supported. For this Worker an **unset** value denies every origin, and matching is exact (`*` is not supported). Copy the printed Worker URL. See `oauth-worker/README.md` for the API and local testing.

### 3. Add the GitHub secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**:

- `GOOGLE_CLIENT_ID`: the client ID.
- `OAUTH_BROKER_URL`: the Worker URL (no trailing slash needed; one is stripped).

Push to `main` (or re-run the workflow), then in the app use **Settings → Cloud Backup → Connect**.

By default **the deploy fails** if either secret is missing, with an error naming the secret. This is deliberate for the main deployment. It also means the first deploy of a fork fails unless you have set both secrets or `DRIVE_BACKUP=off` (below) beforehand.

### Opting out of Drive backup (forks)

If you don't want Drive backup, set the repository **variable** `DRIVE_BACKUP` to `off` (case-insensitive): **Settings → Secrets and variables → Actions → Variables → New repository variable**. The deploy then skips the Google secret check and injection, and the app hides the Cloud Backup section and skips the sync and OAuth handling. Remove the variable (or set it to anything else) to restore the strict behaviour. This is a variable, not a secret.

### Forks and other copies

A fork doesn't inherit the original repo's secrets, and it can't reuse another owner's OAuth client or broker: Google rejects the fork's redirect URI and the broker rejects the fork's origin. A fork therefore either follows all the steps above with its **own** Google client, `oauth-worker` and secrets, or sets `DRIVE_BACKUP=off`.

## Transcription Worker (optional)

Transcribing saved audio later (offline recordings, audio files from the library) needs a small backend that holds a Groq API key, because the key must never live in the app or the repo.

```sh
cd transcribe-worker
npm install
npx wrangler login
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put ALLOWED_ORIGIN      # recommended; e.g. https://<your-user>.github.io
npx wrangler deploy
```

You need a free Cloudflare account and a free Groq API key. Copy the printed Worker URL and paste it into the app: **Settings → Voice Transcription → Transcription server URL**. This is a per-user setting, not code. If `ALLOWED_ORIGIN` is unset this Worker allows all origins (`*`), which is convenient for testing and less secure; a comma-separated list is supported. See `transcribe-worker/README.md` for details. Live transcription while recording does **not** need this Worker.

## When to redeploy the Workers

The Workers deploy **independently** of the site. A normal `git push` deploys the site to GitHub Pages but never touches the Workers; run `wrangler` yourself from the Worker's folder.

- **Redeploy** (`npx wrangler deploy`) when you change a Worker's source in `src/` or its `wrangler.toml`.
- **No redeploy** is needed for secrets: `npx wrangler secret put GROQ_API_KEY` (rotating the key), `GOOGLE_CLIENT_SECRET`, or `ALLOWED_ORIGIN` take effect immediately.

**Migrating an existing deployment** that still has `ALLOWED_ORIGIN` as a plain variable in `wrangler.toml`: deploy the updated `wrangler.toml` first (this removes the plain variable; until the secret exists, the OAuth Worker denies all origins and the transcription Worker allows `*`), then immediately run `npx wrangler secret put ALLOWED_ORIGIN`.

## Changing the domain or repository name

If the app moves to a different Pages repo name or a custom domain, no app code changes: all paths are relative or derived at runtime. Update these external settings:

- **Google OAuth:** update the authorized redirect URI and JavaScript origin in Google Cloud Console to the new URL (exact match, including the trailing slash).
- **`ALLOWED_ORIGIN` on both Workers:** add the new origin with `npx wrangler secret put ALLOWED_ORIGIN`. For a zero-downtime move put both origins in the comma-separated list first, migrate, then put only the new one.
- **`OAUTH_BROKER_URL`:** only if the OAuth Worker's own URL changed. The `GOOGLE_CLIENT_ID` secret isn't tied to the site URL either.
- **Transcription server URL:** if the transcription Worker's own URL changed, update it in each user's **Settings → Voice Transcription**.

## Repository layout note

`oauth-worker/` and `transcribe-worker/` live in the same repository as the site (a monorepo) but have separate deploys: the site deploys to GitHub Pages via Actions, the Workers deploy to Cloudflare via `wrangler`. Because the repo contains no secrets, the whole repo, Worker folders included, is safe to publish.

If something doesn't work, see [Troubleshooting](troubleshooting.md).
