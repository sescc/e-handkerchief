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
└── static/icons/           # PWA icon assets
```
