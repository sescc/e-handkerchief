# Implementation Plan: e-Handkerchief

> **Historical:** this task list records the original build plan and is not kept in sync with the code. The spec of record is requirements.md + design.md (Knot terminology, Drive sync and Share were added 2026-09-24).

## Overview

e-Handkerchief is a mobile-first PWA for capturing location-aware notes (voice, photo/video, or text) with automatic GPS tagging and timestamp. All data is stored locally in IndexedDB for full offline operation. The stack is vanilla HTML, CSS, and TypeScript compiled to ES modules via `tsc` — no framework runtime, no bundler, no npm install required by end users. Optional features include voice transcription, email summary, cloud backup to Google Drive, and a persistent Android notification shortcut.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": [1] },
    { "wave": 2, "tasks": [2, 3, 4, 5, 6, 7, 8] },
    { "wave": 3, "tasks": [9, 10] },
    { "wave": 4, "tasks": [11, 12, 13, 14] },
    { "wave": 5, "tasks": [15, 16, 17] },
    { "wave": 6, "tasks": [18] }
  ]
}
```

## Tasks

- [ ] 1. Project Setup
  **Requirements:** 5.3, 10.4
  **Priority:** required
  **Depends on:** none
  - [ ] 1.1. Create `tsconfig.json` with `target: "ES2020"`, `module: "ES2020"`, `moduleResolution: "bundler"`, `lib: ["ES2020","DOM","DOM.Iterable"]`, `outDir: "."`, `rootDir: "."`, `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `esModuleInterop: true`, `sourceMap: true`; include `src/**/*.ts` and `sw.ts`
  - [ ] 1.2. Create directory structure: `src/`, `src/screens/`, `static/icons/`; add `.gitkeep` placeholders where needed
  - [ ] 1.3. Create `index.html` app shell with `<meta charset>`, `<meta name="viewport" content="width=device-width,initial-scale=1">`, `<meta name="theme-color">`, `<link rel="manifest" href="/manifest.webmanifest">`, `<link rel="stylesheet" href="/app.css">`, and `<script type="module" src="/src/app.js">` — no inline scripts, strict CSP `<meta>` tag
  - [ ] 1.4. Create `app.css` with CSS custom properties for colour palette (`--color-primary`, `--color-surface`, `--color-text`, etc.), spacing scale, mobile-first base styles, and `prefers-color-scheme: dark` overrides
  - [ ] 1.5. Create `manifest.webmanifest` skeleton with `name`, `short_name`, `start_url: "/#/"`, `display: "standalone"`, `background_color`, `theme_color`, placeholder `icons` array, and one `shortcuts` entry pointing to `/#/`
  - [ ] 1.6. Verify `tsc --noEmit` exits with no errors on the empty project skeleton
  - [ ] 1.7. Add a root-level `README.md` documenting the single build command (`tsc`) and how to serve the output (`python -m http.server` or any static file server)

