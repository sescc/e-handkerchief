# 2026-10-05 — location-m4a-mic-notif

## 0. Continuation brief
**Current state:** all of this session's items are implemented, reviewed and browser-checked, but **not committed**. `main` is still at `5690324`. The items are:
- the location message fallback;
- the Manage-backups explanation moved under its button;
- m4a import through Library (playable and transcribable);
- Mic recording without call-style processing;
- the quick-capture notification no longer failing silently.

The working tree also still holds the uncommitted 2026-10-04 end-handoff edit to `CLAUDE.md` and `docs/sessions/2026-10-04-end-handoff.md`.

The decision and edge-case log is in `CLAUDE.md` › "2026-10-05". The status is in "Session status (as of 2026-10-05)". The plan is `~/.claude/plans/p0-location-message-wise-kahn.md`.

**Next step:** the user commits, pushes (deploy) and runs the phone checks in §6. **Round 2 (§11) found the real cause of the missing notification: `sw.ts` had `export {};`, so no service worker had ever run; it is fixed in `sw.ts` and guarded in CI.** The first phone check is now: open the app online once, fully close and reopen, and confirm the Settings notification line is gone and "Tap to tie a knot" is in the drawer.

**Resume command/check:** `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status --short && git log --oneline -3'`, then `CLAUDE.md` › "Session status (as of 2026-10-05)".

## 1. Work completed
- **Location:** `classifyLocateFailure` returns `off` only for code 1 + `granted`. Everything else returns `unavailable`, because Android folds a blocked site, device Location off, and Chrome lacking Android permission into `denied`. Claude confirmed the deployed `src/locateFailure.js` was the `5690324` code, so the phone report reflects the classifier, not stale code.
- **Settings › Cloud Backup:** the delete explanation now sits directly under "Manage backups", with the Manage backups paragraph first.
- **m4a:**
  - The new pure `src/mediaImport.ts` `classifyImport`: an `.m4a` name always means audio, stored as `audio/mp4`. It has 23 chartest cases.
  - Library accepts m4a. The import becomes an `AudioMediaItem` (duration read from metadata), transcribed via the existing panel; the upload is named `audio.m4a`.
  - The Photo and Video pickers reject audio.
  - The post-save toast has import-specific copy.
- **Mic:** `getUserMedia` with echoCancellation, noiseSuppression and autoGainControl off, mono. A non-permission error retries with `{audio:true}`. The recorder is opus/webm at 128 kbps (else mp4). Live recognition is unchanged (user decision).
- **Notification:** `ensureShown` returns shown/skipped/failed with a reason. The SW `ready` wait has a 5 s cap, and a `getNotifications` check confirms the post. Settings shows "Couldn't show the notification (<reason>)…". Opening Settings re-posts the notification once.
- **Not a bug:** "Tap to copy the URL for this app" is Chrome's own notification for an installed web app. Claude's earlier WebAPK/"Install app" advice was wrong and has been withdrawn.

