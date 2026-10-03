# 2026-09-29 — checkoff-conflicts-share

## 0. Continuation brief
**Current state:** every feature from the approved plan (`~/.claude/plans/issue-even-though-the-sorted-moth.md`) is implemented and committed by the user as `fc1dc7c` on `main`, and the working tree is clean. That covers:
- the Merge toast fix;
- knot check-off with a "New day starts at" cutoff, synced separately from content;
- edit-conflict review, which replaces newest-wins (IDB v5 `syncState`);
- share attribution and multi-knot share;
- the quick-capture notification, now scope-correct and re-posted.

`tsc` (app and SW) and every chartest plus the timezone proptest pass. The feature was smoke-tested in a local browser. What remains is verification with a real Google account on the deployed site, across two or more devices.

This repo has no `docs/` architecture tree, no OpenSpec and no graphify graph. The spec of record is the Kiro spec (`.kiro/specs/e-handkerchief/`). The decision and edge-case log is the project `CLAUDE.md`, in the "2026-09-28/29" section.

**Next step:** on the deployed site, check off a knot on device A, edit its text on device B, then Merge on both. Confirm both changes survive. This confirms that Drive merges `appProperties` per key, which is inferred from the docs and not yet verified.

**Resume command/check:** open `CLAUDE.md` › "Session status (as of 2026-09-29)" › "Pending verification".

## 1. Work completed
- **Merge toast.**
  - `uploadPending()` now returns its upload count, which is added to `pushed`.
  - The pure `src/mergeMessage.ts` builds the message: "Already up to date — nothing to merge" or "Merged — N knot(s) brought in, N backed up, N need(s) review".
  - Under Merge with Cloud, Settings now adds the sentence "If a knot was edited on two devices, you'll be asked which version to keep."
- **Check-off.**
  - New fields `Knot.checkedOffAt` and `checkOffChangedAt`, which never bump `updatedAt`.
  - `src/checkOffActions.ts` provides `setCheckedOff`, `toggleCheckOff` (with the Undo toast) and `withLatestCheckOff`.
  - The pure `src/dayCutoff.ts` provides `nextCutoffAfter`, `isCheckedOffVisible` and `resolveTimeZone`, and handles DST.
  - Knots list: a ✓/↩ button, the faded `.knot-entry--checked-off` style, and a "Show N checked-off knots" toggle. The list re-renders on a timer and on `visibilitychange`.
  - The detail page has "Check off" / "Uncheck". Calendar shows checked-off knots faded.
  - Sync goes through a metadata-only Drive PATCH (`pushCheckOff`) and `planSync`'s `checkOffPush` / `checkOffPull`.
  - Manage backups shows a "Checked off" badge.
  - Settings has "New day starts at" (default 03:00).
- **Edit conflicts.**
  - IDB v5 adds the `syncState` store (`baseUpdatedAt` plus an optional `conflict`).
  - `planSync` is base-aware.
  - `upsertKnot` has a guard that throws `ConflictError`.
  - `cloudSyncService` gains `listConflicts`, `fetchRemoteKnot` and `resolveConflict` (with 'local' / 'remote' / 'both' and a changed-again check).
  - Every content write sets the `editedOn` appProperty, from the pure `src/deviceLabel.ts`.
  - The pure `src/knotDiff.ts` computes the diff.
  - The new `src/screens/conflictScreen.ts` serves route `#/conflict/{id}` ("Review changes").
  - Conflicts surface as one persistent toast, a list badge and a detail-page banner.
- **Share.**
  - `knotSummaryText`/`knotsSummaryText` take attribution options. The footer is "— Shared from e-Handkerchief" plus the app URL.
  - `mediaFileName` takes a prefix.
  - `shareKnots(knots)` still makes exactly one `navigator.share` call.
  - The Knots list has a Select mode with "Share (N)", and Settings has a Sharing toggle.
- **Notification.**
  - `notificationService` is now `permission` / `ensureShown` / `enable` / `disable`; `requestAndRegister` is removed.
  - `ensureShown` runs on every launch.
  - The Settings Notifications control reflects the permission state.
  - In `sw.ts`, `notificationclick` opens `new URL('./#/', registration.scope)` and re-posts the notification.
  - `sw.ts` ASSETS gained the new modules.