- [ ] 2. TypeScript Types & DB Layer
  **Requirements:** 5.1, 5.2
  **Priority:** required
  **Depends on:** 1
  - [ ] 2.1. Create `src/types.ts` exporting all shared interfaces: `Note`, `NoteTimestamp`, `NoteLocation`, `MediaItemBase`, `AudioMediaItem`, `PhotoMediaItem`, `VideoMediaItem`, `TextMediaItem`, `MediaItem` (discriminated union), `AppSettings`, `OAuthToken`, `EmailJob`, `EmailJobStatus`, `CloudUploadJob`, `UploadJobStatus`
  - [ ] 2.2. Create `src/db.ts` with `openDB(): Promise<IDBDatabase>` — opens `e-handkerchief-db` at version 1; creates `notes` store (keyed on `id`, `createdAt` index), `emailJobs` store (keyed on `id`, `status` index), `cloudUploadJobs` store (keyed on `id`, `status` index), and `settings` store (keyed on fixed key `"app"`) in `onupgradeneeded`
  - [ ] 2.3. Implement `dbGet<T>(db, store, key): Promise<T | undefined>` — wraps `IDBStore.get` in a `new Promise`, resolves with the result or `undefined`, rejects on `onerror`
  - [ ] 2.4. Implement `dbPut<T>(db, store, value): Promise<void>` — wraps `IDBStore.put`, resolves on `onsuccess`, rejects on `onerror`
  - [ ] 2.5. Implement `dbDelete(db, store, key): Promise<void>` — wraps `IDBStore.delete`, resolves on `onsuccess`, rejects on `onerror`
  - [ ] 2.6. Implement `dbGetAll<T>(db, store, indexName?, direction?): Promise<T[]>` — opens a cursor on the given index (or the store itself), accumulates all values in order, resolves with the array
  - [ ] 2.7. Implement `dbGetAllByIndex<T>(db, store, indexName, query): Promise<T[]>` — queries the named index with the given `IDBKeyRange` and returns all matching records
  - [ ] 2.8. Run `tsc --noEmit`; confirm no type errors

- [ ] 3. NoteStore
  **Requirements:** 5.1, 6.2, 13.1
  **Priority:** required
  **Depends on:** 2
  - [ ] 3.1. Create `src/noteStore.ts`; open (and cache) the DB via `openDB()` from `db.ts` on first call
  - [ ] 3.2. Implement `save(note: Note): Promise<void>` — calls `dbPut` on the `notes` store; must resolve within 1 second under normal storage conditions
  - [ ] 3.3. Implement `get(id: string): Promise<Note | undefined>` — calls `dbGet` on the `notes` store
  - [ ] 3.4. Implement `listAll(): Promise<Note[]>` — calls `dbGetAll` with the `createdAt` index and `"prev"` direction to return notes newest-first
  - [ ] 3.5. Implement `delete(id: string): Promise<void>` — calls `dbDelete` on the `notes` store; removes the note record and all associated media blobs
  - [ ] 3.6. Export a plain singleton object `noteStore` implementing `NoteStoreAPI`
  - [ ] 3.7. Run `tsc --noEmit`; confirm no type errors

- [ ] 4. SettingsStore
  **Requirements:** 12.8, 12.10
  **Priority:** required
  **Depends on:** 2
  - [ ] 4.1. Create `src/settingsStore.ts`; define `DEFAULT_SETTINGS: AppSettings` with `transcriptionEnabled: false`, `emailSummaryEnabled: false`, `emailSummaryRecipient: null`, `cloudBackupProvider: null`, `cloudBackupToken: null`, `notificationPermissionRequested: false`
  - [ ] 4.2. Implement `load(): Promise<AppSettings>` — reads from the `settings` store via `dbGet`; merges the stored object (if any) with `DEFAULT_SETTINGS` so every absent key gets its default; caches the result in module-level `_current`
  - [ ] 4.3. Implement `save(patch: Partial<AppSettings>): Promise<void>` — merges `patch` into `_current`, writes to IndexedDB via `dbPut`, updates `_current`, then fires all registered `onChange` listeners; must resolve within 500 ms
  - [ ] 4.4. Implement `getCurrent(): AppSettings` — returns the in-memory `_current` object synchronously; throws if `load()` has not yet been called
  - [ ] 4.5. Implement `onChange(listener: (settings: AppSettings) => void): () => void` — registers a listener and returns an unsubscribe function that removes it
  - [ ] 4.6. Export a plain singleton object `settingsStore` implementing `SettingsStoreAPI`
  - [ ] 4.7. Run `tsc --noEmit`; confirm no type errors