## 2. Decisions
| Decision | Verdict | Why |
| --- | --- | --- |
| Ambiguous location failure → "Location unavailable — tap to retry" | kept (user) | Not misleading; the user preferred the generic copy over the combined hint. |
| Combined "off or blocked" hint | discarded (user) | Not chosen. |
| Mic: drop live recognition during recording (auto or manual server transcription) | discarded (user) | The user chose to keep live recognition and fix only processing. Revisit if hiccups remain. |
| m4a in the existing Library button | kept (user) | The user expects the Android chooser to branch. |
| Separate "🎵 Audio" button | discarded (user) | Not chosen. |
| In-app "Photo or video / Audio file" menu | named fallback (Claude, plan approved), not built | Only if photo picking got clunky on the phone. |
| `.m4a` name wins over the reported MIME type | kept (Claude, after advisor review) | Android providers report m4a inconsistently. |
| Photo and Video pickers limited to photo or video | kept (Claude, review fix) | Stops an m4a from becoming a broken photo item. |
| Reinstall as a WebAPK to remove Chrome's notification | withdrawn (Claude) | Wrong: the app was already installed via Chrome › Install. |
| Surface the notification failure reason in Settings | kept (Claude, plan approved) | `ensureShown` used to swallow errors, so the cause was invisible. |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
| --- | --- | --- |
| `npx tsc -p tsconfig.json` / `npx tsc -p tsconfig.sw.json` | exit 0 / exit 0 | Types are OK. |
| `node src/{dayCutoff,deviceLabel,knotDiff,knotSummary,locateFailure,mediaImport,mergeMessage,randomKnot,router,syncPlan}.chartest.js` | all 10 pass | The new classifier and the narrowed location reasons, with no regressions. |
| `node src/components/timezoneCombobox.proptest.js` | pass | No regression. |
| Browser 320×640: location stubs | pass | denied, prompt, throw, hang and code 2 → unavailable; granted → off. |
| Browser: real AAC clip via Library (`audio/mp4`, `audio/x-m4a`, empty type) | pass | Preview plays; stored as `audio/mp4`, duration 2. The knot page plays it and shows Transcribe; Transcribe uploads `audio.m4a`; `.mp3` rejected; Photo + m4a rejected. |
| Browser: Mic constraints (stubbed getUserMedia) | pass | Processing-off constraints; Overconstrained → `{audio:true}`; NotAllowed rethrown. |
| Browser: Settings order and notification line | pass | Throw, not-listed and SW-not-ready reasons shown; success and off hide the line; no overflow. |
| In-app browser `serviceWorker.register` | failed: "unknown error when fetching the script", although `sw.js` returns 200 | ~~Unexplained (it worked on 2026-10-04). It points to the leading phone suspect: no active SW, so `ready` never resolves.~~ Superseded by §11: the suspect is confirmed (`export {};` in `sw.ts`); the pane failure is that pane's own limitation. |
| HEAD all 43 deployed precache URLs (deployed `sw.js` list + `sw.js`) | all 200 | A missing precache file is not why install would fail. |
| `drift-check.ps1 .` | `0 dead / 0 refs` | No dead doc references. |
| Real phone | not run | See §6. |

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
| --- | --- | --- | --- | --- |
| branch | `main` @ `5690324` | dirty (see §10) | `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status --short'` | the user commits |
| process | scratchpad `serve.js` on 127.0.0.1:8765 | stopped | none | none |
| data | browser-pane IndexedDB `e-handkerchief-db` @127.0.0.1:8765 | deleted | none | none |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
| --- | --- | --- | --- |
| none | — | no `openspec/` (P3 KIV) | — |

## 6. Open items
| Priority | Item | Doc/code reference | Next action | Done when |
| --- | --- | --- | --- | --- |
| P0 | Quick-capture notification (root cause fixed in round 2: SW never registered) | `sw.ts`, `.github/workflows/deploy.yml` | After deploy: open the app online once, fully close and reopen it; the Settings line is gone, "Tap to tie a knot" is in the drawer, and tapping it opens Capture; airplane mode → the app loads offline. | All four hold on the phone. |
| P0 | Phone checks | `CLAUDE.md` › Session status (as of 2026-10-05) | Location off → unavailable, then retry; Mic quality and level; m4a via Library plays and transcribes; photo picking still convenient. | All behave as browser-checked. |
| P1 | Claude-invented copy | the notification failure line, the m4a import toast, "This is your only unchecked knot", "Could not load knots" | The user reviews the wording. | Approved. |
| P2 | The Photo/Video unsupported-format error mentions M4A | `src/components/mediaCapture.ts` `handleMediaError` | Optional per-button copy. | Decided. |
| P2 | Daily email digest | design.md | Deferred (user). | — |
| P3 | Supercharge scaffold | plan `decisions-proceed-with-p2-recursive-dawn.md` Step 5 | KIV (user). | — |

