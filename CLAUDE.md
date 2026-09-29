# e-Handkerchief

Architecture: `.kiro/specs/e-handkerchief/design.md`. Requirements: `.kiro/specs/e-handkerchief/requirements.md`.
Keep the Kiro spec files updated when making structural changes.

## Decision log

### 2026-09-22 — Google Drive "client ID not configured" despite secret being set
- **Root cause (found by Claude):** `deploy.yml` ran `sed s|__GOOGLE_CLIENT_ID__|<id>|g` on `config.js`. The same token was also the global name, so the deployed file contained `window.268521...apps.googleusercontent.com = ...`. That is a syntax error, so the script never ran, the global stayed unset, and `connect()` showed the "not configured" toast. The secret itself was fine.
- **Decision (Claude, plan approved by user):** change the placeholder to `@@GOOGLE_CLIENT_ID@@`, which is distinct from the global `window.__GOOGLE_CLIENT_ID__`. Keep the global name so `src/cloudSyncService.ts` stays unchanged.
- **Decision (Claude, plan approved by user):** add `node --check _site/config.js` after injection in CI, so a malformed config fails the build instead of deploying silently.
- **Decision (user):** reflect structural changes in the Kiro spec. The Deploy-time injection section, layout entry, and CloudSyncService contract were added to `design.md`. `requirements.md` is unchanged because behaviour is unchanged.

### 2026-09-22 — "Could not connect to Google Drive" after consent
- **Root cause (found by Claude, confirmed by probing Google):** the token exchange ran directly from the browser without `client_secret`. Google answered `invalid_request: client_secret is missing.` "Web application" OAuth clients require the secret even with PKCE.
- **Latent bug (found by Claude):** the stored refresh token was never used, so Drive calls would fail about 1 h after connecting.
- **Decision (user):** broker token exchange and refresh through a Cloudflare Worker holding the client secret. Rejected alternatives: browser-only implicit flow and Google Identity Services, both without refresh tokens.
- **Decision (user):** a separate owner-operated `oauth-worker/`, not routes on `transcribe-worker/`. The transcription Worker is per-user and self-hosted; OAuth is tied to the site owner, who alone holds the client secret.
- **Decision (user):** keep the "Transcription server URL (optional)" setting unchanged. The broker URL is injected at deploy from the `OAUTH_BROKER_URL` GitHub secret, like the client ID, and is not a user setting.
- **Decision (user):** Google Drive backup is not optional. "Always available": CI fails if `GOOGLE_CLIENT_ID` or `OAUTH_BROKER_URL` is missing. Users still choose whether to tap Connect; there is no nag and no blocking. **Supersedes** the earlier README statement "cloud backup is optional; build succeeds without the secret".
- **Decision (user asked, Claude explained):** the client secret must not be a GitHub Actions secret, because anything injected into the static site is publicly readable in `config.js`.
- **Decision (Claude):** `prompt=consent` on the auth URL so Google always returns a refresh token.
- **Decision (Claude):** an unset `ALLOWED_ORIGIN` on `oauth-worker` denies all origins, unlike `transcribe-worker`, which allows `*`.
- **Decision (Claude):** `disconnect` revokes the refresh token, sent in the POST body.
- **Decision (Claude, after advisor review):** `uploadNote` queues a retry job on *any* failure, including network throws. `uploadPending` calls `sendNoteToDrive` directly, so a failed retry doesn't create a duplicate job. `config.js` is added to the service-worker precache list.
- **Decision (Claude):** `tasks.md` (lines ~181-182, which describe the old direct-to-Google exchange) was left unchanged. It is a historical task list, not the spec of record. Open item: update it if tasks.md is meant to track current behaviour.