- [ ] 5. EventBus & ToastService
  **Requirements:** (supporting infrastructure)
  **Priority:** required
  **Depends on:** 1
  - [ ] 5.1. Create `src/eventBus.ts`; define `EventMap` type with keys `"note:saved"` (`Note`), `"settings:changed"` (`AppSettings`), `"sw:waiting"` (`void`)
  - [ ] 5.2. Implement `emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void` — dispatches to all registered callbacks for that event key
  - [ ] 5.3. Implement `on<K extends keyof EventMap>(event: K, cb: (data: EventMap[K]) => void): () => void` — registers a callback and returns an unsubscribe function
  - [ ] 5.4. Create `src/toastService.ts`; on first call ensure a `<div id="toast-container">` exists appended to `<body>`
  - [ ] 5.5. Implement `show(message: string, durationMs?: number): void` — creates a `<div class="toast">`, sets `textContent` (never `innerHTML`) to `message`, appends to the container, removes after `durationMs` (default 5000 ms)
  - [ ] 5.6. Implement `showPersistent(message: string, onDismiss?: () => void): () => void` — same as `show` but never auto-removes; returns a dismiss function; toast is also dismissed on user tap
  - [ ] 5.7. Run `tsc --noEmit`; confirm no type errors

- [ ] 6. Router
  **Requirements:** 1.1, 6.1, 13.1
  **Priority:** required
  **Depends on:** 1
  - [ ] 6.1. Create `src/router.ts`; define `Route` type (`"capture" | "journal" | "note" | "settings"`), `RouteMatch` interface (`{ route: Route; params: Record<string, string> }`)
  - [ ] 6.2. Implement `parseHash(hash: string): RouteMatch` — maps `""` / `"#/"` → capture, `"#/journal"` → journal, `"#/note/:id"` → note with extracted `id`, `"#/settings"` → settings; unknown hashes fall back to capture
  - [ ] 6.3. Implement `navigate(path: string): void` — sets `window.location.hash = path`
  - [ ] 6.4. Implement `initRouter(container: HTMLElement): void` — calls the current screen's cleanup (if any), clears `container`, parses the hash, calls the matching screen's `render(container)`, stores the cleanup function; re-runs on `hashchange` events
  - [ ] 6.5. Screens are imported lazily inside the `hashchange` / initial-load handler so the router module itself does not import screen modules at the top level (avoids circular dependency)
  - [ ] 6.6. Run `tsc --noEmit`; confirm no type errors