## 7. Architecture / model changes
- **New pure transform:** `classifyImport(type, name)` (`src/mediaImport.ts`).
- **Narrowed:** `LocateFailureReason` is now `'off' | 'unavailable'`.
- **Widened:** `validateMedia` returns `ImportClassification`; `pickFile` takes `allowedKinds`; `ensureShown` returns `ShowResult`; `enable` returns `EnableResult`; `CapturedMedia.importedAudioIds` (not persisted).
- No persisted schema change and no IDB version change. Audio items may now carry `audio/mp4` blobs.

## 8. Docs reconciled
| Doc | Change |
| --- | --- |
| `requirements.md` | Req 1.4/1.5, new 2.8, 3.4/3.7, new 9.8, 11.11. |
| `design.md` | GeoService/LocateFailure, MediaService, new MediaImport section and Property 14, NotificationService, Settings layout, precache (43), test list (10). |
| `README.md` | Location copy, m4a section, Mic note, Settings explanation position, notification line, Chrome-notification note, tests and tree. |
| `CLAUDE.md` | 2026-10-05 decisions, edge cases and session status; stale location lines struck through. |

## 9. Drift check
`drift-check.ps1 .` → `0 dead / 0 refs`. There is no graph and no OpenSpec (P3 KIV). gbrain is installed (0.60.45), but `gbrain capture` wasn't run this session, so this log is not indexed yet.

## 10. Files changed
- **Modified:** `.kiro/specs/e-handkerchief/{design,requirements}.md`, `README.md`, `CLAUDE.md`, `sw.ts`, `src/{geoService,locateFailure,locateFailure.chartest,mediaService,notificationService,remoteTranscribe}.ts`, `src/components/mediaCapture.ts`, `src/screens/{captureScreen,settingsScreen}.ts`.
- **New:** `src/mediaImport.ts`, `src/mediaImport.chartest.ts`, this log.
- **Not from this session's agents** (both confirmed): `src/screens/knotDetailScreen.ts` ("🎲 Another random knot"). It's unexplained, left as is, and the user was asked. Also the uncommitted `docs/sessions/2026-10-04-end-handoff.md`.

## 11. Round 2 — service worker fix
- **Root cause (verified):** `sw.ts` had `export {};` since the initial commit `edf2e59`, so `sw.js` ended with `export {};`. `app.ts` registers it as a classic script, so evaluation threw a SyntaxError and **no service worker has ever run** (no notification, offline precache, update toast, notification tap, or Background Sync message). `serviceWorker.ready` never resolved, hence "Couldn't show the notification (service worker not ready)" on the phone.
- **Changes:** `sw.ts` drops `export {};` (comment: must stay a classic script); `SW_WAITING` is posted only when `sw.registration.active` exists (update, not first install); `networkFirst` skips `cache.put` for URLs with a query string (keeps the OAuth `?code=` out of Cache Storage); `.github/workflows/deploy.yml` parses `sw.js` with `new Function` after injection and fails on error. design.md (Service Worker section) and README (dev note) are updated; `CLAUDE.md` has the round-2 decision section, edge cases and status.
- **Verification:** `tsc` app + SW exit 0; the rebuilt `sw.js` parses and has no `export` (the old one gave `SyntaxError: Unexpected token 'export'`). Headless Edge over CDP, fresh profile, local server: registered, `ready` true, controller true, cache `e-hk-__BUILD_VERSION__` with 43 precached entries, `index.html?code=secret123` fetched through the SW left 0 query-string entries, no `SW_WAITING` on first install. The in-app browser pane cannot register any SW (environment limit), so use headless Edge for SW checks (script in the session scratchpad, not in the repo).
- **Updated P0 next action:** after deploy, on the phone: open the app online once, fully close and reopen; the Settings notification line should be gone and "Tap to tie a knot" in the drawer; tap it to open Capture; then airplane mode → the app loads offline. If a reason still shows in Settings, report it. All earlier SW-dependent pending checks were never testable before this fix.