### 2026-09-24 — Knot terminology, Drive two-way sync, Share (plan: `~/.claude/plans/carefully-read-this-repository-jazzy-rain.md`)
Audit findings (Claude): the Knot theme was half-applied. The nav, list and calendar said "Knots"; capture, toasts, manifest, notification and all code said "Note"; the Kiro spec still said Journal/`#/journal`/`#/note/:id` and didn't document Knots or Calendar. Email Summary never flushed on save: it flushed only on the `online` event, `sync.register` was never called, and `__EMAIL_RELAY__` was never defined, so it always used `mailto:`. It also dropped per-audio transcripts. Cloud Backup uploaded only a knot's first save, always POSTed (no upsert), read only the first page on import, hardcoded MIME types on restore, never retried `failed` jobs, and never backed up knots created before connecting.
- **Decision (user):** rename note → knot fully: user-facing copy, Kiro spec, code symbols, files and CSS classes, **and persisted identifiers**. Those are the IDB store `notes`→`knots`, job field `noteId`→`knotId`, and Drive file prefix `note-`→`knot-`, and the legacy route aliases `#/journal` and `#/note/{id}` are removed. **Why:** the app is still in testing, so dropping existing local data and backups is acceptable, with no migration.
- **Decision (user):** keep `"note"` where it means something else: the `// NOTE:` remarks, "Note the `.js` extension" in the proptest, and the aria-label "Record voice note" (a generic term for an audio clip).
- **Decision (user):** per-knot save-and-send email is not wanted. Email Summary was always meant as a **daily digest** of the day's knots, which is deferred for a later decision. Claude presented the cost and architecture options: not strictly free, because Resend Free needs an owned domain and caps at 100/day, and knots live only on-device, so a server cron can't read them. Instead, add a standard per-knot **Share** button using the Web Share API with a clipboard fallback. Save-and-send is removed. The recipient setting is kept for the future digest.
- **Decision (user):** a local knot delete does **not** delete its Drive backup; Drive is an archive. Individual backups must be deletable from inside the app, because Drive's own control ("Delete hidden app data") is desktop-only and all-or-nothing. The difference between the two delete actions must be explained in the app (Settings › Cloud Backup text and the confirm dialogs) and in the README.
- **Decision (user):** automatic **two-way sync** across devices on the same Google account runs at startup, on `online`, from "Sync now", and after connecting. The newest `updatedAt` wins. A local tombstone store stops locally deleted knots from being pulled back. A cloud tombstone file stops backups deleted in the manager from being re-uploaded until the knot is edited again. **(Superseded 2026-09-29 for content: see the 2026-09-28/29 section below. Check-off state still uses newest-wins, on its own clock.)**
- **Decision (Claude, approved in plan):** a Drive upsert PATCHes the newest file for a knot without `parents` and deletes older duplicates. Share makes exactly one `navigator.share` call with the payload chosen up front, because a retry would lose the user gesture. Files are included only if `canShare({files})` passes and their total is ≤ 50 MB.
- **Decision (Claude):** tests follow the existing no-framework pattern (TS compiled by `tsc`, run with `node`, `*.chartest.ts`). Node is on Windows PATH, not in WSL.
- **Decision (user):** after Step 0, the user authorized running all remaining steps without per-step stops. Claude reviews each subagent diff and escalates only unexpected outcomes.
- **Decision (Claude, implementation):**
  - IndexedDB is now v4 with version-aware `onupgradeneeded`:
    - v2 drops `notes`, creates `knots` and clears `cloudUploadJobs`.
    - v3 adds `knotTombstones`.
    - v4 deletes `emailJobs`.
  - Local tombstones are written centrally in `knotStore.delete`.
  - `knotStore.saveFromSync` never emits events, so a pull isn't re-uploaded.
  - Screens reload on the new `knots:synced` event. The detail screen ignores it while editing.
- **Decision (Claude, implementation):**
  - Sync decisions live in the pure `src/syncPlan.ts` (`planSync`) so they're unit-testable.
  - `syncAll` is single-flight. It first flushes queued uploads, lists every appDataFolder file (paginated), then reconciles and pushes/pulls.
  - A per-item failure is logged and skipped.
  - Upload jobs for knots that were successfully pushed are deleted.
- **Decision (Claude, implementation):**
  - Drive backup files carry `appProperties {knotId, updatedAt}`, so a single listing call is enough to compare versions.
  - The `description` holds a preview for the manager.
  - Each media item stores `mimeType` / `thumbnailMimeType`.
  - Cloud tombstones live in `deleted-backups.json`. The name deliberately doesn't use the `knot-` prefix, so it's never treated as a backup.