- [ ] 7. GeoService
  **Requirements:** 1.3, 1.4, 1.5
  **Priority:** required
  **Depends on:** 1
  - [ ] 7.1. Create `src/geoService.ts`
  - [ ] 7.2. Implement `getCurrentPosition(): Promise<NoteLocation | null>` — calls `navigator.geolocation.getCurrentPosition` with `{ timeout: 10000, maximumAge: 0 }`; resolves with a `NoteLocation` on success; resolves with `null` (never rejects) on `PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, or `TIMEOUT`; always settles within 10 seconds
  - [ ] 7.3. Implement `reverseGeocode(lat: number, lng: number): Promise<string | null>` — `fetch` the Nominatim `reverse?format=jsonv2` endpoint; return `display_name` truncated to 100 characters; return `null` on any error or non-200 response; never throw
  - [ ] 7.4. Export a plain singleton object `geoService` implementing `GeoServiceAPI`
  - [ ] 7.5. Run `tsc --noEmit`; confirm no type errors

- [ ] 8. MediaService
  **Requirements:** 2.1, 3.1, 3.5, 3.6
  **Priority:** required
  **Depends on:** 1
  - [ ] 8.1. Create `src/mediaService.ts`; define and export `MediaUnsupportedError`, `FileSizeError`, and `UnsupportedFormatError` as subclasses of `Error`
  - [ ] 8.2. Implement `startAudioRecording(): Promise<AudioRecordingHandle>` — calls `getUserMedia({ audio: true })`, creates a `MediaRecorder`; the handle exposes `result: Promise<Blob>`, `onElapsed(cb)` (fires at most every 1 second via `setInterval`), and `stop()`; auto-stops and resolves at 600 seconds; throws `MediaUnsupportedError` if `window.MediaRecorder` is undefined
  - [ ] 8.3. Implement `capturePhoto(): Promise<Blob>` and `captureVideo(): Promise<Blob>` — create a hidden `<input type="file" capture="environment">` with appropriate `accept` attribute; resolve with the validated `File` object; reject if the user cancels
  - [ ] 8.4. Implement `pickFromLibrary(): Promise<Blob>` — `<input type="file">` accepting `image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime`; resolve with the validated `File`
  - [ ] 8.5. Implement `validateMedia(blob: Blob): void` — throws `FileSizeError` if `blob.size > 100 * 1024 * 1024`; throws `UnsupportedFormatError` if `blob.type` is not one of the six allowed MIME types; called before any blob is attached to a note
  - [ ] 8.6. Implement `generateThumbnail(source: Blob): Promise<Blob>` — draws onto an offscreen `<canvas>` at 80×80 px and exports as `image/jpeg`; for video blobs, creates a `<video>` element, seeks to 0, captures the first frame
  - [ ] 8.7. Export a plain singleton object `mediaService` implementing `MediaServiceAPI`
  - [ ] 8.8. Run `tsc --noEmit`; confirm no type errors

- [ ] 9. CaptureScreen
  **Requirements:** 1.1, 1.2, 1.6, 1.7
  **Priority:** required
  **Depends on:** 3, 4, 5, 6, 7, 8, 10
  - [ ] 9.1. Create `src/screens/captureScreen.ts` exporting `render(container: HTMLElement): () => void`; on call, record `NoteTimestamp` (local ISO string + UTC offset via `Intl.DateTimeFormat`) and immediately display it; call `geoService.getCurrentPosition()` and show a spinner in the location field while `locationStatus === "loading"`
  - [ ] 9.2. Build the text area control: `<textarea maxlength="2000">` with a live character-count label (`2000 - text.length` remaining); set via `input` event listener; never use `innerHTML` for user content
  - [ ] 9.3. Build the mic button: clicking calls `mediaService.startAudioRecording()`; show a recording indicator and elapsed-time counter (updated via `onElapsed`); clicking again or after 600 s calls `handle.stop()` and appends the resulting `AudioMediaItem` to local state
  - [ ] 9.4. Build camera / library controls: clicking calls `capturePhoto()`, `captureVideo()`, or `pickFromLibrary()`; on success call `generateThumbnail`, create an `<img>` preview (≥ 80×80 px), and append the item to local state; display inline error text for `FileSizeError`, `UnsupportedFormatError`, or camera denial without clearing existing items
  - [ ] 9.5. Build the save button: validate at least one `mediaItem` is present (show "Please add at least one item before saving." if not); call `noteStore.save(note)`; fire optional post-save side-effects asynchronously (transcription, email queue, cloud sync); navigate to `#/journal` on success; show modal error on `IndexedDB` failure
  - [ ] 9.6. Disable the save button and show a spinner while `isSaving` is `true`
  - [ ] 9.7. Return a cleanup function that removes all event listeners, stops any active `AudioRecordingHandle`, and revokes all object URLs created for previews
  - [ ] 9.8. Run `tsc --noEmit`; confirm no type errors

- [ ] 10. TranscriptionService
  **Requirements:** 7.1, 7.2, 7.3
  **Priority:** optional
  **Depends on:** 1
  - [ ] 10.1. Create `src/transcriptionService.ts`; detect availability via `window.SpeechRecognition ?? window.webkitSpeechRecognition`; expose `isSupported: boolean`
  - [ ] 10.2. Implement `transcribe(audioBlob: Blob): Promise<string | null>` — if unsupported, resolve with `null` immediately; create a `SpeechRecognition` instance with `continuous: false`, `interimResults: false`; resolve with the first transcript from the `result` event; resolve `null` on `error`, `end` without result, or after a 30-second `setTimeout` guard; never reject
  - [ ] 10.3. Export a plain singleton object `transcriptionService` implementing `TranscriptionServiceAPI`
  - [ ] 10.4. Integrate into `captureScreen.ts`: after `noteStore.save()`, if `settingsStore.getCurrent().transcriptionEnabled && transcriptionService.isSupported`, call `transcribe()` in the background and patch the note via `noteStore.save`; show a 5-second auto-dismissing toast on timeout or failure
  - [ ] 10.5. Run `tsc --noEmit`; confirm no type errors

