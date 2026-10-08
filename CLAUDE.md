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

### 2026-10-03 — Open-items sweep + mobile detail-page buttons (plan: `~/.claude/plans/proceed-with-all-open-partitioned-tulip.md`)
- **Bug (reported by user):** on a phone, the knot detail page's buttons ran off the right edge. **Cause (found by Claude):** the view-mode header put ← Back, Share, Check off, Edit and Delete in one row that couldn't wrap, about 510px wide against 328px usable. `app.css` has no width breakpoints.
- **Decision (user):** use two rows plus a tick:
  - Row 1 is ← Back to Knots.
  - Row 2 is Share / Edit / Delete as smaller buttons (6px/10px, 13px) that wrap.
  - The Check off / Uncheck text button becomes the list's ✓/↩ tick (`.knot-check-btn`), shown in the card beside the timestamp (`.knot-detail-meta`) and hidden in edit mode.
  - Claude pointed out that turning Check off into a tick isn't enough on its own (Back + Share + Edit + Delete is still about 410px).
- **Bug (found by Claude):** the "+" glyph was invisible on `#/`, `#/knot/…` and `#/conflict/…`. It wasn't missing: `.nav-bar a[aria-current="page"]` (specificity 0,2,1) coloured it primary on the primary button. **Fix:** `.nav-bar .capture-btn[aria-current="page"] { color: white; }`.
- **Finding (Claude, from Google's docs):** Drive API v3 has **no** conditional writes. The `etag` field was dropped in v3, and `files.update` has no If-Match header or precondition. So the earlier note "closing the upsert race needs ETag writes" was wrong.
- **Decision (user):** narrow the race; don't redesign. Merge with Cloud (`doSyncAll` step 6) now re-lists the knot's files and re-runs the same guard as `upsertKnot` just before each content push, then writes to the freshly found file id.
  - A change detected there records a conflict, which is counted as "need review"; its queued upload job is cleared.
  - The guard is the pure `remoteChangedSinceBase` in `src/syncPlan.ts`.
  - **Rejected by user:** self-heal of the check-off keys after a content upload, and per-device files (a large redesign).
- **Decision (Claude):** don't use Drive's `version` field as a guard, because check-off metadata PATCHes bump it and would show up as content conflicts. This is recorded in code and in design.md.
- **Decision (user):** for Req 7, rewrite the text to match the live behaviour (transcribes while recording, keeps going across pauses, deferred fallback) and add a safety cap.
  - **Implementation (Claude):** `stop()` force-finishes after `STOP_SAFETY_MS = 3000` if the engine never fires `onend`. It calls `abort()` and resolves with the text collected so far.
  - **Review fix (Claude):** `onerror` ignores events that arrive after the session has finished (the async `aborted` error from that `abort()`), so the live box isn't overwritten after saving.
- **Decision (Claude, docs reconcile, to match the code):**
  - Req 7.3's notice now says it "dismisses automatically after **6** seconds". That is what ships (`toastService.show(msg, 6000)`). The old "5 seconds or on user interaction" clause was dropped, because the toast has no tap-to-dismiss.
  - 7.3 also lists "device is offline" as a trigger and says the recording is marked pending transcription.
  - New **Req 11.13** covers a cancelled or denied consent.
  - The design.md error-handling table row for transcription was corrected.
  - ~~**Open question for the user:** keep the loosened 7.3, or change the toast to 5 s plus dismiss on tap.~~ **Superseded (user, round 2):** the app now follows the old spec (5 s or dismiss on tap). See below.
- **Decision (user):** the daily email digest stays deferred. Its options, costs and privacy trade-offs are now written up in design.md › "Daily Email Summary — options (deferred)"; there's no code.
- **Decision (Claude, plan approved):** `?error=` on the OAuth return now:
  - clears `pkce_verifier`;
  - strips the URL params;
  - toasts "Google Drive connection cancelled" for `access_denied`, otherwise "Could not connect to Google Drive";
  - never changes the connection status or tokens.
  - **Copy:** "Google Drive connection cancelled" was proposed by Claude and approved with the plan.
- **Decision (Claude, plan approved):** housekeeping:
  - `timezoneCombobox.js` is added to the SW precache.
  - `deploy.yml` deletes `*.chartest.js` / `*.proptest.js` from `_site`. `tsconfig` is unchanged, because local tests need the compiled JS.
  - The nine no-op `removeEventListener` calls (captureScreen ×1, settingsScreen ×8) now use named handlers. They were dead code rather than a leak, since the elements are removed with the screen.
- **Decision (user, implicit in plan approval):** the 2026-09-29 Claude-invented copy is kept as it is, unless the user marks changes later.
- **Not done by Claude:** the real-device checks need the user's Google account and devices. The checklist is in the plan file and in "Session status (as of 2026-10-03)" below.

### 2026-10-03 (round 2) — Notice per spec, checked-off pill, Capture "+" state, location retry
- **Decision (user):** the transcription notice follows the old Req 7.3: it dismisses after **5 s or on tap**. `captureScreen` uses the default `toastService.show(msg)`.
  - **Decision (Claude, plan approved):** tap-to-dismiss applies to **every** plain `show()` toast (with `cursor: pointer`). There are about 40 callers and none of them act on a click. `showAction` (Undo) and `showPersistent` are unchanged.
- **Decision (user):** the knot page shows the checked-off state as a green pill "✓ Checked off · <date time>" under the timestamp row, with no fading or strike-through, because it's the dedicated single-knot view. The ✓/↩ tick stays.
  - The time is `formatKnotTimestamp(new Date(checkedOffAt).toISOString())`, which gives the user's zone and format.
  - Claude also checked that the `conflictScreen` and `settingsScreen` call sites that use the same pattern are correct, not UTC.
- **Decision (Claude, plan approved):** a new CSS token `--color-primary-soft` for light and dark. It is used by the pill, the `.knot-check-btn` hover state and `.backup-badge`, which fixes their dark-mode tint. ~~`.combobox-option.is-highlighted` still hard-codes the light rgba; this is minor and was left alone.~~ **Resolved 2026-10-04:** it now uses `var(--color-primary-soft)`.
- **Decision (user):** when Capture is current, the "+" is darker (`--color-primary-dark`) with a ring (3px surface gap + 2px primary). It's the normal green elsewhere.
- **Decision (user):** `#/knot/…` and `#/conflict/…` highlight the **Knots** tab. Previously the `else` catch-all marked "+" as current there. This is the pure `navTabForRoute` in `router.ts`, covered by `router.chartest.ts`.
- **Decision (user, feature request):** if location fails on Capture, tapping the line retries it with no page reload.
  - The copy, chosen by the user: "Location unavailable — tap to retry", or "Location blocked for this site — allow it in browser settings, then tap to retry".
  - The new `geoService.locate()` separates `denied` (PERMISSION_DENIED) from `unavailable`. `getCurrentPosition()` is now a wrapper. **(Extended 2026-10-04: `denied` is split further into `denied` / `off` / `unknown`; see below.)**
- **Decision (Claude, end of session):** a broken earlier edit had cut off the round-1 "daily email digest" decision and spliced this section into the middle of round 1. That was committed in `4c70b9a`, and both are now repaired.

### 2026-10-04 — Settings toggle overflow, Location off vs blocked, Sharing hint, Random knot, checked-off toggle at top (plan: `~/.claude/plans/decisions-proceed-with-p2-recursive-dawn.md`)
- **Bug (reported by user, on a phone):** a Settings toggle spilled out to the right of the screen. **Root cause (found by Claude):** `buildToggle` returns `<label class="toggle-switch">`. Inside the plain `div.settings-row-control` of the Notifications row that label stayed inline, so its 44×26 size was ignored and the absolutely positioned slider and knob spilled out.
  - **Decision (Claude, plan approved):** `.toggle-switch { display: block }` (block, not inline-block, to avoid the baseline gap). The label wrappers of the Transcription, Email, Sharing and Notifications rows also got the existing `settings-row-labelwrap` class (`min-width: 0; flex: 1`), so long text shrinks instead of pushing the toggle off-screen.
- **Decision (user):** Sharing setting copy: label `Append source when sharing`, with the small text `Adds "— Shared from e-Handkerchief" and a link to the application at the end of what you share.` The user typed "-"; Claude used "—" to match the real footer. That one-character change was flagged in the plan, which the user approved. This **supersedes** the old label "Add 'Shared from e-Handkerchief' to shared knots" (Req 12.16, design.md, README updated).
- **Bug (reported by user):** with the phone's Location switched off, Capture said "Location blocked for this site…". **Cause (found by Claude):** Android Chrome reports PERMISSION_DENIED (code 1) both when the site is blocked and when the phone's Location toggle is off.
  - **Decision (Claude, plan approved):** the new pure `src/locateFailure.ts` `classifyLocateFailure(code, permState)` tells them apart. `geoService.locate()` queries `navigator.permissions.query({name:'geolocation'})` only after a code-1 error (so the state is fresh), capped at 1 s; a throw, a missing API or a timeout gives null.
    - code 1 + denied → `denied`;
    - code 1 + granted → `off`;
    - code 1 + prompt or null → `unknown`;
    - any other or null code → `unavailable`.
  - `locate()` resolves exactly once (a `settled` flag) within about 11 s. The 10 s guard is cleared when an error arrives, so it can't fire during the lookup.
  - **Decision (user):** the Capture copy.
    - denied: "Location blocked for this site — allow it in browser settings, then tap to retry" (unchanged);
    - off: "Location is off — turn it on, then tap to retry" (user-approved);
    - unknown: "Location is off or blocked — turn it on or allow it for this site, then tap to retry" (user-approved);
    - unavailable: "Location unavailable — tap to retry" (unchanged).
  - Test: `src/locateFailure.chartest.ts`, 12 scenarios. `sw.ts` ASSETS gains `src/locateFailure.js` after `geoService`.
- **Decision (user, feature request, design approved):** **Random knot.**
  - A "🎲 Random" button in the Knots header (before Select, hidden only in select mode) opens `#/random/{id}` for a random knot that is **not checked off**, chosen from the whole store, not just the displayed list.
  - `#/random/{id}` is the same `knot` route with `params.random = '1'`, so the Knots tab stays current and no new `Route` value exists. The page gets an "Another random knot" button (first in the actions row, so Delete stays last; hidden in edit mode like Share/Edit/Delete). It never picks the knot being shown.
  - Pure `src/randomKnot.ts` `pickRandomKnot(knots, excludeId, rand)`; `sw.ts` ASSETS gains `src/randomKnot.js` after `knotSummary`.
  - **Copy:** "No unchecked knots yet" is user-approved (the user chose it with the option). "This is your only unchecked knot" and "Could not load knots" were **invented by Claude and are not yet user-approved**; the user may change them. The button labels "🎲 Random" / "Another random knot" and the aria-label "Open a random unchecked knot" came from the approved design.
  - New **Req 19**; Req 6.10, 13.11 and design.md updated.
- **Decision (user request):** the "Show N checked-off knots" / "Hide checked-off knots" toggle moves from the bottom to the **top** of the Knots list, because it was hard to reach at the bottom of a long list. It is the first child of the list, above "All your knots are checked off." and the entries. Wording and behaviour are unchanged, and the CSS spacing flipped from margin-top to margin-bottom (Req 14.6 updated).
- **Decision (Claude, plan approved):** the dark-mode combobox highlight (`.combobox-option.is-highlighted`) now uses `var(--color-primary-soft)`. This closes the 2026-10-03 P3 item.
- **Decision (user):** P2, the daily email digest, **stays deferred** this session. Nothing changes; the options remain in design.md › "Daily Email Summary — options (deferred)".
- **Decision (user):** P3, the supercharge `docs/` tree, graphify graph and OpenSpec, is **KIV**: not done this session. The design is kept in the plan `~/.claude/plans/decisions-proceed-with-p2-recursive-dawn.md` Step 5:
  - a code-only graph with no LLM;
  - OpenSpec with `skip_specs`, because Kiro `requirements.md` stays the behaviour spec of record;
  - `docs/` holding only the Dat/Trn/Loc/Trm model and the file:symbol maps, with `design.md` staying authoritative for design detail.
- **Decision (user):** at the end of every implementation, Claude puts the suggested commit message in the chat reply as a copyable code block, rather than only pointing to where it's recorded. **Why:** the user couldn't find it in this file. This is now a global rule in `~/.claude/CLAUDE.md` (all projects).

### 2026-10-05 — Location fallback, Manage-backups copy, m4a import, Mic quality, notification diagnostics (plan: `~/.claude/plans/p0-location-message-wise-kahn.md`)
- **Bug (reported by user, on a phone):** with Location switched off, Capture still said "Location blocked for this site". **Finding (Claude):** the deployed `src/locateFailure.js` was the `5690324` code, so the Permissions API returned `denied`. Android Chrome folds a blocked site, the device's Location being off, and Chrome lacking Android's location permission into the same `denied`.
  - **Decision (user):** when it's ambiguous, show the generic "Location unavailable — tap to retry". Only code 1 + `granted` gives "Location is off — turn it on, then tap to retry". The `denied` / `unknown` reasons and their copy are removed (`LocateFailureReason` is now `'off' | 'unavailable'`). **Supersedes** the 2026-10-04 `denied` / `unknown` copy.
  - The Permissions API lookup stays in `geoService.locate()`, because it is what identifies `off`.
- **Finding (user + Claude):** "Tap to copy the URL for this app" is Chrome's own notification for an installed web app. A page can't change or remove it. Claude's earlier suggestion to reinstall as a WebAPK via "Install app" was **wrong and is withdrawn**: the app was already installed via Chrome › Install.
  - **Bug (user):** our own "Tap to tie a knot" notification never appeared. The app's Android settings had notifications on, yet Android said the app "hasn't received any notifications yet". Chrome's site entry says "Managed by app".
  - **Decision (Claude, plan approved):** `ensureShown` no longer swallows errors. It returns `shown` / `skipped` / `failed` with a reason (`ShowResult`), and `enable()` returns `{ permission, show? }` (`EnableResult`). `serviceWorker.ready` is bounded at 5 s. After `showNotification` it checks `getNotifications({ tag })` for the notification being listed.
  - Settings shows "Couldn't show the notification (<reason>). Switch this off and on to try again." under the Notifications description. **Copy invented by Claude, not yet user-approved.** Opening Settings re-posts the notification once (same tag, so it replaces rather than stacks).
  - **Open:** the root cause stays unknown until the user reports the reason shown on the phone.
- **Decision (user):** the Manage-backups explanation moves directly under the "Manage backups" button. The "Manage backups deletes…" paragraph comes first, then "Deleting a knot…". The wording is unchanged. **Why:** it floated far from the button it explains.
- **Decision (user):** M4A goes into the existing **Library** button, not a separate one. Android's own chooser decides the branching. **Superseded 2026-10-06:** the Library button now opens a two-button menu (Photo or video / Audio file), and audio accepts all Whisper formats.
  - **Named fallback (Claude, plan approved, not implemented):** an in-app "Photo or video / Audio file" menu, if the phone shows that photo picking has become clunky.
  - **Decision (Claude, after advisor review):** a `.m4a` file name always means audio, stored as `audio/mp4`, because Android providers report m4a as `audio/mp4a-latm`, `audio/aac`, `video/mp4`, `''` or `application/octet-stream`. The pure `src/mediaImport.ts` `classifyImport(type, name)` decides this; `validateMedia` returns the classification and the picked blob is re-typed to the normalised type.
  - A picked m4a becomes an `AudioMediaItem` (duration from `<audio>` metadata, 3 s cap, `0` on failure; `transcriptionStatus` pending if transcription is enabled, else none). It is played with `<audio controls>` and transcribed with the existing "🎧 Transcribe voice" panel; `remoteTranscribe` uploads `audio/mp4` as `audio.m4a`.
  - New copy: "Unsupported file format. Please use JPEG, PNG, GIF, WEBP, MP4, MOV, or M4A." and the post-save toast "Saved. To transcribe the audio file, open the knot and tap 'Transcribe voice'." (shown when every pending audio item was imported). **The import toast copy was invented by Claude and is not yet user-approved.**
- **Bug (user):** Mic recordings were glitchy and transcribed poorly. **Likely causes (Claude):** call-style processing (echo cancellation also selects Android's voice-call mic path), and live SpeechRecognition sharing the mic and restarting after about every second of silence.
  - **Decision (user):** keep live recognition during Mic and fix only the processing and encoder settings. If hiccups remain on the phone, revisit live recognition.
  - **Implementation:** `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl` all `false` and `channelCount: 1`. A non-permission error retries with `{ audio: true }`. The recorder is opus/webm if supported, else mp4, at 128 kbps, with a fallback to the plain constructor.
  - **Risk:** with AGC off some phones may record quietly. The revert is one line (back to `{ audio: true }`).
- **Decision (Claude):** the Photo, Video and Library pickers limit the kinds they accept (Photo and Video: photo or video only; Library: also audio), so an `.m4a` picked through Photo or Video is rejected, not turned into a broken photo.
- **Spec reconciled:** requirements.md Req 1.4/1.5/1.9 (location), 2.8 (Mic), 3.4/3.7 (formats; the coordinator's "Req 4.4/4.7" is Photo and Video Input, Requirement 3 in the file), 9.8 (notification failure line), 11.11 (explanation placement); design.md (GeoService/LocateFailure, MediaService, new MediaImport section and Property 14, NotificationService, Settings layout, precache list, test list, file-type rule); README.

### 2026-10-05 (round 2) — Service worker never registered
- **Bug (reported by user, on a phone):** Settings showed "Couldn't show the notification (service worker not ready)", even after switching the toggle off and on many times.
- **Root cause (Claude, verified):** `sw.ts` had `export {};` since the initial commit `edf2e59`, so the compiled `sw.js` ended with `export {};`. `app.ts` registers `sw.js` as a classic script, where `export` is a SyntaxError, so evaluation failed and **no service worker has ever run**: no notification, no offline precache, no update toast, no notification tap handling, no Background Sync message. The app could still be installed because Chrome no longer requires a service worker for that. `node -e "new Function(…sw.js…)"` on the old file gives `SyntaxError: Unexpected token 'export'`.
- **Decision (Claude, plan approved):** remove `export {};` and keep `sw.js` a classic script (a comment in `sw.ts` says so). Module registration (`type: 'module'`) was rejected because it isn't universal (older Firefox). A CI guard in `deploy.yml` ("Inject build version into service worker" step) parses the built file with `new Function` and fails the build if it isn't a valid classic script.
- **Latent bugs fixed (Claude, plan approved):**
  - `SW_WAITING` was posted on every install, including the first, so the first install would have shown "New version available — tap to reload". It is now posted only when `sw.registration.active` already exists (an update over a running version).
  - `networkFirst` cached every successful same-origin response, including the OAuth return `/?code=…` (a single-use auth code) and one-off query URLs. It now skips `cache.put` when the URL has a query string; the offline fallback is unchanged.
- **Finding (Claude):** the in-app browser pane can't register service workers at all (the same "unknown error when fetching the script" even with the fixed `sw.js`), so service-worker checks use headless Edge over CDP against a fresh profile and the local server. The script lives in the session scratchpad, not in the repo.
- **Verification (Claude, headless Edge):** registered; `ready` true; controller true; cache `e-hk-__BUILD_VERSION__` with 43 precached entries; a fetch of `index.html?code=secret123` through the SW left 0 query-string entries; no `SW_WAITING` message on first install. `tsc` (app + SW) exits 0, and the rebuilt `sw.js` parses as a classic script with no `export`.
- **Note:** every earlier "pending verification" item that involves the service worker (offline cold start, the quick-capture notification and its tap, the update toast, the Background Sync message) was never testable before this fix.

### 2026-10-06 — Library menu, all Whisper audio formats, Dictate repeat fix
- **Reported by user (phone, 2026-10-06):** the 2026-10-05 work is generally fine: the service worker and notification work, and Mic quality is fine. Three issues: on desktop the m4a file filter showed `*.m4a` four times; on Android the single Library button made photo picking harder to use; and Dictate repeated words when the user spoke fast.
- **Decision (user):** the in-app Library menu, which was the named fallback in the 2026-10-05 section (now built). Tapping 🖼️ Library toggles an inline `.media-library-menu` with two buttons:
  - "🖼️ Photo or video" (aria "Pick a photo or video from your library") → `mediaService.pickPhotoOrVideo()`, accept `image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime`, so Android opens its photo picker directly;
  - "🎵 Audio file" (aria "Pick an audio file") → `pickAudioFile()`, accept `audio/*` (a single desktop filter entry, which fixes the four `*.m4a` entries).
  - The menu closes on a second Library tap, Escape, after a pick, or when Mic, Dictate, Photo or Video is tapped. `aria-expanded` follows it. `pickFromLibrary` is removed, and the 2026-10-05 note that Library took m4a is superseded.
- **Decision (user):** accept **every audio format Whisper (Groq) transcribes**, not only m4a. `classifyImport`:
  - a known extension wins over the reported type: m4a → `audio/mp4`; mp3, mpga, mpeg → `audio/mpeg`; wav → `audio/wav`; ogg, oga, opus → `audio/ogg`; flac → `audio/flac`; weba → `audio/webm`;
  - MIME aliases normalise as before, plus the mp3, wav, ogg, flac and webm aliases;
  - **rejected:** `audio/aac`, `.aac`, `.wma`, `.amr` (not Whisper formats);
  - the `mediaImport` chartest has 65 cases.
  - **Decision (Claude):** the single MIME→extension table is the now-exported `knotSummary.extensionForMimeType` (WAV and FLAC added). `remoteTranscribe` uses it for the upload name `audio.<ext>`, with an unknown type falling back to webm. This **supersedes** the 2026-10-05 `audio/mp4` → `audio.m4a` special case.
  - New error copy: "Unsupported file format. Please use JPEG, PNG, GIF, WEBP, MP4, MOV, or an audio file (MP3, M4A, WAV, OGG, FLAC, WEBM)." **Claude-invented, not yet user-approved.** It supersedes the 2026-10-05 "…MOV, or M4A." copy. The Photo/Video buttons show the same copy (user, 2026-10-06: keep for now).
- **Bug (reported by user):** Dictate repeats text when the user speaks fast. **Cause (Claude, likely):** Android delivers cumulative finals and revises earlier words when speech is fast. The old `assembleFinal` collapsed pieces only on a strict prefix, so a revision was joined and the phrase repeated. Across silence restarts, `endsWithSegment` caught only an exact tail.
  - **Fix (Claude):** the new pure `src/transcriptMerge.ts` (40-case chartest), word-level on normalised words:
    - `mergeFinalPieces` / `appendSegment` within one recognition instance: cumulative growth replaces; stale or re-delivered text is ignored; an anchored revision of `acc`'s tail is accepted only if the LCS is at least 60% of the tail and `next` is longer, or the same length with at least 80%;
    - `foldSegment` across instances (the fold into `committed`, `finish()` and the live text): it never revises. An exact re-delivery is ignored, an overlap of 2 or more words is merged, otherwise it appends.
  - **Review fix (Claude):** the first version used the revising merge everywhere and could drop a sentence: "I need to buy milk" + pause + "I need to call mom" lost the first sentence. That led to `foldSegment` plus the tightened thresholds. **Why:** losing text is worse than a repeat.
  - `sw.ts` ASSETS gains `src/transcriptMerge.js` after `transcriptionService.js` (44 entries).
- **Known limits (Claude, accepted):**
  - a deliberate repeat of 2+ words across a boundary ("thank you thank you") collapses;
  - an equal-length near-identical sentence within one instance ("I went to the store" / "I went to the park") counts as a revision;
  - a short-tail revision ("…bought apples" → "bought oranges and pears") is appended rather than revised.
- **Spec reconciled:** requirements.md Req 3.4/3.7 and new Req 7.5; design.md (MediaService API, mediaCapture Library menu, MediaImport tables, new TranscriptMerge section and Property 15, TranscriptionService, `extensionForMimeType`, precache list, test list); README.

### 2026-10-08 — Picked-file save failures (InvalidBlob) and the stuck edit screen
- **User phone results (2026-10-08) for the 2026-10-06 work:** Library › Audio file finds the recorder app's files; the desktop audio picker shows one filter entry; fast Dictate has no repeats or drops. Library › Photo or video is fine on desktop but "not very stable" on mobile (the bug below).
- **Bug (reported by user, on a phone):** after Library › Photo or video, saving sometimes failed with "Could not tie knot: Failed to write blobs (invalidblob)"; the same photo saved fine later on a better connection. On the edit screen, the Mic…Library buttons vanished and "Save Changes" did nothing; only Cancel got out.
  - **Cause 1 (Claude):** `pickFile` resolved the picked `File` (or `new Blob([file])`, which is still a reference). On Android, picker and cloud-backed files (e.g. a Google Photos item still downloading) are lazy, so IndexedDB read the bytes only at save time and failed with InvalidBlob. It isn't a network upload: it's the local save.
  - **Cause 2 (Claude):** the edit screen's Save Changes called `mediaCapture.destroy()` before `knotStore.save()`, with no try/catch. A failed save left the media panel removed, showed no error, and every later tap failed silently.
- **Decision (Claude, plan shown to user):** `pickFile` reads the file fully with `arrayBuffer()` when it is picked and always resolves a fresh memory-backed `Blob` with the normalised type. A failed read rejects with the new `FileReadError`, so nothing broken enters the draft. This covers Photo, Video and both Library entries; the existing 100 MB cap bounds memory.
- **Decision (Claude, plan shown to user):** the edit save destroys the media panel only after a successful save. Any throw (finalising a recording, building the knot, `withLatestCheckOff`, the store) toasts, re-enables the buttons, and leaves the form, removed items and draft media unchanged. While saving, Save shows "Saving…", Save and Cancel are disabled, and extra taps are ignored. Post-save steps are outside the try, so a render error isn't reported as a failed save.
- **Decision (user):** pick-time copy (Option A): "Couldn't read that file — it may still be downloading to your phone. Wait a moment, then pick it again."
- **Decision (user):** save-failure copy (Option A): for a media write error (message matches /blob/i, or `NotReadableError`) "Could not tie knot — a photo, video or audio file couldn't be saved. Remove it and pick it again." on Capture and "Could not save changes — …" (same text) on Edit; any other error keeps "<prefix>: <detail>". This is the pure `src/saveError.ts` (`isMediaWriteError`, `saveErrorMessage`), with a 20-check chartest. `sw.ts` ASSETS gains `src/saveError.js` after `src/mediaImport.js` (45 entries).
- **Decision (Claude):** the stale design.md error-table geolocation row now matches the 2026-10-05 behaviour.
- **Spec reconciled:** requirements.md new 3.8 (pick-time read), 5.6 (Capture save failure), 13.12 (edit save failure and Saving guard); design.md (MediaService, new SaveError section and Property 16, error table, precache list, test list); README.

### 2026-10-09 — Offline GPS wait + address backfill, Calendar thumbnails, "Not backed up" badges (plan: `~/.claude/plans/1-offline-usage-although-noble-iverson.md`)
- **Question (user):** with Location on but no internet, Capture shows "Location unavailable" — can't the phone still save plain GPS coordinates? **Finding (Claude):** yes, coordinates need no internet; only the Nominatim address does. `locate()` asked for a fresh high-accuracy fix (`maximumAge: 0`) and gave up after 10 s. Offline, without assisted GPS, a cold fix often takes 30 s to a few minutes.
  - **Decision (user):** wait longer when offline. `geoService.locate(deadlineMs = 10000)`; Capture passes 120 000 when `!navigator.onLine` and shows "Getting location (no internet — GPS can take a minute or two)…". Online is unchanged (10 s). Rejected: showing a cached last-known position (could record the wrong place).
  - **Decision (user):** fill in the address once back online. Pure `src/addressBackfill.ts` (`needsAddress`, `addPending`, `removePending`; 15-check chartest) and `src/addressBackfillService.ts` (`fillPendingAddresses`: single-flight, ≤ 10 per run, ≥ 1.1 s between Nominatim calls per its usage policy, stops when offline, keeps the id when the lookup fails). Triggers: app start and the `online` event. The fill bumps `updatedAt` and emits `knot:saved`, so the knot is backed up again.
  - **Decision (Claude):** only the device that tied the knot backfills it (local-only `AppSettings.pendingAddressKnotIds`), so two devices never both edit the same knot and trigger a conflict review.
  - **Decision (Claude, review fix):** Capture's save does not start the backfill itself. **Why:** the save's own upload is still in flight; an immediate backfill would start a second concurrent upload of the same knot (risking a duplicate Drive file or an out-of-order `setBase`).
- **Request (user):** Calendar day list thumbnails. **Decision (user):** one right-aligned 40×40 tile per media type with a count when there are several: photo (first photo, from the full blob with `object-fit: cover`), video (its thumbnail with a ▶ mark), audio (a ▶ tile). Text-only knots show none; the strip is hidden from screen readers, which get "3 photos, 1 video, 1 voice recording". Pure `src/mediaSummary.ts` (17-check chartest).
  - **Finding (Claude):** stored 80×80 thumbnails were stretched (drawn without keeping proportions). **Decision (Claude, plan approved):** `generateThumbnail` now centre-crops; existing thumbnails are not regenerated, which is why the Calendar draws photos from the full blob.
- **Decision (user, after a prototype):** the Calendar day list shows only the time, inline before the text ("03:36 · Buy milk"), instead of the full date and time on its own line — the date is already in the "Knots on …" header, and this saves a line per knot. New `formatKnotTime` in `dateFormat.ts` (follows the 12h/24h and timezone settings).
- **Question (user):** Manage backups shows only "On this device" / "Only in backup" — what about knots only on the device? **Answer (Claude):** Manage backups lists Drive files only, so a local-only knot (not backed up yet, or its backup deleted) can't appear there.
  - **Decision (user):** show a badge on the Knots list and on the knot page, only when Drive is connected (not rows in Manage backups).
  - **Decision (Claude, plan approved):** pure `src/backupStatus.ts` (20-check chartest), rules in order: not connected → none; uploading now → none; in conflict → none (the conflict badge covers it); `backupDeletedAt ≥ updatedAt` → "Backup deleted"; base = `updatedAt` and no upload job → none; otherwise "Not backed up". `SyncStateRecord.backupDeletedAt` is set by `deleteBackup` and by `syncAll` step 7d2 (so other devices learn of the deletion) and cleared by the next `setBase`. New `backup:changed` event; `getBackupStatuses()`; in-memory `uploadingIds` so a just-tied knot doesn't flash the badge. The badge stays visible in Select mode.
  - **Copy (Claude-proposed, shown in the approved plan, not separately approved):** list "☁ Not backed up" / "☁ Backup deleted"; page "☁ Not backed up yet — it backs up automatically when you're online." / "☁ Backup deleted — this knot is only on this device. Edit it to back it up again."
- `sw.ts` ASSETS gains `addressBackfill.js`, `addressBackfillService.js`, `backupStatus.js`, `mediaSummary.js` (49 entries).
- **Spec reconciled:** requirements.md 1.3/1.5 amended, new 1.10, 1.11, 3.5 amended, 6.11, 11.14, 13.13, 13.14; design.md (GeoService, AddressBackfill, MediaSummary, BackupStatus, CloudSyncService, screens, Properties 17–19, precache and test lists); README.
- **Fixed (user request, 2026-10-09):** the Calendar month grid was 336 px wide at a 320 px viewport (each day cell's `min-height: 44px` with `aspect-ratio: 1 / 1` forced a 44 px minimum width, and `1fr` columns can't shrink below that). Now `repeat(7, minmax(0, 1fr))`, and `.calendar-day` gets `min-width: 0; width: 100%` (a grid item with `aspect-ratio` isn't stretched to its column, so without the width it stayed 44 px wide and overlapped its neighbours); cells keep the 44 px height and may be slightly taller than wide.

## Session status (as of 2026-10-09)
- **Implemented, reviewed and browser-checked; not committed.** The 2026-10-08 save-failure fix is also still uncommitted, so one commit covers both.
  - `tsc` (app + SW) exits 0; the SW classic-script parse check passes.
  - All 15 chartests and the timezone proptest pass; all 49 ASSETS paths exist.
- **Browser-checked at 320×640 (Claude):**
  - GPS (stubbed): offline → the offline copy and a 120 s timeout; a fix after 3 s shows the coordinates; online → 10 s; a retry while offline uses 120 s; failure → "Location unavailable — tap to retry".
  - Backfill: an offline knot with coordinates is queued; on `online` (Nominatim stubbed) the address is filled, `updatedAt` bumped, the pending list emptied, and the list shows the address.
  - Calendar (dark + light): 3 photos + video + audio → photo tile "3", video ▶, audio ▶, right-aligned; 2 audio → ▶ "2"; text-only → no strip.
  - Badges (Drive stubbed as connected): no state → "☁ Not backed up"; base = `updatedAt` → none; `backupDeletedAt` ≥ `updatedAt` → "☁ Backup deleted"; conflict → only the conflict badge; `backup:changed` updates in place; the page pill shows, hides in edit and returns after Cancel; disconnected → no badges. Knots list width stays 320.
  - Calendar month grid: page width 320 (was 336); day cells 39.4 × 44 px with no overlap, the last cell ends at the grid edge; dots and the count badge fit; at 768 px wide cells stay square (79.4 × 79.4).
- **Pending verification (user, on the phone, after deploy):**
  - Airplane mode with Location on: Capture shows the offline copy and gets coordinates within about 2 minutes; save; go online and reopen the app: the address appears.
  - Calendar: thumbnails look right with real photos and videos, and a day with many large photos scrolls smoothly.
  - With Drive connected: a knot tied offline shows "☁ Not backed up" until it uploads; deleting a backup in Manage backups shows "☁ Backup deleted" on that knot.
  - The 2026-10-08 checks (Google Photos pick; edit save) and the earlier real-Google-account checks still apply.
- **Open items:** the badge copy is Claude-proposed; plus the 2026-10-06 items (merge known limits; the unsupported-format copy; P2 KIV; P3 KIV; the sync race window; the `appProperties` per-key merge).

## Session status (as of 2026-10-08) — superseded by 2026-10-09 above
- **Implemented, reviewed and browser-checked; not committed.** The 2026-10-06 work is committed as `19ad87b`.
  - `tsc` (app + SW) exits 0; the SW classic-script parse check passes.
  - All 12 chartests and the timezone proptest pass.
- **Browser-checked at 320×640 (Claude):**
  - Capture: a picked file whose `arrayBuffer()` rejects shows the pick-time message and adds no item.
  - Capture: with IndexedDB `put` on `knots` throwing "Failed to write blobs (InvalidBlob)", Tie Knot shows the new media-write toast, stays on Capture with the photo and media buttons intact, and Tie Knot is enabled again. (`saveWithRetry` absorbs a single failure, so the stub failed every put.)
  - Edit: adding a photo then a failing save shows "Saving…" (disabled, a second tap ignored), then the "Could not save changes — …" toast; Save and Cancel are enabled again, Library is still there and the new photo is kept. A retry with storage working saves ("Knot updated") with both photos.
  - Document width stays 320.
- **Pending verification (user, on the phone, after deploy):**
  - Library › Photo or video with a Google Photos item that isn't on the phone yet: either it attaches and saves, or the pick-time message appears straight away; never the InvalidBlob toast.
  - Edit a knot, add a photo, save: works; if a save ever fails, the form stays usable.
  - The earlier real-Google-account checks still apply.
- **Open items:** unchanged from 2026-10-06 (merge known limits; the unsupported-format copy; P2 KIV; P3 KIV; the sync race window; the `appProperties` per-key merge).

## Session status (as of 2026-10-06) — superseded by 2026-10-08 above
- **Implemented, reviewed and browser-checked; not committed.** The 2026-10-05 work is committed (`304a492`, `e3110c7`).
  - `tsc` (app + SW) exits 0.
  - All 11 chartests and the timezone proptest pass; the SW classic-script parse check passes.
  - SW ASSETS has 44 entries, all present.
- **User phone results (2026-10-06) for the 2026-10-05 work:** generally fine. The service worker and notification work, and Mic quality is fine. The issues they reported are fixed in this round: desktop `*.m4a` ×4, the Android picker getting harder to use, and Dictate repeating on fast speech.
- **Browser-checked at 320×640 (Claude):**
  - The Library menu opens and closes (second tap, Escape, after a pick, Dictate); `aria-expanded` toggles; the menu's right edge is at 304 and the document width is 320.
  - Photo or video uses the image/video accept; Audio file uses `audio/*`.
  - A real WAV (`clip.wav`) and an `.mp3` with an empty type became audio items (wav duration 1 s); `rec.aac` was rejected with the new copy.
  - Saved; the knot page has 2 players. Transcribe (fetch stubbed) uploaded `audio.wav` and `audio.mp3`, with stored types `audio/wav` and `audio/mpeg`.
  - A fake SpeechRecognition (Android-style cumulative finals with a revision, 2 restarts) gave "I want to go to the shop and buy milk then call mom I need to call mom": the revision collapsed, the re-delivered "buy milk" wasn't duplicated, and the new sentence was kept.
- **Pending verification (user, on the phone, after deploy):**
  - Library › Photo or video opens the photo picker directly.
  - Library › Audio file finds the recorder app's files.
  - On desktop, the audio picker shows one filter entry.
  - Dictate fast, several sentences: no repeats and nothing dropped.
  - The earlier real-Google-account checks still apply.
- **Open items:**
  - The merge known limits (2+ word repeat across a pause collapses; equal-length near-identical sentence in one instance; short-tail revision appended). Revisit only if they show up in real use.
  - The new unsupported-format copy (Claude-invented) is not yet approved; the Photo/Video buttons show it too (user: keep for now).
  - P2 daily email digest: KIV. P3 supercharge scaffold: KIV.
  - The sync race window: accepted. `appProperties` per-key merge: unconfirmed.

## Session status (as of 2026-10-05) — superseded by 2026-10-06 above
- **Round 2 (service worker fix, see the round-2 section above):** implemented, reviewed and verified in headless Edge. Committed and pushed by the user as **`e3110c7`**. It changes `sw.ts` (no `export`, `SW_WAITING` only on an update, no query-string caching) and `.github/workflows/deploy.yml` (classic-script parse guard); design.md and README are updated.
- **Round 1:** implemented, reviewed and browser-checked. Committed and pushed by the user as **`304a492`**, together with the 2026-10-04 end-handoff log and the "🎲 Another random knot" label.
  - `tsc` (app + SW) exits 0.
  - All 10 chartests pass: dayCutoff, deviceLabel, knotDiff, knotSummary, locateFailure (12), mediaImport (23), mergeMessage, randomKnot, router, syncPlan. The timezone proptest passes.
  - SW ASSETS has 43 entries, all present.
- **Browser-checked at 320×640 (Claude):**
  - Location with stubbed geolocation and permissions: code 1 + denied, prompt, throw or hang, and code 2 → "Location unavailable — tap to retry"; code 1 + granted → "Location is off — turn it on, then tap to retry".
  - m4a: a real AAC clip generated in the page (MediaRecorder `audio/mp4;codecs=mp4a.40.2`) was picked through Library as `clip.m4a` with type `audio/mp4`, `audio/x-m4a` and empty. Each gave a playable preview (duration 1.98 s); the stored blob is `audio/mp4` with duration 2.
    - With transcription on: status pending, the import toast appears, and the knot page shows a playable `<audio>` with "Voice not yet transcribed" and "🎧 Transcribe voice".
    - Transcribe (fetch stubbed) uploads `audio.m4a` (`audio/mp4`) and saves the transcript.
    - With transcription off: status none, no toast.
    - `.mp3` and an m4a through the Photo button are rejected with the new copy. Document width stays 320.
  - Mic (getUserMedia stubbed): the processing-off constraints are passed and the recording is `audio/webm;codecs=opus`. OverconstrainedError → retries with `{audio:true}`; NotAllowedError → rethrown, with no retry.
  - Settings: the Cloud Backup order is Drive row → Merge with Cloud → description → Last merged → Manage backups → explanation → hint.
  - Notification line: a `showNotification` throw shows "(TypeError: …)", "not listed after showing" shows that reason, success hides the line, and switching off hides it. ~~In the in-app browser `serviceWorker.register` failed with "An unknown error occurred when fetching the script", even though `sw.js` returns 200. That is **unexplained**: the 2026-10-04 session had a working SW at the same origin. That path showed "(service worker not ready)" after 5 s. **Leading suspect for the phone:** no active service worker. Then `serviceWorker.ready` never resolves, the old `ensureShown` waited forever and posted nothing, and Android would say "hasn't received any notifications yet".~~ **Superseded 2026-10-05 (round 2):** the suspect is confirmed (the phone had no active service worker) and the cause is `export {};` in `sw.ts`; the in-app browser pane's registration failure is that pane's own limitation (see the round-2 section). Claude ruled out one cause: all 43 deployed precache URLs (from the deployed `sw.js` list) return 200 on GitHub Pages, so `cache.addAll` shouldn't fail on a missing file. The toggle stays inside the row (right edge 287 of 320).
- **Pending verification (user, on the phone, after deploy):**
  - Location off → "Location unavailable — tap to retry"; turn Location on, then tap retry → resolves.
  - A Mic recording: no hiccups, and a comfortable level (AGC is off).
  - An m4a from the recorder app via Library: it plays and transcribes.
  - Photo or video via Library is still convenient; if not, use the named in-app menu fallback.
  - ~~**Service worker and notification (do this first, after deploy):** open the app online once, fully close and reopen it; check that the Settings notification line is gone and "Tap to tie a knot" is in the notification drawer; tap it to open Capture; then switch on airplane mode → the app loads offline. If a Settings line still shows a reason, report it.~~ **Done (user, 2026-10-06):** the service worker and the notification work on the phone.
  - The earlier phone and real-Google-account checks still apply; the ones that involve the service worker were never testable before round 2.
- **Open items:**
  - ~~The missing notification: the fix (a working service worker) is implemented; pending the phone check after deploy.~~ **Resolved (user, 2026-10-06):** confirmed working on the phone.
  - ~~Claude-invented copy needing user review: the notification failure line, the m4a import toast, "This is your only unchecked knot" and "Could not load knots".~~ **Resolved (user approved, 2026-10-06):** all four are kept as they are.
  - The Photo/Video unsupported-format error lists M4A even though those buttons don't accept it (minor).
  - P2 daily email digest: deferred. P3 supercharge scaffold: KIV.
  - The sync race window: accepted. `appProperties` per-key merge: unconfirmed.
  - `src/screens/knotDetailScreen.ts` has an uncommitted change made by neither agent ("Another random knot" → "🎲 Another random knot"). Both agents confirmed they didn't touch the file. The change is unexplained and was left as is; the user was asked whether it's theirs.

## Session status (as of 2026-10-04) — superseded by 2026-10-05 above
- Implemented, reviewed and browser-checked. Committed by the user as **`5690324`**; the 2026-10-03 log repair and the 2026-10-03 session log were committed with it.
  - `tsc` (app + SW) exits 0.
  - All 9 chartests pass: dayCutoff, deviceLabel, knotDiff, knotSummary, locateFailure (12), mergeMessage, randomKnot (16), router (24), syncPlan. The timezone proptest passes.
  - SW ASSETS has 42 entries, none missing.
- **Browser-checked at 320×640:**
  - Settings toggles stay inside their rows in light and dark, with `Notification.permission` stubbed to granted.
  - Capture location copy: granted → off; denied → blocked; prompt, throw or hang → combined; code 2 → unavailable. A retry after "off" then success resolves the location.
  - The Knots header fits: Random at x 163–246, Select at 254–304.
  - The checked-off toggle is the first child of the list, and Show/Hide works.
  - Random → `#/random/test-2` with the Knots tab current. On the knot page, "Another random knot" + Share fit on row 1 and Edit + Delete wrap to row 2, with no horizontal scroll.
  - Both empty-state toasts appear.
  - Random is hidden in select mode.
  - The combobox highlight is `rgba(76,175,118,0.18)` in dark mode.
- **Pending verification (user, on a phone):**
  - ~~Location off → "Location is off" copy; turn Location on → tap retry works.~~ **Superseded 2026-10-05:** Location off now shows "Location unavailable — tap to retry" (see the 2026-10-05 status).
  - The Settings toggle sits inside its row.
  - Random knot and Another.
  - The checked-off toggle at the top.
  - The 2026-10-03 phone and real-Google-account checks still apply.
- **Open items:**
  - The Claude-invented copy "This is your only unchecked knot" / "Could not load knots" needs user review.
  - P2 daily email digest: deferred (user).
  - P3 supercharge scaffold: KIV (user); the design is in plan Step 5.
  - The remaining sync race window: accepted.
  - The `appProperties` per-key merge is unconfirmed on a device.

## Session status (as of 2026-10-03) — superseded by 2026-10-04 above
- All 2026-10-03 items (both rounds) are implemented and reviewed, and the user committed them as **`4c70b9a`**. The only uncommitted change is the end-of-session repair of this file's log ordering, plus the final session log.
  - `tsc` (app + SW) exits 0.
  - All 7 chartests pass (syncPlan has 7 new `remoteChangedSinceBase` cases), plus the timezone proptest.
  - Every SW ASSETS path exists (40 entries).
- **Browser-checked locally at 320×640:**
  - Detail header: Back on row 1; Share/Edit/Delete fit on row 2 (x 84–304); document width 320, so no horizontal scroll.
  - The tick toggles ✓→↩ with the "Checked off · Undo" toast; Undo restores ✓.
  - The tick is absent in edit mode, and Save/Cancel fit.
  - "+" is white on `#/` and `#/knot/…`.
  - `/?error=access_denied#/knots` shows the toast, and the URL is cleaned to `/#/knots`.
  - The conflict screen wasn't stubbed this time. Its header reuses `.knot-detail-header`, and `.conflict-actions` is already a column.
- **Round 2:** also implemented and browser-checked at 320×640 in dark mode: the toast tap, the 5 s notice, the pill, the nav state, the "+" ring and location retry. `tsc` and all tests pass (router chartest has 8 new cases).
- **Committed** as `4c70b9a` by the user.
- **Pending verification (user, on a phone):** the "+" ring on Capture; the checked-off pill; location retry after switching Location off and then on; tapping a toast to dismiss it.
- **Pending verification (user, real Google account, two or more devices):** the 2026-09-29 list below still applies, and two checks are new:
  - Cancelling the Google consent screen on the deployed site shows "Google Drive connection cancelled" and returns to a clean URL.
  - On a phone, the detail page's two rows and the tick look right.
- **Open items:**
  - Daily email digest: the decision is pending (options are in design.md).
  - The remaining race window between list and write: accepted.
  - The `appProperties` per-key merge is still unconfirmed on a device.
  - P3 (optional `docs/` tree + graphify graph) was not requested.

## Session status (as of 2026-09-29) — superseded by 2026-10-03 above
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
- ~~**User cancels consent (`?error=access_denied`):** not handled specially. The param stays in the URL and nothing else happens. Open item.~~ **Resolved 2026-10-03:** see the 2026-10-03 edge cases.
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
- **Upsert race:** two devices saving the same knot within a few seconds can both pass the guard. One edit is then pulled over without review. Documented in design.md Known Limitations. ~~Closing it needs Drive ETag writes, which are out of scope.~~ **Corrected 2026-10-03:** Drive v3 has no ETag/If-Match, so it can't be closed. Merge now re-checks before each push too, which narrows the window to the gap between list and write.
- **Cloud changes again during a review:** `resolveConflict` returns `changed-again`, and the screen reloads the newer version. Manual test only.
- **"Keep both" fails partway:** the cloud copy is saved locally first. If the upload of the copy fails, it stays as a local-only knot and is pushed on the next sync. Manual test only.
- **Review while offline:** "Connect to the internet to review this knot".
- **Three or more devices:** reviews are pairwise against the latest cloud version, one device at a time.
- **Multi-share media:** filenames `knot1-photo-1.jpg`, `knot2-…` never collide. The 50 MB cap applies to the combined size. There's exactly one `navigator.share` call. Covered by `knotSummary.chartest.ts` (naming); share itself was smoke-tested with a stub.
- **Attribution off:** no footer, and the multi-share header is "N knots" without the app name. Covered by `knotSummary.chartest.ts`.
- **Notification permission states:** granted = toggle; not asked = "Allow notifications" button; denied = "Blocked in browser settings"; unsupported = section hidden. Manual test only.
- **Notification swiped away on Android:** it returns at the next app launch. It can't be made unswipeable on the web.

### Edge cases added 2026-10-03 (mobile layout / OAuth cancel / race re-check / transcription cap)
- **Detail page at 320px:**
  - Back sits on its own row, and Share/Edit/Delete wrap if they still don't fit (e.g. with larger system fonts).
  - In edit mode the tick is hidden and Save/Cancel wrap.
  - Browser-checked at 320×640.
- **Tick on a checked-off knot:** it shows ↩ ("Uncheck knot"). Undo re-renders it through `knot:checkedOff`. Browser-checked.
- **User cancels Google consent (`?error=access_denied`):**
  - The toast "Google Drive connection cancelled" appears.
  - The URL query is stripped and the hash kept.
  - `pkce_verifier` is cleared and the status is unchanged; an existing connection stays connected.
  - Browser-checked locally. *Supersedes the 2026-09-22 edge case "not handled specially".*
- **Any other OAuth `?error=`:** the error is logged and the toast "Could not connect to Google Drive" appears. Status is unchanged.
- **Cloud copy changed between Merge's listing and its push:**
  - Step 6 re-lists and re-runs `remoteChangedSinceBase`.
  - A change records a conflict instead of overwriting; it is counted as "need review" and its queued upload job is cleared.
  - Covered by `syncPlan.chartest.ts` (the guard's semantics); the re-list itself is a manual or real-device check.
- **Guard: remote older than base:** not a conflict, so the push goes ahead (unchanged behaviour). Covered by `syncPlan.chartest.ts`.
- **Speech engine never fires `onend` after stop:**
  - After 3 s, `abort()` runs and the transcript resolves with the text collected so far. If that's empty, the recording takes the existing deferred-transcription path.
  - A late `aborted` error is ignored.
  - Manual test only (it needs a hung engine).
- **Compiled test files:** they are deleted from `_site` at deploy and kept locally for `node` runs.
- **Location retry tapped repeatedly, or a slow first fix arriving after a retry:** taps while loading are ignored, and a request counter means only the newest request can set `location`, render, or apply its reverse-geocoded address. Browser-checked with a stubbed `navigator.geolocation` (code 1 → blocked copy, code 2 → unavailable copy, then success → coordinates).
- **Location result arrives after leaving Capture:** a `disposed` flag set in cleanup means nothing renders.
- **Knot saved before any location fix:** it saves with `location: null`, same as before.
- **Location blocked for the site:** a retry fails immediately until the user allows it in browser settings, which the copy says. The browser won't prompt again, so a retry can't re-prompt. *(Refined 2026-10-04: this copy is now shown only when the Permissions API confirms the site is `denied`; see below.)* **Superseded 2026-10-05:** there is no "blocked" copy any more. A blocked site shows "Location unavailable — tap to retry", and a retry still fails immediately until the user allows it.
- **Tapping a plain toast:** it dismisses immediately and its timer is cleared, so nothing is removed twice. The Undo toast's button keeps its own behaviour. Browser-checked.
- **"+" ring in dark mode:** primary-dark #2d7a4f with a #1e1e1e gap and a #4caf76 ring. Browser-checked (computed styles).
- **Checked-off pill:** it appears on check-off and disappears on Undo, re-rendered by `knot:checkedOff`. The time shows in the user's zone. Browser-checked (SGT).

### Edge cases added 2026-10-04 (toggle overflow / location off vs blocked / Random knot / toggle at top)
- **Location off on the phone, site still allowed (code 1 + `granted`):** Capture shows "Location is off — turn it on, then tap to retry". Covered by `locateFailure.chartest.ts`.
- ~~**Site blocked (code 1 + `denied`):** Capture shows "Location blocked for this site — allow it in browser settings, then tap to retry". Covered by `locateFailure.chartest.ts`.~~ **Superseded 2026-10-05:** code 1 + `denied` now gives the generic "Location unavailable — tap to retry" (see the 2026-10-05 edge cases).
- ~~**Permission state `prompt` or unreadable (code 1 + `prompt`/null):** the combined "Location is off or blocked — turn it on or allow it for this site, then tap to retry". Covered by `locateFailure.chartest.ts`.~~ **Superseded 2026-10-05:** these now give "Location unavailable — tap to retry".
- **Other errors (codes 2/3, or no code) whatever the permission state:** "Location unavailable — tap to retry". Covered by `locateFailure.chartest.ts`.
- ~~**Permissions API hangs, throws or is missing:** the lookup is capped at 1 s and gives null, so the result is `unknown` (the combined copy) rather than a stuck "Getting location…". Browser-checked with a stubbed `permissions.query` (hang and throw → combined copy).~~ **Superseded 2026-10-05:** the 1 s cap still applies (so there is no stuck "Getting location…"), but the null result now gives "Location unavailable — tap to retry".
- **Error arrives, then the 10 s guard would fire:** the guard is cleared on the error and `finish()` ignores late callers (`settled` flag), so `locate()` resolves exactly once. Manual test only.
- **All knots are checked off, then 🎲 Random:** toast "No unchecked knots yet", no navigation. Browser-checked.
- **One unchecked knot, on its `#/random/` page, tap "Another random knot":** toast "This is your only unchecked knot", stays put. Browser-checked.
- **"Another random knot" never repeats the current knot:** `pickRandomKnot` excludes the shown id, whatever `rand` returns. Covered by `randomKnot.chartest.ts`.
- **`checkedOffAt: 0`:** still counts as checked off (the test is `typeof === 'number'`), so it's never picked. Covered by `randomKnot.chartest.ts`.
- **`rand()` returns exactly 1:** the index is clamped to the last candidate. Covered by `randomKnot.chartest.ts`.
- **Random with checked-off knots hidden or shown in the list:** it reads the whole store, so the "Show N checked-off knots" state doesn't matter. Manual test only.
- **`#/random/` or `#/random` with no id:** an ordinary unknown route, so it falls back to Capture. Covered by `router.chartest.ts`; `#/random/abc` highlights Knots (also covered).
- **Navigating `#/random/a` → `#/random/b`:** `hashchange` runs the old screen's cleanup and renders the new knot; nothing stale is left. Browser-checked (8 consecutive "Another" taps across 3 knots, 0 repeats).
- **Another random knot while editing:** the button is gone in edit mode (`renderEditMode` empties the actions row) and comes back after Save/Cancel. Browser-checked.
- **Settings toggle row, notification permission granted:** the toggle's 44×26 switch stays inside the row (no spill to the right). Browser-checked at 320×640. Light and dark; all four toggle rows (Transcription, Email, Sharing, Notifications) with `Notification.permission` stubbed to granted; document width 320.
- **Checked-off toggle when every knot is hidden:** the "Show N checked-off knots" button sits at the top, above "All your knots are checked off.". Browser-checked.

### Edge cases added 2026-10-05
- **Code 1 with `denied`, `prompt` or `null`, or a hung or missing Permissions API:** the generic "Location unavailable — tap to retry". Covered by `locateFailure.chartest.ts`. Code 1 + `granted` gives "Location is off"; other codes give "unavailable".
- **`.m4a` file with an empty, `application/octet-stream`, `video/mp4` or `audio/mp4a-latm` type:** classified as audio, stored as `audio/mp4`. Covered by `mediaImport.chartest.ts` (23 cases).
- **`audio/mpeg` (`.mp3`):** rejected with "Unsupported file format. Please use JPEG, PNG, GIF, WEBP, MP4, MOV, or M4A." Covered by `mediaImport.chartest.ts`.
- **An `.m4a` picked through the Photo or Video button:** rejected (those pickers allow photo and video only). Manual test only.
- **Duration unreadable** (metadata fails or takes more than 3 s): the item is added with duration `0`. Manual test only.
- **m4a over the Groq file limit (25 MB on the free tier):** the existing transcription error toast appears; there is no client-side check. Manual test only.
- **An imported item removed from the draft before saving:** not counted for the post-save toast. Manual test only.
- **`serviceWorker.ready` hangs:** `ensureShown` returns `failed` after 5 s with "service worker not ready", and Settings shows the failure line. Manual test only.
- **`showNotification` throws:** `failed` with `name: message`, logged with `console.error`. Manual test only.
- **Notification not listed after showing** (`getNotifications` returns nothing): `failed` with "not listed after showing". Manual test only.
- **`getNotifications` itself throws:** treated as `shown` (best effort), with a `console.warn`. Manual test only.
- **Settings closed before `ensureShown` resolves:** the result is ignored (`notifDisposed`). Manual test only.
- **First install of the service worker:** no "New version available" toast, because there is no active worker yet. Verified in headless Edge.
- **A later deploy:** the toast shows once (`SW_WAITING` is posted because an active worker exists). Manual test only.
- **OAuth return `/?code=…` or `?error=…`:** never written to Cache Storage (`networkFirst` skips URLs with a query string). Verified in headless Edge with `index.html?code=secret123` (0 query-string cache entries).
- **A precache file missing on deploy:** `cache.addAll` fails, so the install fails and Settings shows "(service worker not ready)". Manual test only; all 43 URLs return 200 on GitHub Pages.
- **`sw.js` with module syntax** (for example a stray `export {}`): the deploy fails at the `new Function` parse guard. Verified on the old `sw.js` (`SyntaxError: Unexpected token 'export'`).

### Edge cases added 2026-10-06
- **Desktop audio picker:** a single `audio/*` filter entry (the old list of audio MIME types and `.m4a` showed `*.m4a` four times). Manual test only.
- **Android photo picker:** Library › Photo or video passes only image/video types, so Android opens its photo picker directly. Manual test only.
- **Audio file outcomes:** `.mp3` (even with an empty type) → audio stored as `audio/mpeg`; `.wav` → `audio/wav`; `.ogg`/`.opus` → `audio/ogg`; `.flac` → `audio/flac`; `.aac`, `.wma`, `.amr` and `audio/aac` → rejected with the new copy. Covered by `mediaImport.chartest.ts` (65 cases); browser-checked with a real WAV, an `.mp3` and a `.aac`.
- **Large WAV or FLAC over the Groq limit (25 MB on the free tier):** the audio is saved and playable; "Transcribe voice" shows the existing transcription error toast. There is no client-side size check. Manual test only.
- **Upload filename:** `audio.<ext>` comes from `extensionForMimeType` (`audio/wav` → `audio.wav`, `audio/mpeg` → `audio.mp3`, unknown → `audio.webm`). Covered by `knotSummary.chartest.ts` for the table; browser-checked with a stubbed fetch.
- **Library menu closing:** it closes on a second Library tap, Escape, after a pick, and when Mic, Dictate, Photo or Video is tapped; `aria-expanded` follows it. Browser-checked.
- **An audio file picked through the Photo or Video button:** still rejected (those pickers allow photo and video only). Manual test only.
- **Dictate: fast speech with a revised word** (`"I wanna go"` → `"I want to go to the shop"`): the revision replaces the tail instead of repeating. Covered by `transcriptMerge.chartest.ts`.
- **Dictate: a restart re-delivers the previous tail:** nothing is added (`foldSegment`). Covered by `transcriptMerge.chartest.ts`.
- **Dictate: two sentences that start alike across a pause** ("I need to buy milk" / "I need to call mom"): both kept. This was the review-fix regression. Covered by `transcriptMerge.chartest.ts`.
- **Cross-restart text is never revised:** `foldSegment` only ignores, merges an exact 2+ word overlap, or appends. Covered by `transcriptMerge.chartest.ts`.
- **Known merge limit 1:** a deliberate repeat of 2+ words across a boundary ("thank you thank you") collapses. Pinned in `transcriptMerge.chartest.ts`.
- **Known merge limit 2:** an equal-length near-identical sentence within one instance ("I went to the store" / "I went to the park") counts as a revision. Pinned in `transcriptMerge.chartest.ts`.
- **Known merge limit 3:** a short-tail revision ("…bought apples" → "bought oranges and pears") is appended rather than revised. Pinned in `transcriptMerge.chartest.ts`.
- **A 1-word repeat across a boundary** ("I said no" / "no thanks"): kept. Covered by `transcriptMerge.chartest.ts`.

### Edge cases added 2026-10-08
- **Picked file can't be read** (cloud-backed and still downloading, or the provider fails): the pick-time message; no draft item. Browser-checked with a stubbed `arrayBuffer()` rejection.
- **IndexedDB write fails with a blob error after picking:** the media-write toast, on Capture and Edit; the form stays. Covered by `saveError.chartest.ts` (messages); browser-checked with a stubbed `put`.
- **Any other save error** (e.g. quota): "<prefix>: <detail>" as before. Covered by `saveError.chartest.ts`.
- **Single transient save failure:** `knotStore.save` retries once (`saveWithRetry`), so the user sees nothing.
- **Double tap on Save Changes:** ignored while saving. Browser-checked.
- **Edit save fails, then retry succeeds:** the newly added media is kept and saved. Browser-checked.
- **Large picked file (up to 100 MB):** read fully into memory at pick time; files over the cap are rejected before reading. Manual test only.

### Edge cases added 2026-10-09
- **Saved before the GPS fix arrives:** the knot has no location (unchanged). Manual test only.
- **Offline fix, then online before saving:** the screen's own address lookup failed offline, so the knot is queued and filled at the next start or `online` event. Browser-checked (offline path).
- **Backfill lookup fails** (Nominatim down or rate-limited): the id stays pending and is retried next time. Manual test only.
- **Knot given a manual label, deleted, or already has an address before the backfill runs:** dropped from the list with no lookup. Covered by `addressBackfill.chartest.ts` (`needsAddress`).
- **More than 10 pending:** the rest wait for the next run. Manual test only.
- **Backfill while the knot is open in Edit:** the edit's stale empty label can clear the new address on save. Rare; accepted.
- **Knot tied on device A, pulled to B:** only A fills in the address (B never has the id pending). Design only.
- **Calendar image fails to load:** the tile becomes 📷 / 🎬. Browser-checked (fake blobs).
- **Old stretched thumbnails:** not regenerated; the Calendar uses the full photo, and video tiles use the old thumbnail. Accepted.
- **Just-tied knot uploading:** no badge while `uploadingIds` holds it. Covered by `backupStatus.chartest.ts`.
- **Upload failed / saved offline:** "Not backed up" until a retry or merge succeeds (`hasJob` or base ≠ `updatedAt`). Covered by `backupStatus.chartest.ts`.
- **Backup deleted, then the knot is edited:** "Not backed up" (the edit lifts the tombstone), then none after the upload. Covered by `backupStatus.chartest.ts`.
- **Backup deleted on another device:** this device marks it at its next merge (step 7d2). Manual test only.
- **Knot in conflict review:** only the conflict badge. Covered by `backupStatus.chartest.ts`; browser-checked.
- **Older knots with no sync base:** "Not backed up" until the first merge records the base. Covered by `backupStatus.chartest.ts`.
- **Drive not connected:** no badges. Covered by `backupStatus.chartest.ts`; browser-checked.
- **Calendar at 320 px:** the month grid fits (no sideways scroll); day cells are about 39 px wide and 44 px tall. Browser-checked.
- **Checked-off knot in the Calendar day list:** the row is faded and its text struck through, but not its time (the time is an inline-block). Browser-checked.

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