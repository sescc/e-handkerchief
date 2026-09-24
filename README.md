# e-Handkerchief

A mobile-first PWA for tying location-aware knots — quick reminders you capture with voice, photo/video, or text — with automatic GPS tagging and timestamp. Browse them in the Knots list or on a monthly Calendar, and share any single knot through your device's own share sheet. All data is stored locally in IndexedDB and works fully offline after first load; connect Google Drive for automatic two-way backup across devices.

## Build

```sh
tsc                   # compiles src/**/*.ts
tsc -p tsconfig.sw.json   # compiles sw.ts (Service Worker, separate lib)
```

Compiles all TypeScript sources to ES modules. No npm install required by end users (only `tsc` needed at build time).

## Tests

There's no test framework — each pure module has a small, dependency-free test file
(`*.chartest.ts` / `*.proptest.ts`) that runs directly under `node` after compiling:

```sh
npx tsc
node src/router.chartest.js
node src/syncPlan.chartest.js
node src/knotSummary.chartest.js
node src/components/timezoneCombobox.proptest.js
```

Each prints one PASS/FAIL line per case and exits non-zero on failure. You need Node on
your PATH to run them (the same Node that provides `tsc`); no other setup is required.

## Serve (local preview only)

This step is for **local development/preview on your own machine**. End users never
run a server — they install the PWA straight from the deployed URL (see *Deploy to
GitHub Pages* below).

```sh
python -m http.server 8080
# or: npx serve .
```

Then open http://localhost:8080 in your browser.

> **Note:** HTTPS is required for Service Worker, Geolocation, and MediaRecorder on real devices.
> Use ngrok or a similar tunnelling tool for device testing:
> ```sh
> ngrok http 8080
> ```

## Voice Transcription

A knot's voice recording can be turned into text in two ways.

### How transcription works (two modes)