- [ ] 11. JournalScreen
  **Requirements:** 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 13.5
  **Priority:** required
  **Depends on:** 3, 5, 6, 9
  - [ ] 11.1. Create `src/screens/journalScreen.ts` exporting `render(container: HTMLElement): () => void`; call `noteStore.listAll()` on render; subscribe to `eventBus.on("note:saved", reload)` and store the unsubscribe function
  - [ ] 11.2. Render an empty-state message "No notes yet — tap + to capture your first." when the note list is empty
  - [ ] 11.3. For each note, create an `<article>` wrapped in an `<a href="#/note/{note.id}">` link; render timestamp formatted as `"Day Mon DD, YYYY HH:MM AM/PM"` using `Intl.DateTimeFormat` or a manual format function
  - [ ] 11.4. Render location as resolved address (≤ 100 chars) or `±DD.DDDDD, ±DDD.DDDDD` for raw coordinates; never hide the location field when reverse-geocoding is unavailable
  - [ ] 11.5. Render text content via `element.textContent` (never `innerHTML`) with `element.style.whiteSpace = "pre-wrap"`; render `<audio controls>` with object-URL `src` for audio; render `<img>` thumbnails (≥ 80×80) and `<video controls>` with `poster` for photo/video
  - [ ] 11.6. Attach `error` event listeners to each media element; on error replace with a grey `<div>` containing "Media unavailable" without removing the rest of the entry
  - [ ] 11.7. Return a cleanup function that removes all event listeners, revokes all object URLs, and calls the `eventBus` unsubscribe
  - [ ] 11.8. Run `tsc --noEmit`; confirm no type errors

- [ ] 12. EmailQueue
  **Requirements:** 8.3, 8.4, 8.5
  **Priority:** optional
  **Depends on:** 2, 4
  - [ ] 12.1. Create `src/emailQueue.ts`
  - [ ] 12.2. Implement `enqueue(note: Note, recipient: string): Promise<void>` — build an `EmailJob` (UUID v4 `id`, `status: "pending"`, `attempts: 0`, `lastAttemptAt: null`, composed `subject` and `bodyText`, `attachmentRefs` from media item IDs); write to the `emailJobs` IndexedDB store via `dbPut`
  - [ ] 12.3. Implement `flush(): Promise<void>` — query all `"pending"` jobs via `dbGetAllByIndex`; for each: mark `"in-flight"` and increment `attempts`; attempt delivery (POST to configured relay endpoint, or construct a `mailto:` link as fallback); on success delete the job; on failure, if `attempts >= 3` mark `"failed"` and call `toastService.showPersistent`, otherwise reset to `"pending"`; if no jobs are pending, return immediately (no-op)
  - [ ] 12.4. Ensure no job ever has `attempts > 3`
  - [ ] 12.5. Export a plain singleton `emailQueue` implementing `EmailQueueAPI`
  - [ ] 12.6. Run `tsc --noEmit`; confirm no type errors

