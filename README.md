# e-Handkerchief

A mobile-first PWA for capturing location-aware notes — voice, photo/video, or text — with automatic GPS tagging and timestamp. All data stored locally in IndexedDB. Works fully offline after first load.

## Build

```sh
tsc                   # compiles src/**/*.ts
tsc -p tsconfig.sw.json   # compiles sw.ts (Service Worker, separate lib)
```

Compiles all TypeScript sources to ES modules. No npm install required by end users (only `tsc` needed at build time).

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

Voice notes can be turned into text in two ways.

### How transcription works (two modes)

- **Live (online):** When "Voice Transcription" is enabled in Settings and you record a voice note while online in a supporting browser (Chrome on Android), the note is transcribed live on-device via the Web Speech API as you speak. The audio is also saved.
- **Deferred (offline / later):** If you record while offline (or live transcription isn't available), the audio is saved and the note is marked "transcription pending." Later, when online, open the note and tap "🎧 Transcribe voice" to transcribe the saved audio via your transcription server (Groq Whisper via a Cloudflare Worker). The transcript is appended to the note.

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

### Repo structure note

The `transcribe-worker/` folder lives in this SAME repository (a monorepo) and is committed alongside the PWA.

- The two parts deploy independently: the PWA deploys to GitHub Pages via the Actions workflow; the Worker deploys to Cloudflare via `wrangler deploy`. They share a repo but not a deploy pipeline.
- The GitHub Pages workflow only publishes the PWA's own files (`index.html`, `app.css`, `manifest.webmanifest`, `sw.js`, `src/`, `icons/`); the `transcribe-worker/` folder is not part of the deployed site.
- The repo contains NO secrets (the Groq key is a Cloudflare secret set via `wrangler secret put`), so the whole repo — worker subfolder included — is safe to push publicly.

## Deploy to GitHub Pages

The app is designed to run from a **subpath** such as
`https://<username>.github.io/<repo-name>/`. All asset, manifest, service-worker,
and OAuth paths are relative, so no configuration is needed for the subpath.

1. Push the repo to GitHub (default branch `main`).
2. In the repo, go to **Settings → Pages → Source** and select **"GitHub Actions"**.
3. The included workflow (`.github/workflows/deploy.yml`) compiles the TypeScript
   (`tsc` + `tsc -p tsconfig.sw.json`) and deploys automatically on every push to
   `main`. You can also trigger it manually from the **Actions** tab
   (*workflow_dispatch*).
4. Once the workflow finishes, the app is live at
   `https://<username>.github.io/<repo-name>/`.
5. **On your phone:** open that URL in Chrome (Android) or Safari (iOS), then tap
   **"Add to Home Screen"**. After the first load it works fully offline — capture,
   journal, and settings all run from the local IndexedDB store and cached assets.

> The compiled `.js` output is rebuilt fresh in CI, so the committed source of truth
> is the TypeScript in `src/` and `sw.ts`. A `.nojekyll` file at the project root
> disables Jekyll processing so the `src/` folder is served verbatim.

## Project Structure

```
e-Handkerchief/
├── index.html              # App shell
├── app.css                 # All styles (mobile-first)
├── manifest.webmanifest    # PWA manifest
├── sw.ts / sw.js           # Service Worker
├── src/
│   ├── app.ts              # Entry point
│   ├── types.ts            # TypeScript interfaces
│   ├── db.ts               # IndexedDB Promise helpers
│   ├── noteStore.ts        # Note CRUD
│   ├── settingsStore.ts    # Settings persistence
│   ├── router.ts           # Hash-based routing
│   ├── eventBus.ts         # Pub/sub event system
│   ├── geoService.ts       # Geolocation + reverse geocoding
│   ├── mediaService.ts     # Audio/photo/video capture
│   ├── transcriptionService.ts
│   ├── emailQueue.ts
│   ├── notificationService.ts
│   ├── cloudSyncService.ts
│   ├── toastService.ts
│   └── screens/
│       ├── captureScreen.ts
│       ├── journalScreen.ts
│       ├── noteDetailScreen.ts
│       └── settingsScreen.ts
├── static/icons/           # PWA icon assets
└── transcribe-worker/      # Cloudflare Worker: Groq Whisper transcription proxy (deploys separately via wrangler)
```