- **Decision (Claude, review fix):** `deleteBackup` writes the cloud tombstone **before** deleting the file.
  - **Why:** if the tombstone write failed after the file was already gone, another device would re-upload the knot and silently undo the user's delete.
  - The `knot:saved` upload listener is registered before `initRouter`, so saves made during SW registration aren't missed.
  - Every fire-and-forget `syncAll`/`retryFailed` call has a `.catch`.
- **Decision (Claude, implementation):**
  - The share text builder lives in the pure `src/knotSummary.ts`, with the timestamp formatter injected so it runs under node. `collectTranscripts` moved there too.
  - Shared media files are named `knot-<type>-<n>.<ext>`, with the extension taken from the MIME type (codec parameters stripped; unknown types get `.bin`).
- **Decision (user):** all mentions of the obsolete `#/journal` and `#/note/{id}` routes are removed: router comment, the two chartest cases, Req 13.9, and the design.md clauses. They are ordinary unknown routes.
- **Decision (user):** the user-facing sync button is labelled **"Merge with Cloud"**. "Sync now" implied mirroring, as if deletions propagate, and "Import from Cloud" implied one-way.
  - The line under the button reads: "Sends new and edited knots from this device to Google Drive, and brings in new and edited knots from your other devices. Data is never deleted during a merge." The user chose that last sentence.
  - The rest of the wording follows: "Merging…", "Last merged: … / Not merged yet", "Merged — …", "Merge failed — …".
  - Internal names (`syncAll`, `lastSyncAt`) and technical docs may still say "sync".
- **Decision (user asked, Claude advised):** `.claude/settings.local.json` holds no secrets, but it exposes the Windows username and local temp paths. It is now git-ignored, together with `CLAUDE.local.md`, following the Claude Code convention that personal settings aren't committed. `CLAUDE.md` is shared and meant to be committed.
  - This replaces the user's pre-existing uncommitted `.gitignore` edit, which had removed the ignore lines for `CLAUDE.md`, `CLAUDE.local.md` and `.claude/`.
  - Commit `.claude/settings.json`, `agents/`, `commands/` and `skills/` if they're ever created.
- **Decision (user asked, Claude designed):** the Cloud Backup badge shows "Connected as <email>".
  - The email comes from Drive `about.get` (`fields=user(emailAddress,displayName)`), which the existing `drive.appdata` scope allows. So there's **no new OAuth scope and no re-consent**.
  - The email is stored locally as `AppSettings.cloudAccountEmail`. It's fetched after connecting, and at startup for older connections that have none stored. Disconnecting or an expired session clears it.
  - If the fetch fails, the badge simply shows "Connected".
- **Decision (Claude, implementation):** Settings renames the email section to "Daily Email Summary", with the hint "Coming soon … To send a single knot now, open it and tap Share". The toggle and recipient validation are unchanged, and no email is ever sent.

### 2026-09-28/29 — Merge toast fix, Check-off, Edit-conflict review, Share attribution + multi-share, Quick-capture notification (plan: `~/.claude/plans/issue-even-though-the-sorted-moth.md`)
- **Bug (found by Claude):** the Merge toast said "0 knots updated on this device, 0 backed up" even when backups worked. The main reason: every save already uploads the knot, so Merge usually had nothing left to do (0/0 was true but read as failure). There were also two real defects:
  - queued uploads flushed at the start of a merge were never counted (`uploadPending` returned void);
  - there was no "already up to date" wording and no pluralisation ("1 knots").
  - **Fix:** `uploadPending` returns a count, and the pure `src/mergeMessage.ts` builds the message. The copy is "Already up to date — nothing to merge" or "Merged — N knot(s) brought in, N backed up, N need(s) review", with zero parts omitted.
- **Decision (user):** check off a knot, distinct from delete. The user chose wording that avoids "done" or "tie", because tying a knot means creating one:
  - "Check off" / "Checked off" / "Uncheck".
  - Toasts "Checked off · Undo" and "Unchecked · Undo". Both are undoable, so an accidental uncheck can be undone.
  - "Show N checked-off knots" / "Hide checked-off knots".