- **Live (online):** When "Voice Transcription" is enabled in Settings and you record a voice recording while online in a supporting browser (Chrome on Android), it's transcribed live on-device via the Web Speech API as you speak. The audio is also saved.
- **Deferred (offline / later):** If you record while offline (or live transcription isn't available), the audio is saved and marked "transcription pending." Later, when online, open the knot and tap "🎧 Transcribe voice" to transcribe the saved audio via your transcription server (Groq Whisper via a Cloudflare Worker). The transcript is appended to that recording.

### Setting up the transcription server (optional)

Deferred/offline transcription requires a small backend proxy that holds the Groq API key securely. The key must never live in the PWA or its repo.

- That backend lives in the `transcribe-worker/` folder in this repo (a Cloudflare Worker). See `transcribe-worker/README.md` for full setup.
- Quick version: create a free Cloudflare account and a free Groq API key, then in `transcribe-worker/`:

  ```sh
  npm install
  npx wrangler login
  npx wrangler secret put GROQ_API_KEY
  npx wrangler deploy
  ```

  Copy the resulting Worker URL.
- In the PWA: **Settings → Transcription** → paste the Worker URL into "Transcription server URL".
- Live transcription does NOT need this server — it only needs internet and a supporting browser.

### Cloudflare Worker: when to re-deploy

The Worker deploys **independently** of the PWA. A normal `git push` deploys the PWA to
GitHub Pages but does **not** touch the Worker — you must run `wrangler` yourself.

Re-deploy the Worker when you:

- change the Worker source in `transcribe-worker/src/`,
- change `transcribe-worker/wrangler.toml` (e.g. `ALLOWED_ORIGIN` for a domain change), or
- rotate the Groq API key.

Run these from the `transcribe-worker/` folder:

```sh
cd transcribe-worker
npm install                          # first time only
npx wrangler login                   # first time only
npx wrangler secret put GROQ_API_KEY # to set/rotate the Groq key
npx wrangler deploy                  # deploy code + wrangler.toml vars
```

> Changing the `GROQ_API_KEY` secret via `wrangler secret put` takes effect immediately
> (no code deploy needed). But changing `ALLOWED_ORIGIN` in `wrangler.toml` **does**
> require `npx wrangler deploy`.

See `transcribe-worker/README.md` for full details.

### Repo structure note

The `transcribe-worker/` folder lives in this SAME repository (a monorepo) and is committed alongside the PWA.

- The two parts deploy independently: the PWA deploys to GitHub Pages via the Actions workflow; the Worker deploys to Cloudflare via `wrangler deploy`. They share a repo but not a deploy pipeline.
- The GitHub Pages workflow only publishes the PWA's own files (`index.html`, `app.css`, `manifest.webmanifest`, `sw.js`, `config.js`, `src/`, `icons/`); the `transcribe-worker/` folder is not part of the deployed site.
- The repo contains NO secrets (the Groq key is a Cloudflare secret set via `wrangler secret put`), so the whole repo — worker subfolder included — is safe to push publicly.

## Sharing a knot

Every knot has a **📤 Share** button on its detail page (`#/knot/{id}`), next to Edit and
Delete. Tapping it opens your device's own share sheet — whatever it offers: email,
messaging apps, Bluetooth, AirDrop, "Copy", and so on.

- The shared **text** is built from the knot: its timestamp, its place (a resolved address
  or coordinates, plus a Google Maps link, or a manually-entered label), every text item,
  every transcript, and a summary line like `(1 photo, 1 voice recording attached in
  e-Handkerchief)`.
- **Photos, videos, and voice recordings** are attached as files too, but only when the
  browser supports sharing files and their combined size is 50 MB or less; otherwise just
  the text is shared.
- If the browser has no share sheet at all (`navigator.share` unsupported), the text is
  copied to the clipboard instead, with a toast confirming the copy.
- Cancelling the share sheet does nothing — no error, no toast.

A **daily email summary** (an automatic digest of the day's knots, emailed to a recipient
you configure) is planned but not built yet. Settings → Daily Email Summary still has the
enable toggle and recipient field, saved for when it ships, but until then Share is how you
get a knot out of the app.

## Cloud Backup & Sync (Google Drive)

Google Drive backup is **always available** on a deployed site. Each user decides whether to
tap **Connect** with their own Google account; until they do, knots stay local in IndexedDB.
The app uses OAuth2 with PKCE and the Drive **app-data folder** scope, so it can only read
and write its own backup files, never the rest of your Drive.

How the pieces fit:

- The OAuth **client ID** and the **OAuth broker URL** are injected into `config.js` at
  deploy time from GitHub Actions secrets. The deploy **fails** if either is missing.
- The OAuth **client secret** is held only by `oauth-worker/`, a small Cloudflare Worker
  operated by the site owner. Google "Web application" clients require the secret even
  with PKCE, so the Worker adds it when exchanging and refreshing tokens. See
  `oauth-worker/README.md`.

> **Why not put the client secret in GitHub Actions secrets too?** GitHub secrets are only
> hidden inside CI. Anything injected into the static site ends up in `config.js`, which
> anyone can read at `https://<site>/config.js`. The client ID is designed to be public; the
> secret is not, and must stay on a server, which here is the Worker.

### How sync works

Once connected, sync is **automatic and two-way** — you don't have to do anything for a
knot tied on one device to show up on another signed into the same Google account. A sync
runs: on app startup (if already connected and online), whenever the device comes back
online, immediately after you connect, and whenever you tap **Merge with Cloud** in
Settings. For each knot, whichever side was edited most recently — this device or Drive —
wins; the older copy is replaced.

**Multiple devices, one account:** because every device connected to the same Google
account shares one Drive app-data folder, a knot created on your phone appears on your
tablet (and vice versa) after their next sync — no pairing step, no per-device setup beyond
tapping Connect on each one.

There are two different kinds of "delete", and the app explains both right in Settings:

> **Deleting a knot** (from Knots or its detail page) removes it from **this device only**.
> Its cloud backup is kept, and your other devices keep their copies.
>
> **Manage backups** deletes a knot's **cloud backup**. Copies already on your devices are
> not deleted, and they won't be backed up again unless you edit them.

**Why a separate "Manage backups" screen exists:** app-data-folder files are Google's
*hidden* app data — they don't show up in the regular Drive web UI or the Drive app at
all. The only built-in way to remove them yourself is Google's account-level "Delete
hidden app data" tool, which is all-or-nothing (every app's hidden data, not just this
one's) and only available from a desktop browser. "Manage backups" (Settings → Cloud
Backup) is the only way to remove one knot's backup without nuking every hidden app-data
file on your account from a desktop.