- **Docs.**
  - Kiro `requirements.md`: new Req 14–18, plus amendments to 6, 8, 9, 11, 12 and 13.
  - `design.md`: data model, sync rules, the new modules, Known Limitations, and the Service Worker Scope wording fix.
  - `README.md` updated.
  - `CLAUDE.md` gained the decision log, edge cases and session status.

## 2. Decisions
| Decision | Verdict | Why |
| --- | --- | --- |
| Tick bumps `updatedAt` (check-off = edit) | discarded (user) | It would lift cloud tombstones and let a tick overwrite a text edit. |
| Separate check-off field with its own LWW clock, synced via appProperties | kept (user) | No content conflict, no re-upload, no tombstone lift, and Manage backups can show the state. |
| Last-write-wins for content | discarded (user) | It silently loses edits; the user did not accept that edge case. |
| Base-aware conflicts plus a review screen (keep this / keep cloud / keep both) | kept (user) | Nothing is lost silently. With three or more devices, reviews are pairwise against the latest cloud version. |
| No-base rule: pull if remote is newer and no upload job exists, else conflict | kept (Claude, advisor) | Limits one-time review noise after the v5 upgrade without risking an edit. |
| Cutoff default 04:00 | discarded (user) | Chose 03:00. 04:00 is only an Anki-style convention, not evidence-based. |
| "Done" / "tie" wording for check-off | discarded (user) | "Tie a knot" means create. Use check off / checked off / uncheck. |
| Attribution on by default, with a toggle | kept (user) | Common practice, with a privacy opt-out. |
| Notification opens Capture | kept (user) | Knots list plus count was rejected. |
| A truly pinned Android notification | discarded | Impossible for web apps; would need a TWA/native wrapper. Re-posting on launch and on tap instead. |
| Multi-select via long-press | discarded (Claude) | Clashes with media controls. A "Select" button was used instead. |
| "Keep both" writes remote copy locally before overwriting Drive | kept (Claude, review fix) | The cloud version can never be lost. |
| Scaffold `docs/` / OpenSpec / graph | not done | Not requested; the Kiro spec stays the spec of record. |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
| --- | --- | --- |
| `npx tsc -p tsconfig.json` / `npx tsc -p tsconfig.sw.json` | exit 0 / exit 0 | App and SW type-check. |
| `node src/<x>.chartest.js` for dayCutoff, deviceLabel, knotDiff, knotSummary, mergeMessage, router, syncPlan | all "passed", exit 0 (syncPlan 29 cases) | Pure logic: cutoff and DST, diff, labels, share text, merge copy, routes, base-aware sync, check-off reconcile. |
| `node src/components/timezoneCombobox.proptest.js` | all 7 properties passed | No regression. |
| Browser smoke test (local static server, in-app browser) | pass | DB v5; check-off and Undo (list and detail); cutoff hiding plus "Show 1 checked-off knot"; Calendar fade; multi-share text with attribution on and off; conflict badge, toast, banner and review screen with a stubbed cloud copy; Settings sections. |
| Real Google account / multiple devices | not run | Needs the deployed site; see §6. |

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
| --- | --- | --- | --- | --- |
| branch | `main` @ `fc1dc7c` | clean except this new log file | `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status'` | user commits this log |
| process | local smoke-test server (`node serve.js`, port 8765) | stopped | none | none |
| artifact | scratchpad `serve.js` (session temp dir) | throwaway | none | disposable |
| data | the browser pane's IndexedDB `e-handkerchief-db` @127.0.0.1:8765 | deleted after the test | none | none |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
| --- | --- | --- | --- |
| none | — | OpenSpec not initialised here (`openspec list` → `no_openspec_root`) | — |