- **Decision (user):**
  - A checked-off knot stays faded and struck through until the "New day starts at" time. After that it is hidden from the Knots list only. It stays in Calendar (faded) and on its detail page, where it can be unchecked.
  - The default cutoff is **03:00** (user's choice). Claude explained that 04:00 is only a convention (Anki's default), not evidence-based.
- **Decision (user):** checking off must **not** count as an edit. The user rejected the earlier proposal (a tick bumps `updatedAt`) because it would lift cloud tombstones and let a tick overwrite a text edit.
  - Check-off is a separate indicator: `Knot.checkedOffAt` plus its own clock, `checkOffChangedAt`.
  - It syncs through Drive `appProperties` with a metadata-only PATCH.
  - Manage backups shows a "Checked off" badge, so the user can see which backups are safe to delete.
- **Decision (user):** content edits made on two devices must never be silently lost. The user rejected last-write-wins. There must be a diff and a choice: keep this device's version, keep the cloud version, or keep both (the cloud version becomes a new knot). **Supersedes** the 2026-09-24 "newest `updatedAt` wins" rule for content.
- **Decision (user asked, Claude designed):** with three or more devices, every review is two-way: this device vs the latest cloud version, whichever device wrote it. Devices resolve in turn. If the cloud changes again while the review is open, the newer version is shown and nothing is overwritten. Reviews show which device made the cloud edit, via the `editedOn` appProperty ("Android", "iPhone", …).
- **Decision (user):** share attribution is on by default, with a Settings › Sharing toggle. The footer is "— Shared from e-Handkerchief" plus the app link. Multi-share is a "Select" mode in the Knots list with "Share (N)": one combined text with the header "N knots from e-Handkerchief", `———` separators and one footer.
- **Decision (user):** the notification-drawer shortcut keeps opening **Capture**. Claude explained that Android web apps can't pin an undismissable notification; that would need a native/TWA wrapper, which is out of scope. The implementation:
  - A Settings toggle requests permission on tap, not at startup.
  - The notification is re-posted on every launch and after every tap.
  - A tap opens Capture under the app's scope (this fixes the old `openWindow('/#/')` subpath bug).
- **Decision (user):** for all other new copy, the user chose Option A from the plan's copy table.
- **Decision (user):** the Settings "Merge with Cloud" description gains a final sentence, chosen by the user: "If a knot was edited on two devices, you'll be asked which version to keep."
- **Decision (Claude, implementation — approved plan):**
  - The sync base is stored per knot in a new IDB v5 store, `syncState` (`baseUpdatedAt` + an optional `conflict`).
  - `planSync` is base-aware:
    - only local changed → push;
    - only remote changed → pull;
    - both changed → conflict;
    - no base (knots from before the upgrade) → pull if remote is newer and no upload job exists, else conflict.
  - The per-save upload is guarded the same way (`ConflictError`: no overwrite, no retry job).
  - Content PATCHes omit the check-off keys, so a stale value can't overwrite a newer check-off made elsewhere.
  - `resolveConflict` sets `updatedAt = max(now, remote + 1)` for the kept local version.
- **Decision (Claude, review fix):**
  - Detail-screen content saves merge the latest stored check-off fields (`withLatestCheckOff`), because a save of the screen's stale object could revert a check-off.
  - "Keep both" saves the cloud copy locally **before** overwriting the Drive file, so the cloud version can never be lost.
- **Decision (Claude):**
  - The conflict review screen is `#/conflict/{id}` ("Review changes") and needs a connection.
  - One persistent toast ("N knot(s) also has/have edits from another device — tap to review"), a list badge ("⚠ Also edited on another device") and a detail-page banner surface conflicts.
  - Claude invented this extra copy, and the user may change it:
    - "All your knots are checked off."
    - "Could not save — please try again" / "Could not undo — please try again".
    - The diff legend and section titles.
    - "Kept this device's version" / "Kept the cloud version" / "Kept both versions".
    - "Couldn't finish — please try again. Nothing was deleted."
    - "This knot also has edits from another device." + "Review".
    - "Allow notifications" / "Blocked in browser settings".