**Merge with Cloud / Last merged:** Settings → Cloud Backup has a **Merge with Cloud**
button (greyed out, with a hint, when disconnected or offline) that runs a sync on demand
and reports how many knots were pulled and pushed. Data is never deleted during a merge.
Below it, **Last merged** shows the time of the most recent successful sync, or "Not merged
yet".

### Setting up cloud backup (site owner)

1. In **Google Cloud Console**, create an **OAuth 2.0 Web application** client. Add an
   **Authorized redirect URI** (and a matching JavaScript origin) that **exactly** matches
   your deployed URL: `https://<username>.github.io/<repo-name>/` — note the trailing
   slash. This value equals `location.origin + location.pathname` at runtime. Note the
   client ID and client secret.
2. Deploy the OAuth broker:

   ```sh
   cd oauth-worker
   npm install
   npx wrangler login
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler deploy
   ```

   Check that `ALLOWED_ORIGIN` in `oauth-worker/wrangler.toml` is your site's origin
   (e.g. `https://sescc.github.io`). Copy the printed Worker URL.
3. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New repository
   secret** and add:
   - `GOOGLE_CLIENT_ID`: the client ID
   - `OAUTH_BROKER_URL`: the Worker URL, e.g. `https://ehk-oauth.<subdomain>.workers.dev`
4. Push to `main` (or re-run the deploy workflow).
5. In the app, go to **Settings → Cloud Backup → Connect** to authorize.

> Locally, the committed `config.js` holds only placeholders, so the app shows "Google
> Drive client ID not configured" when you tap Connect. Neither value is ever committed.

### Self-deploying / forks

The OAuth client and broker are tied to the site owner. A fork **does not** inherit the
repo's GitHub secrets. It also can't reuse the owner's client or broker: Google rejects the
fork's redirect URI, and the broker rejects the fork's origin. To self-deploy, follow all
the steps above with your **own** Google OAuth client, your own `oauth-worker` deployment,
and your own two GitHub secrets. Until those exist, the fork's deploy workflow fails at
"Inject Google Drive OAuth config".

## Changing the domain / custom domain

If the app moves to a different GitHub Pages repo name **or** a custom domain, update the
following **external** configs. The app code itself needs no edits — all asset, manifest,
service-worker, and OAuth paths are relative or derived at runtime.

- **Google OAuth:** add or update the **Authorized redirect URI** and JavaScript origin in
  Google Cloud Console to the new URL. It must match `location.origin + location.pathname`
  exactly, including the trailing slash. No code change needed — the redirect URI is derived
  at runtime.
- **Cloudflare Worker CORS:** update `ALLOWED_ORIGIN` in `transcribe-worker/wrangler.toml`
  to include the new origin, then redeploy the Worker (`npx wrangler deploy`). For a
  zero-downtime migration, use the comma-separated list: add the new origin alongside the
  old one and deploy, migrate traffic, then remove the old origin and deploy again.
- **OAuth broker CORS:** update `ALLOWED_ORIGIN` in `oauth-worker/wrangler.toml` the same
  way, then redeploy it. The GitHub secrets (`GOOGLE_CLIENT_ID`, `OAUTH_BROKER_URL`) are not
  tied to the site URL and don't need changing. Only update `OAUTH_BROKER_URL` if the
  Worker's own URL changes.
- **Transcription server URL in the app:** if the Worker URL itself changes, update it in
  the app's **Settings → Transcription server URL** (a per-user setting, not code).
- **No hardcoded domain in the app code:** the PWA needs no code edits for a domain change —
  only the external configs above.

## Deploy to GitHub Pages