- [ ] 13. NotificationService
  **Requirements:** 9.2, 9.3, 9.4
  **Priority:** optional
  **Depends on:** 4
  - [ ] 13.1. Create `src/notificationService.ts`
  - [ ] 13.2. Implement `requestAndRegister(): Promise<void>` — return immediately if `settingsStore.getCurrent().notificationPermissionRequested` is `true`; call `Notification.requestPermission()`; if granted, call `registration.showNotification("e-Handkerchief", { tag: "capture-shortcut", requireInteraction: true, body: "Tap to open Capture Screen" })`; always call `settingsStore.save({ notificationPermissionRequested: true })` regardless of outcome
  - [ ] 13.3. Add a `notificationclick` handler in `sw.ts` (Task 17): call `clients.openWindow("/#/")` for any notification click on tag `"capture-shortcut"`
  - [ ] 13.4. Call `notificationService.requestAndRegister()` from `app.ts` (Task 18) after `settingsStore.load()` resolves, only when `window.matchMedia("(display-mode: standalone)").matches`
  - [ ] 13.5. Run `tsc --noEmit`; confirm no type errors

- [ ] 14. CloudSyncService
  **Requirements:** 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
  **Priority:** optional
  **Depends on:** 2, 4
  - [ ] 14.1. Create `src/cloudSyncService.ts`
  - [ ] 14.2. Implement `connect(): Promise<void>` — generate PKCE `code_verifier` / `code_challenge` via `crypto.getRandomValues` + SHA-256 (`crypto.subtle.digest`); open Google OAuth2 authorisation URL in the same window; on redirect back, exchange the code for tokens; store the `OAuthToken` via `settingsStore.save`; show an error toast on failure; never embed a client secret in the bundle
  - [ ] 14.3. Implement `disconnect(): Promise<void>` — POST to the Google token revocation endpoint; call `settingsStore.save({ cloudBackupToken: null, cloudBackupProvider: null })`
  - [ ] 14.4. Implement `uploadNote(note: Note): Promise<void>` — serialise note as JSON (Blobs as base64 data URIs); POST to the Drive upload API with bearer token; on failure write a `CloudUploadJob` to `cloudUploadJobs` store and throw
  - [ ] 14.5. Implement `importAll(): Promise<{ imported: number; skipped: number }>` — list Drive `appDataFolder` files; for each, check local store for matching `id` + `createdAt`; skip matches (silently); save new notes via `noteStore.save`; return counts; calling twice must yield the same local state as calling once
  - [ ] 14.6. Implement `getConnectionStatus(): "connected" | "disconnected"` — returns `"connected"` if a valid token exists in `settingsStore.getCurrent()`
  - [ ] 14.7. Implement `onStatusChange(cb): () => void` — registers a callback fired when connection status changes; returns unsubscribe
  - [ ] 14.8. Run `tsc --noEmit`; confirm no type errors

- [ ] 15. NoteDetailScreen
  **Requirements:** 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8
  **Priority:** required
  **Depends on:** 3, 5, 6, 11
  - [ ] 15.1. Create `src/screens/noteDetailScreen.ts` exporting `render(container: HTMLElement, params: Record<string, string>): () => void`; extract `id` from `params`; call `noteStore.get(id)` and show a loading indicator while pending
  - [ ] 15.2. When `status === "found"`: render full timestamp, location (resolved address or coordinates), all media items in order
  - [ ] 15.3. Render `<audio controls>` with object-URL `src` for audio; `<img>` at full displayable resolution for photos; `<video controls>` with `poster` object URL for video; text via `element.textContent` with `white-space: pre-wrap`; transcription block if `note.transcription` is present
  - [ ] 15.4. Attach `error` listeners to each media element; on error replace with a grey `<div>` "Media unavailable" placeholder without hiding other content
  - [ ] 15.5. When `status === "not-found"`: render "Note not found" heading and a "Go to Journal" button that calls `navigate("#/journal")`
  - [ ] 15.6. Render a "← Back to Journal" button that calls `navigate("#/journal")`
  - [ ] 15.7. Return a cleanup function that revokes all object URLs and removes all event listeners; no network request is made at any point (fully offline-capable)
  - [ ] 15.8. Run `tsc --noEmit`; confirm no type errors