- **Decision (Claude):** supercharge ran degraded. There is no `docs/`, OpenSpec or graphify graph in this repo, and none was scaffolded. The Kiro spec stays the spec of record.

## Session status (as of 2026-09-29)
- All of the above is implemented, and **nothing is committed or pushed**.
  - `tsc` (app + SW) passes.
  - All chartests pass: dayCutoff, deviceLabel, knotDiff, knotSummary, mergeMessage, router, syncPlan, plus the timezone proptest.
  - Kiro requirements (new Req 14–18, and amendments to 6, 8, 9, 11, 12, 13), design.md and README are updated.
- **Browser smoke-tested locally:**
  - DB v5 upgrade.
  - Check-off and Undo, in the list and on the detail page.
  - Cutoff hiding plus "Show 1 checked-off knot".
  - Calendar shows the faded knot.
  - Multi-share text with attribution on and off.
  - Conflict badge, toast, banner and review screen (with a stubbed cloud copy).
  - The Settings sections.
- **Suggested commit message:** "Fix Merge toast counts/copy; add knot check-off with day cutoff (synced separately from content); replace newest-wins with edit-conflict review; add share attribution and multi-knot share; make quick-capture notification persistent-ish and scope-correct; IDB v5; update Kiro spec and README".
- **Pending verification (real Google account, two or more devices):**
  - Merge after an offline save says "1 backed up".
  - A check-off syncs to device B without a content re-upload and shows "Checked off" in Manage backups.
  - Checking off on A and editing text on B keeps both changes. This also confirms that Drive merges `appProperties` per key, which is inferred from the docs but unconfirmed.
  - The same knot edited on two offline devices gives a review, and all three choices work.
  - With 3 devices, reviews come in turn.
  - The notification survives a tap and a relaunch on Android and opens Capture under the Pages subpath.
  - Multi-share with media opens the native sheet.
  - The earlier 2026-09-24 checks still apply, except "An edit made on B wins on A", which now gives a review if A also edited.
- **Open items:**
  - The daily email digest.
  - `?error=access_denied` handling.
  - The no-op `removeEventListener` cleanups in the other screens.
  - The Req 7 30-second transcription timeout wording.
  - Deployed `*.chartest.js` files.
  - `timezoneCombobox.js` isn't in the precache list.
  - The centre "+" nav button loses its "+" glyph on `#/knot/...` and `#/conflict/...` (pre-existing).
- **Resolved this session:**
  - The SW `openWindow` subpath bug.
  - The design.md "Service Worker Scope" wording.

## Session status (as of 2026-09-24) — superseded by 2026-09-29 below
- The Knot rename, Drive two-way sync with the backup manager, Share, and the email retirement are all implemented.
  - `tsc` passes for the app and the SW. All `*.chartest.ts` tests and the timezone proptest pass.
  - Browser smoke-tested locally: DB upgrade, tie/list/delete a knot, the Settings Cloud Backup UI while disconnected, and the Share fallback.
  - **Not committed or pushed.**
  - Suggested commit message: "Rename note→knot throughout (incl. storage), add Google Drive two-way sync with per-backup manager and delete tombstones, add per-knot Share, retire save-and-send email; update Kiro spec and README".
- **Pending verification (needs a real Google account on the deployed site, ideally two devices):**
  - A knot tied on device A appears on device B after sync.
  - An edit made on B wins on A.
  - Deleting a knot locally on A doesn't bring it back on A, and the backup still shows in Manage backups.
  - Deleting a backup in Manage backups keeps it from being re-uploaded until the knot is edited.
  - Duplicate files are cleaned up.
  - A PNG or MOV restores with the correct type.
  - A knot tied offline uploads when you're back online or at the next startup.
  - Share opens the native sheet on Android/iOS with media attached.