The app is designed to run from a **subpath** such as
`https://<username>.github.io/<repo-name>/`. All asset, manifest, service-worker,
and OAuth paths are relative, so no configuration is needed for the subpath.

1. Push the repo to GitHub (default branch `main`).
2. In the repo, go to **Settings → Pages → Source** and select **"GitHub Actions"**.
3. The included workflow (`.github/workflows/deploy.yml`) compiles the TypeScript
   (`tsc` + `tsc -p tsconfig.sw.json`), injects a build version into `sw.js` and the
   Google client ID and OAuth broker URL into `config.js` (failing if either secret is
   missing), publishes the PWA's files
   (`index.html app.css manifest.webmanifest sw.js config.js` plus `src/` and `icons/`),
   and deploys automatically on every push to `main`. You can also trigger it manually
   from the **Actions** tab (*workflow_dispatch*).
4. Once the workflow finishes, the app is live at
   `https://<username>.github.io/<repo-name>/`.
5. **On your phone:** open that URL in Chrome (Android) or Safari (iOS), then tap
   **"Add to Home Screen"**. After the first load it works fully offline — capture,
   Knots, and settings all run from the local IndexedDB store and cached assets.

> The compiled `.js` output is rebuilt fresh in CI, so the committed source of truth
> is the TypeScript in `src/` and `sw.ts`. A `.nojekyll` file at the project root
> disables Jekyll processing so the `src/` folder is served verbatim.

## Project Structure

```
e-Handkerchief/
├── index.html              # App shell
├── app.css                 # All styles (mobile-first)
├── manifest.webmanifest    # PWA manifest
├── config.js               # Runtime config: Google client ID + OAuth broker URL injected at build time
├── sw.ts / sw.js           # Service Worker
├── tsconfig.json           # Compiles src/**/*.ts
├── tsconfig.sw.json        # Compiles sw.ts separately (WebWorker lib)
├── src/
│   ├── app.ts              # Entry point
│   ├── types.ts            # TypeScript interfaces
│   ├── db.ts               # IndexedDB Promise helpers, DB_VERSION, store name constants
│   ├── knotStore.ts        # Knot CRUD + local delete tombstones
│   ├── settingsStore.ts    # Settings persistence
│   ├── router.ts           # Hash-based routing
│   ├── router.chartest.ts  # Test: parseHash
│   ├── eventBus.ts         # Pub/sub event system
│   ├── geoService.ts       # Geolocation + reverse geocoding
│   ├── mediaService.ts     # Audio/photo/video capture
│   ├── mapsLink.ts         # Maps link builder
│   ├── dateFormat.ts       # Date/time formatting helpers
│   ├── remoteTranscribe.ts # Deferred transcription via Worker
│   ├── transcriptionService.ts
│   ├── knotSummary.ts      # Pure: share summary text + media filenames
│   ├── knotSummary.chartest.ts # Test: knotSummaryText / mediaFileName
│   ├── shareService.ts     # Web Share API wrapper + clipboard fallback
│   ├── syncPlan.ts         # Pure: two-way sync push/pull/dedupe decisions
│   ├── syncPlan.chartest.ts    # Test: planSync
│   ├── notificationService.ts
│   ├── cloudSyncService.ts # Google Drive backup: OAuth2 PKCE, upsert, two-way sync, backups
│   ├── toastService.ts
│   ├── components/
│   │   ├── mediaCapture.ts
│   │   ├── timezoneCombobox.ts
│   │   └── timezoneCombobox.proptest.ts # Test: the combobox's pure helpers
│   └── screens/
│       ├── captureScreen.ts
│       ├── knotsScreen.ts
│       ├── calendarScreen.ts
│       ├── knotDetailScreen.ts
│       └── settingsScreen.ts
├── icons/                  # PWA icon assets
├── oauth-worker/           # Cloudflare Worker: Google OAuth token broker, owner-operated (deploys separately via wrangler)
└── transcribe-worker/      # Cloudflare Worker: Groq Whisper transcription proxy (deploys separately via wrangler)
```