- [ ] 16. SettingsScreen
  **Requirements:** 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10
  **Priority:** required
  **Depends on:** 4, 5, 6, 12, 14
  - [ ] 16.1. Create `src/screens/settingsScreen.ts` exporting `render(container: HTMLElement): () => void`; read initial values from `settingsStore.getCurrent()`; subscribe to `settingsStore.onChange` and store the unsubscribe
  - [ ] 16.2. Render Voice Transcription `<input type="checkbox">` bound to `transcriptionEnabled`; on `change` call `settingsStore.save({ transcriptionEnabled })`
  - [ ] 16.3. Render Email Summary `<input type="checkbox">` bound to `emailSummaryEnabled`; render recipient `<input type="email" maxlength="254">` bound to `emailSummaryRecipient`; disable the email field when `emailSummaryEnabled` is `false`
  - [ ] 16.4. Validate the email field on `blur` with an RFC 5321-compatible regex; show inline error "Invalid email address" and skip `settingsStore.save` if invalid
  - [ ] 16.5. Render Cloud Backup section with status text (`"Connected"` / `"Disconnected"`) and a connect/disconnect `<button>` calling `cloudSyncService.connect()` or `disconnect()`; update status text via `cloudSyncService.onStatusChange`
  - [ ] 16.6. Render "Import from Cloud" `<button>` calling `cloudSyncService.importAll()` and showing a result toast `"Imported {n} notes ({m} skipped)"` on success; show an error toast on failure
  - [ ] 16.7. On any `settingsStore.save` failure: show an error toast via `toastService.show` and revert the control to its previous value
  - [ ] 16.8. Return a cleanup function that removes all event listeners and calls both unsubscribe functions
  - [ ] 16.9. Run `tsc --noEmit`; confirm no type errors

- [ ] 17. Service Worker
  **Requirements:** 5.4, 5.5, 10.1, 10.2, 10.3, 10.4
  **Priority:** required
  **Depends on:** 3, 4, 12, 14
  - [ ] 17.1. Create `sw.ts` at the project root (~120 lines); define `CACHE_NAME = "e-hk-v1"` and `PRECACHE_URLS` listing every static asset: `"/"`, `"/index.html"`, `"/app.css"`, `"/manifest.webmanifest"`, `"/src/app.js"`, `"/src/router.js"`, `"/src/db.js"`, `"/src/noteStore.js"`, `"/src/settingsStore.js"`, `"/src/eventBus.js"`, `"/src/toastService.js"`, `"/src/geoService.js"`, `"/src/mediaService.js"`, `"/src/transcriptionService.js"`, `"/src/emailQueue.js"`, `"/src/notificationService.js"`, `"/src/cloudSyncService.js"`, `"/src/screens/captureScreen.js"`, `"/src/screens/journalScreen.js"`, `"/src/screens/noteDetailScreen.js"`, `"/src/screens/settingsScreen.js"`, `"/icons/icon-192.png"`, `"/icons/icon-512.png"`, `"/icons/shortcut-capture.png"`
  - [ ] 17.2. Implement `install` handler: `event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()))`
  - [ ] 17.3. Implement `activate` handler: delete all caches whose name is not `CACHE_NAME`; call `self.clients.claim()`
  - [ ] 17.4. Implement `fetch` handler: for Nominatim hostname — network-first with 5-second timeout, cache successful responses, LRU evict beyond 50 entries; for URLs in `PRECACHE_URLS` — cache-first; all others — network-first, fallback to `new Response("Offline – resource unavailable", { status: 503 })`
  - [ ] 17.5. Implement `sync` handler: listen for tags `"email-sync"` and `"cloud-sync"`; message the active client page via `postMessage` so it calls `emailQueue.flush()` or `cloudSyncService.uploadPending()` respectively
  - [ ] 17.6. Implement `notificationclick` handler: call `clients.openWindow("/#/")` for any notification with tag `"capture-shortcut"`; `event.notification.close()` before opening
  - [ ] 17.7. Implement the update-available message: when the SW is `waiting` for a new install to activate, post `{ type: "SW_WAITING" }` to all clients; when a client posts `{ type: "SKIP_WAITING" }`, call `self.skipWaiting()`
  - [ ] 17.8. Run `tsc --noEmit`; confirm no type errors; confirm compiled `sw.js` is at the project root after `tsc`