- **Open items:**
  - The daily email digest design (options and costs are recorded in the plan's Appendix C).
  - `?error=access_denied` handling.
  - `sw.ts` `openWindow('/#/')` ignores the GitHub Pages subpath.
  - The screens' `removeEventListener(() => …)` cleanups are no-ops.
  - Compiled `*.chartest.js` files are deployed with `src/` (harmless; the proptest already was).
  - Req 7.1/7.3's "30-second transcription timeout" may not match the current streaming `startLive()` behaviour, which auto-restarts on silence. design.md was corrected but requirements.md wasn't. This was found during Step 4 and still needs a user decision.
  - design.md "Service Worker Scope" says the SW is registered at root `/`. It's actually registered relative to the app (subpath on GitHub Pages). This is pre-existing wording that hasn't been fixed.
  - `src/components/timezoneCombobox.js` isn't in the SW precache list. This was already the case before this session. Runtime network-first caching covers it once Settings has been opened online.
- **Verified 2026-09-24 (Claude):**
  - Every one of the 33 SW precache paths exists after `tsc`.
  - A fresh install (new origin, no DB) creates DB v4 with the stores `knots`, `cloudUploadJobs`, `settings` and `knotTombstones`.
  - A knot tied there persists across navigation.
- **Resolved:** the stale `tasks.md` OAuth lines. `tasks.md` now carries a "Historical" header saying requirements.md and design.md are the spec of record.
- **Decision (Claude, review):** the Step 4 subagent rewrote the whole of design.md instead of only the stale sections, and dropped the Technology Stack section. Claude restored that section, updating its Testing row. requirements.md was checked: no acceptance criteria were lost, and every out-of-scope requirement changed only in wording (Note→Knot plus 4 accuracy refinements).

## Session status (as of 2026-09-23) — superseded by 2026-09-24 above
- The fix for "Could not connect to Google Drive" is implemented and type-checks (`tsc` for the app and SW). **Not yet committed or pushed.** Suggested commit message: "Broker Google OAuth token exchange/refresh through owner-operated oauth-worker, auto-refresh Drive tokens, and queue uploads on any failure".
- **Pending user actions, in order:**
  1. Get the client secret from Google Cloud Console.
  2. In `oauth-worker/`: `npm install`, `npx wrangler secret put GOOGLE_CLIENT_ID`, `npx wrangler secret put GOOGLE_CLIENT_SECRET`, `npx wrangler deploy`.
  3. Add a GitHub secret `OAUTH_BROKER_URL` (the Worker URL, no trailing slash).
  4. Push. The deploy fails if step 3 hasn't been done.
- **Pending verification (end to end, after deploy):**
  - Connect: status shows Connected and the URL is clean.
  - Save a note: it uploads.
  - Set `expiresAt=0` and save again: one `/refresh` call, then the upload succeeds.
  - Disconnect: access is revoked.
- **Open items:** `?error=access_denied` handling; stale `tasks.md` OAuth lines.

## Edge cases
- ~~**Secret unset or empty:** the placeholder stays, `config.js` sets the global to `''`, and Connect shows "Google Drive client ID not configured". CI logs a warning, and the build still succeeds.~~ **Superseded:** CI now fails if `GOOGLE_CLIENT_ID` or `OAUTH_BROKER_URL` is empty. Locally (no injection), both globals are `''` and Connect shows "not configured". Verified by simulating the injection with node.
- **Trailing slash on `OAUTH_BROKER_URL`:** stripped in `config.js`.
- **Worker secrets missing:** `oauth-worker` returns `500 {error:'OAuth not configured'}`, and the app shows "Could not connect to Google Drive" and logs the error. Covered by the scratch node test of the Worker handler (not committed).
- **Worker request with missing fields, bad JSON, unknown path, or wrong method:** 400/400/404/405. The same scratch test covers these.
- **Disallowed or unset origin:** the preflight returns no `Access-Control-Allow-Origin`, so the browser blocks the call. Scratch test covers it.
- **Refresh token revoked or expired (`invalid_grant`):** the token is cleared, status becomes disconnected, and the toast "Google Drive session expired — please reconnect" appears. Manual test only.
- **Access token about to expire (< 60 s) or a Drive 401:** one refresh through the broker, then one retry. Manual test: set `expiresAt=0` in IndexedDB.
- **Reload on `?code=` after a failed or finished exchange:** the code is stripped from the URL before the exchange, so it is never replayed.
- **Google returns without a refresh token:** stored as `''`. Refresh then disconnects with the "session expired" toast. `prompt=consent` should prevent this.
- **Note saved while offline, or while the broker is unreachable during a refresh:** the upload is queued. Previously only HTTP errors queued; network throws were silently lost, contrary to Req 11.3. Fixed by Claude after advisor review. Manual test only.
- **Queued retry fails again:** `uploadPending` calls `sendNoteToDrive` directly, so the existing job's attempt count advances and no duplicate job is created. Previously every failed retry enqueued a new job.
- **Cold offline launch:** `config.js` is now precached by the service worker, so the Drive globals are defined offline.
- **User cancels consent (`?error=access_denied`):** not handled specially. The param stays in the URL and nothing else happens. Open item.
- **Fork or self-deploy:** its deploy fails until it has its own Google client, its own `oauth-worker`, and both GitHub secrets. The owner's client and broker reject other origins.
- **Placeholder colliding with other identifiers:** the placeholder must not appear anywhere else in `config.js`, including comments. The guard compares against `'@@GOOGLE' + '_CLIENT_ID@@'` so sed can't rewrite the comparison. `node --check` in CI catches any breakage.
- **Stale config.js after redeploy:** the service worker is network-first for `.js`, so a normal online reload picks up the fixed file.

### Edge cases added 2026-09-24 (Knot rename / sync / Share)
- **Existing v1 test data:** the v2 upgrade drops the `notes` store and clears queued upload jobs. This is intentional (user decision) and there's no migration. Leftover `note-*.json` Drive files are listed in Manage backups as "Old-format backup", can be deleted there, and are never imported.
- ~~**Old `#/journal` or `#/note/{id}` links:** they now fall back to the Capture screen. Covered by `src/router.chartest.ts`.~~ **Superseded (user, 2026-09-24):** these are ordinary unknown routes. They have no special tests and no spec mention.
- ~~**Knot changed on both devices:** the newer `updatedAt` wins. Equal timestamps mean no change. Covered by `src/syncPlan.chartest.ts`.~~ **(Superseded 2026-09-29 for content: see the 2026-09-28/29 section below. Check-off state still uses newest-wins, on its own clock.)**
- **Knot deleted locally:** a local tombstone means it's never pulled back onto that device. The Drive backup and other devices' copies stay. Covered by `syncPlan.chartest.ts`.
- **Backup deleted in Manage backups:** a cloud tombstone blocks re-upload from every device until the knot is edited again. Copies already on devices stay. Covered by `syncPlan.chartest.ts` (tombstone before and after an edit).
- **Duplicate Drive files for one knot** (a race between devices, or old POST-only uploads): the newest is kept and the rest are deleted, both during sync and on each upsert. Covered by `syncPlan.chartest.ts`.
- **Drive knot file missing `appProperties`:** it's skipped with a warning and never pulled.
- **Knot edited while a sync pulls a newer copy:** the detail screen doesn't re-render while editing. When the user saves, their newer `updatedAt` wins on the next sync. Manual test only.
- **Repeated offline edits:** only one pending upload job is kept per knot.
- **Tombstone write fails in the manager:** the Drive file isn't deleted and an error is shown. Manual test only.
- **More than 1,000 files in Drive:** listing is paginated with `nextPageToken`.
- **Old backups without `mimeType`:** restore falls back to webm/jpeg/mp4.
- **Share with no Web Share API** (desktop Firefox, the sandboxed browser): the text is copied to the clipboard. If the clipboard is denied too, the toast "Sharing isn't supported in this browser" appears (seen in the smoke test).
- **Share media over 50 MB, or `canShare({files})` returns false:** text only is shared. The user cancelling (AbortError) is silent. Any other share error triggers a clipboard copy and a toast. There's only ever one `navigator.share` call.
- **Share text contents:** timestamp; place with a Maps link, or the manual label; text items; transcripts, including the legacy knot-level one; and a correctly pluralised media count. No blank line is ever doubled. Covered by `src/knotSummary.chartest.ts`.


### Edge cases added 2026-09-29 (Check-off / conflicts / share / notification)
- **Check-off crosses the cutoff while the list is open:** the list re-renders on `visibilitychange` and on a timer set to the next cutoff. Covered by `dayCutoff.chartest.ts` (the maths); the rest is a manual test.
- **Cutoff falls in a DST gap or overlap:**
  - In a gap, the first instant after it is used.
  - In an overlap, the first occurrence is used.
  - Covered by `dayCutoff.chartest.ts` (Europe/London 2026-03-29 and 2026-10-25), including UTC+14 and UTC−12 zones.
- **Checked off at 01:00 with a 03:00 cutoff:** hides at 03:00 the same morning. Checked off at 23:00: hides at 03:00 the next day. Covered by `dayCutoff.chartest.ts`.
- **Check-off on a knot whose backup was deleted in Manage backups:** it never recreates the backup or lifts the tombstone, because `updatedAt` is unchanged. Covered by `syncPlan.chartest.ts`.
- **Check-off on A, text edit on B:** both survive. Content PATCHes omit the check-off keys, and check-off merges on its own clock. Covered by `syncPlan.chartest.ts`. The Drive per-key merge needs a real-device check.
- **Detail screen saves after an Undo or a synced check-off:** `withLatestCheckOff` merges the stored check-off fields first. A tiny read-then-save gap remains. Manual test only.
- **Both devices edited since the last agreed version:** a conflict, never an overwrite. Covered by `syncPlan.chartest.ts`.
- **Knots from before the v5 upgrade (no base):**
  - Remote newer and no upload job → pull.
  - Otherwise → a one-time review.
  - Covered by `syncPlan.chartest.ts`.
- **Upsert race:** two devices saving the same knot within a few seconds can both pass the guard. One edit is then pulled over without review. Documented in design.md Known Limitations. Closing it needs Drive ETag writes, which are out of scope.
- **Cloud changes again during a review:** `resolveConflict` returns `changed-again`, and the screen reloads the newer version. Manual test only.
- **"Keep both" fails partway:** the cloud copy is saved locally first. If the upload of the copy fails, it stays as a local-only knot and is pushed on the next sync. Manual test only.
- **Review while offline:** "Connect to the internet to review this knot".
- **Three or more devices:** reviews are pairwise against the latest cloud version, one device at a time.
- **Multi-share media:** filenames `knot1-photo-1.jpg`, `knot2-…` never collide. The 50 MB cap applies to the combined size. There's exactly one `navigator.share` call. Covered by `knotSummary.chartest.ts` (naming); share itself was smoke-tested with a stub.
- **Attribution off:** no footer, and the multi-share header is "N knots" without the app name. Covered by `knotSummary.chartest.ts`.
- **Notification permission states:** granted = toggle; not asked = "Allow notifications" button; denied = "Blocked in browser settings"; unsupported = section hidden. Manual test only.
- **Notification swiped away on Android:** it returns at the next app launch. It can't be made unswipeable on the web.

## Refactoring Standard Operating Procedure (SOP)
When instructed to refactor code, adopt the role of a principal software engineer and execute in four strict phases:

PHASE 1: AUDIT & EXPLORE (Read-Only)
1. Read the codebase to map out core entry points, data flows, and dependencies.
2. Identify major technical debt, dead code, tight coupling, and missing type definitions.
3. Do NOT edit any files during this phase. Summarize your findings in a concise bulleted list.

PHASE 2: INCREMENTAL PLAN
1. Propose a step-by-step refactoring plan (maximum 4 steps). Each step must be self-contained and shippable.
2. Wait for explicit approval on the plan before touching any code.

PHASE 3: SAFETY NET
1. Check if tests exist for the modules being refactored.
2. If tests are missing or inadequate, write minimal characterization tests to capture current behavior BEFORE refactoring.
3. Run the test suite to confirm all baseline tests pass.

PHASE 4: EXECUTION & VERIFICATION
1. Execute ONE step of the approved plan at a time.
2. Run the build and test suite after each step. 
3. Show evidence of the successful build/test command output. 
4. If test fails, focus on fixing the application code. Do NOT modify the tests to accommodate a regression. 
5. Stop and ask for review after each step before moving to the next.