## 6. Open items
| Priority | Item | Doc/code reference | Next action | Done when |
| --- | --- | --- | --- | --- |
| P0 | Confirm Drive appProperties per-key merge | `src/cloudSyncService.ts` `sendKnotToDrive` / `pushCheckOff` | Check off on A, edit text on B, then Merge both | Both the check-off and the text survive on both devices. |
| P0 | Real-device conflict flow | `src/screens/conflictScreen.ts`, `resolveConflict` | Edit the same knot on two offline devices, then Merge; try all 3 choices | A review appears and each choice produces the documented result. |
| P1 | Other pending real-device checks | `CLAUDE.md` › Session status 2026-09-29 | Run the list | Every item is ticked. |
| P1 | Notification on Android | `src/notificationService.ts`, `sw.ts` | Enable in Settings, tap, then relaunch | It re-appears and opens Capture under the Pages subpath. |
| P2 | Review Claude-invented copy | `CLAUDE.md` 2026-09-28/29 list | The user reads and edits it | The user accepts or changes each string. |
| P2 | Known limitations: upsert race window; one-time review of pre-upgrade knots | `design.md` › Known Limitations | Decide whether ETag conditional writes are worth it | Decision logged. |
| P2 | Pre-existing: "+" glyph missing on `#/knot/…` and `#/conflict/…`; `timezoneCombobox.js` not precached; no-op `removeEventListener` in older screens; `?error=access_denied`; Req 7 timeout wording; daily email digest | `CLAUDE.md` › Open items | Triage | Each is fixed or explicitly deferred. |
| P3 | Optionally scaffold supercharge `docs/` tree + graphify graph | — | Ask the user | Scaffolded, or declined and logged. |

## 7. Architecture / model changes
New data:
- `Knot.checkedOffAt` and `checkOffChangedAt`.
- `SyncStateRecord` (IDB v5 `syncState`).
- `AppSettings.dayCutoff`, `shareAttribution` and `quickCaptureNotification`.
- Drive `appProperties` `checkedOffAt`, `checkOffChangedAt` and `editedOn`.

New transforms:
- `planSync`: base-aware, emitting conflicts, baseUpdates and checkOff push/pull.
- The upsert guard.
- `resolveConflict`.
- `pushCheckOff`.
- Pure modules: `nextCutoffAfter`, `diffKnots`, `deviceLabelFromUserAgent`, `mergeResultMessage` and `knotsSummaryText`.

New events: `knot:checkedOff` and `knots:conflicts`.

The content sync rule changed from newest-wins to base-aware review; the check-off state keeps newest-wins on its own clock.

Known divergence risks, documented in `design.md` › Known Limitations:
- the check-then-write upsert race;
- the read-then-save gap in `withLatestCheckOff`;
- the unverified per-key `appProperties` merge.

## 8. Docs reconciled
| Doc | Change |
| --- | --- |
| `.kiro/specs/e-handkerchief/requirements.md` | New Req 14–18. Amended 6, 8, 9, 11, 12 (incl. 12.9 Merge sentence) and 13. Glossary terms. |
| `.kiro/specs/e-handkerchief/design.md` | Data model, IDB v5, sync rules, the new modules and screens, notification lifecycle, Known Limitations, SW scope wording. |
| `README.md` | Check-off, sharing several knots, the quick-capture notification (with its Android limitation), conflict review, and the Merge sentence. |
| `CLAUDE.md` | 2026-09-28/29 decisions, session status, and edge cases. 2026-09-24 newest-wins marked superseded. |

## 9. Drift check
`drift-check.ps1 .` → "no docs/ tree here - nothing to check" (exit 0). There are no IMPLEMENTATION.md rows to verify.

## 10. Files changed
All are in commit `fc1dc7c`.
- **Code:** `src/{app,cloudSyncService,db,eventBus,knotStore,knotSummary,notificationService,router,settingsStore,shareService,syncPlan,toastService,types}.ts`, `src/screens/{calendarScreen,knotDetailScreen,knotsScreen,settingsScreen}.ts`, `sw.ts`, `app.css`.
- **New code:** `src/{checkOffActions,dayCutoff,deviceLabel,knotDiff,mergeMessage}.ts`, `src/screens/conflictScreen.ts`.
- **Tests:** `src/{dayCutoff,deviceLabel,knotDiff,mergeMessage}.chartest.ts` (new); `src/{knotSummary,router,syncPlan}.chartest.ts` (extended; the rewritten syncPlan cases are documented in design.md Property 7).
- **Docs:** `.kiro/specs/e-handkerchief/{requirements,design}.md`, `README.md`, `CLAUDE.md`.
- **Session log:** this file (new, uncommitted).