- [ ] 18. App Entry Point & PWA Manifest
  **Requirements:** 9.1, 5.3, 11.1
  **Priority:** required
  **Depends on:** 3, 4, 5, 6, 15, 16, 17
  - [ ] 18.1. Create `src/app.ts`; call `settingsStore.load()` first; then call `initRouter(document.getElementById("app") as HTMLElement)` from `router.ts`
  - [ ] 18.2. Register the Service Worker: `navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })`; on success store the `ServiceWorkerRegistration` for `NotificationService`
  - [ ] 18.3. Listen for `message` events from the SW; on `{ type: "SW_WAITING" }` call `toastService.showPersistent("New version available — tap to reload", () => { navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" }); location.reload(); })`
  - [ ] 18.4. Listen for the `online` event on `window`; on fire call `emailQueue.flush()` and (if connected) `cloudSyncService.uploadPending()` for browsers without Background Sync support
  - [ ] 18.5. After `settingsStore.load()` resolves, if `window.matchMedia("(display-mode: standalone)").matches`, call `notificationService.requestAndRegister()`
  - [ ] 18.6. Complete `manifest.webmanifest`: finalize `icons` array with PNG entries at 192×192 and 512×512; confirm `shortcuts[0].url = "/#/"`; set correct `purpose: "any maskable"` on at least the 512 px icon
  - [ ] 18.7. Add PNG icon files at `static/icons/icon-192.png`, `static/icons/icon-512.png`, and `static/icons/shortcut-capture.png`
  - [ ] 18.8. Run `tsc`; serve the output with `python -m http.server 8080` (or equivalent); verify the app loads at `http://localhost:8080`, the SW registers without errors in DevTools, and the manifest is valid

## Notes

- **Build command:** The only step needed is `tsc`. Run it from the project root. Every `.ts` file produces a `.js` sibling at the same path. The Service Worker compiles to `sw.js` at the root, where the browser expects it.
- **Serving the output:** After `tsc`, serve the project root with any static file server:
  ```
  python -m http.server 8080
  ```
  or `npx serve .` or any other static server. HTTPS is required for the Service Worker, Geolocation, and MediaRecorder APIs; use a self-signed cert or a tunnelling tool (e.g. `ngrok`) for device testing.
- **No npm install for end users:** The compiled output is plain ES module JavaScript. There is no `node_modules` folder, no bundler, and no runtime framework. Users (or a CI pipeline) only need `tsc` available, which ships with Node.js.
- **PRECACHE_URLS maintenance:** The `PRECACHE_URLS` array in `sw.ts` must be kept in sync with the compiled JS file list manually. Every new `.ts` source file added to `src/` or `src/screens/` requires a corresponding `.js` entry in the array. This is a small, predictable maintenance cost that replaces Workbox's build-time manifest injection.
- **Offline-first is non-negotiable:** IndexedDB writes must never be gated on `navigator.onLine`. The `save` paths in `NoteStore` and `SettingsStore` must function identically whether the device is online or offline.
- **No test runner required:** The design does not include Vitest, Playwright, or fast-check. Correctness is verified by running the compiled output directly in a browser. If property-based tests are desired in the future, they can be added with a minimal Vitest setup and `fake-indexeddb` without changing any source file outside the test files.
- **Wave 2 tasks are independent:** Tasks 2–8 can all be implemented in parallel once Task 1 is complete, since they each produce a single module with no cross-dependencies within the wave (except that Task 3 imports Task 2's `db.ts` and Task 4 imports Task 2's `db.ts`).
