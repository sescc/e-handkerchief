# 2026-10-03 — open-items-mobile-detail

## 0. Continuation brief
**Current state:** every non-P3 open item from the 2026-09-29 log is done, plus two rounds of user requests on the knot page, the nav bar, Capture location and toasts. The user committed all code and docs as **`4c70b9a`** on `main`.

The only uncommitted changes are a repair to the `CLAUDE.md` decision-log ordering (an earlier edit had cut off the round-1 email-digest line and spliced the round-2 section into round 1) and this final log.

`tsc` (app and SW) passes, as do all 7 chartests and the proptest. Everything new was browser-checked locally at 320×640. What remains is verification on real devices with a real Google account.

The decision and edge-case log is in `CLAUDE.md` › "2026-10-03" and "2026-10-03 (round 2)". The plan is `~/.claude/plans/proceed-with-all-open-partitioned-tulip.md` (round 2 overwrote round 1 there; the round-1 plan content is preserved in the CLAUDE.md log).

**Next step:** the user commits the CLAUDE.md repair and this log, pushes or deploys, and then runs the P0 device checks in §6.

**Resume command/check:** `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status --short && git log --oneline -3'`, then open `CLAUDE.md` › "Session status (as of 2026-10-03)".

## 1. Work completed
**Round 1** (the open-items sweep and the user-reported mobile overflow):
- **Knot detail header.**
  - The header is now two rows: ← Back, then smaller Share / Edit / Delete buttons that wrap.
  - Check off became the ✓/↩ `.knot-check-btn` tick beside the timestamp.
  - `.edit-actions` wraps.
- **Nav "+" glyph:** it was invisible (primary on primary) because of a CSS specificity clash; fixed.
- **OAuth `?error=`:** `cloudSyncService.handleOAuthError` shows a toast, strips the URL and clears `pkce_verifier`.
- **Upsert race narrowing.**
  - The pure `remoteChangedSinceBase` (`src/syncPlan.ts`) is shared by `upsertKnot`.
  - `doSyncAll` step 6 now re-lists and re-checks before each push. A race conflict is recorded and its upload job cleared.
- **Transcription:** `STOP_SAFETY_MS = 3000` force-finishes `stop()`, and `onerror` ignores late events once the session has resolved.
- **Housekeeping.**
  - `timezoneCombobox.js` is precached.
  - `deploy.yml` deletes `*.chartest.js` / `*.proptest.js`.
  - The 9 no-op `removeEventListener` calls now use named handlers.
- **Docs.**
  - Req 7 is rewritten to describe live transcription.
  - New Req 11.13 covers OAuth cancel.
  - design.md: Known Limitations corrected (Drive v3 has no ETag), and a new "Daily Email Summary — options (deferred)" section.

**Round 2:**
- The transcription "Saved. …" notice is back to the old spec: 5 s or tap. All plain `toastService.show()` toasts are now tap-to-dismiss.
- **Knot page:** a green "✓ Checked off · <date time>" pill (`.knot-checked-off-pill`), and a new `--color-primary-soft` token (light and dark).
- **Nav.**
  - The pure `navTabForRoute` (`src/router.ts`) means knot and conflict pages highlight Knots.
  - "+" on Capture is `--color-primary-dark` with a ring.
- **Capture location:** `geoService.locate()` returns denied or unavailable. The location line is a tap-to-retry `button.location-retry`, guarded by a request id and a `disposed` flag.
- **Docs.**
  - New Req 1.9 (location retry), 13.10 (the pill), 13.11 (current tab); Req 1.4, 1.5 and 7.3 updated.
  - The matching design.md sections.
  - README: Capture location, and the pill.

## 2. Decisions
| Decision | Verdict | Why |
| --- | --- | --- |
| Detail header: two rows + in-card tick | kept (user) | A tick alone still left about 410px in one row. |
| Icon-only header buttons | discarded (user) | Not chosen. |
| Narrow the race by re-checking in Merge | kept (user) | Drive v3 has no ETag/If-Match, so the race can't be closed. |
| Self-heal check-off keys / per-device Drive files | discarded (user) | Not chosen; the per-device approach would be a redesign. |
| Drive `version` as a guard | discarded (Claude) | Check-off PATCHes bump it. |
| Req 7: describe live transcription + 3 s stop cap | kept (user) | The old 30 s wording didn't match the code. |
| Req 7.3 notice 6 s, no tap | **superseded** (user, round 2) | The user wants the old spec: 5 s or tap. |
| Tap-to-dismiss on all plain `show()` toasts | kept (Claude, plan approved) | Consistent; none of the ~40 callers act on a click. |
| Daily email digest | design write-up only (user) | Still deferred. |
| Checked-off look on knot page: date pill, tick kept | kept (user) | No fading or strike-through on the dedicated view. |
| Toggle-pill / pill without a date | discarded (user) | Not chosen. |
| "+" on Capture: darker + ring | kept (user) | Over "lighter elsewhere". |
| Knot/review pages highlight the Knots tab | kept (user) | Over "no tab highlighted". |
| Location copy: separate tap-to-retry and blocked messages | kept (user) | Over keeping the old text plus "Tap to retry". |
| `--color-primary-soft` token | kept (Claude) | Fixes the dark-mode tint of the pill, tick hover and backup badge. |
| 2026-09-29 Claude-invented copy | kept as is (user, via plan approval) | No edits were marked. |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
| --- | --- | --- |
| `npx tsc -p tsconfig.json` / `npx tsc -p tsconfig.sw.json` | exit 0 / exit 0 (after round 2) | Types are OK. |
| `node src/{syncPlan,mergeMessage,dayCutoff,deviceLabel,knotDiff,knotSummary,router}.chartest.js` | all passed (syncPlan has 36 scenarios; router has 20 cases, 8 of them new for `navTabForRoute`) | The guard and nav-tab semantics; no regressions. |
| `node src/components/timezoneCombobox.proptest.js` | all properties passed | No regression. |
| SW ASSETS existence | 40 entries, 0 missing | The precache install won't 404. |
| Browser 320×640, round 1 | pass | Header fits (doc width 320); tick + Undo; tick hidden in edit mode; `?error=access_denied` → toast and clean URL. |
| Browser 320×640 dark, round 2 | pass | "+" on Capture = #2d7a4f with a #1e1e1e/#4caf76 ring, normal elsewhere; Knots tab current on `#/knot/…`; pill shows local time (SGT) and goes away on Undo; stubbed geolocation code 1 → blocked copy, code 2 → unavailable copy, success → coordinates; tapping a toast dismisses it with `cursor: pointer`. |
| Conflict screen at 320px | not stubbed | Reuses the header CSS; `.conflict-actions` is already a column. |
| Real Google account / devices | not run | See §6. |

Testing gotcha: the in-app browser pane, when hidden, freezes CSS transitions, so a computed `background` can read as the old value. Read it with `transition: none`. A stale service worker can also serve old JS/CSS on the local server; unregister it and clear the caches before testing.

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
| --- | --- | --- | --- | --- |
| branch | `main` @ `4c70b9a` | dirty: `CLAUDE.md` (log repair) + this log | `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status --short'` | the user commits |
| process | scratchpad `serve.js` on 127.0.0.1:8765 | stopped | none | none |
| data | browser-pane IndexedDB `e-handkerchief-db` and SW registration @127.0.0.1:8765 | deleted / unregistered | none | none |
| artifact | scratchpad `serve.js` (session temp dir) | throwaway | none | disposable |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
| --- | --- | --- | --- |
| none | — | `openspec list --json` → `no_openspec_root` | — |

## 6. Open items
| Priority | Item | Doc/code reference | Next action | Done when |
| --- | --- | --- | --- | --- |
| P0 | Drive `appProperties` per-key merge | `src/cloudSyncService.ts` `sendKnotToDrive` / `pushCheckOff`; design.md Known Limitations | Check off K on A, then Merge. Edit K's text on B, then Merge on B and then on A. | Both devices show the new text and the check-off; Manage backups shows "Checked off". |
| P0 | Conflict review flow | `src/screens/conflictScreen.ts`, `resolveConflict` | Edit K on two offline devices, then Merge; try this device / cloud / both. | A review appears and each choice works. |
| P1 | Other device checks | `CLAUDE.md` › Session status 2026-09-29 / 2026-10-03 | 3 devices take turns; an offline save then Merge says "1 backed up"; Android notification; multi-share with media; cancelling consent shows the toast and a clean URL. | All ticked. |
| P1 | Phone UI check of today's changes | `src/screens/{knotDetailScreen,captureScreen}.ts`, `app.css` | On a phone: the detail rows and tick, the pill, the "+" ring, and location retry with Location toggled off and then on. | It looks and behaves as browser-checked. |
| P2 | Daily email digest decision | design.md › "Daily Email Summary — options (deferred)" | The user picks (a) / (b) / (c), or keeps it deferred. | Decision logged. |
| P3 | `.combobox-option.is-highlighted` hard-codes the light-mode rgba | `app.css` ~1483 | Switch it to `--color-primary-soft` if wanted. | The highlight tint is right in dark mode. |
| P3 | Optional supercharge `docs/` tree + graphify graph | — | Ask the user. | Scaffolded, or declined and logged. |

## 7. Architecture / model changes
- **New pure transforms:**
  - `remoteChangedSinceBase(remote, base, local)`, the push guard (`src/syncPlan.ts`);
  - `navTabForRoute(route)` (`src/router.ts`).
- **New transitions:**
  - `cloudSyncService.handleOAuthError`;
  - `geoService.locate()`, which returns `LocateResult`, with `getCurrentPosition()` as a wrapper;
  - `toastService.show()`, which is now tap-to-dismiss.
- **Changed `doSyncAll` step 6:** it re-lists and re-checks immediately before each write, and a race conflict feeds `countConflicts()` and the step-8 job clearing.
- **New UI state:**
  - the location request id and `disposed` in `captureScreen`;
  - `stopSafetyTimer` in the live transcription handle.
- There are no new persisted data fields and no IDB change.
- **Known divergence, unchanged and documented:** the list-to-write race window; the per-key merge is unconfirmed.

## 8. Docs reconciled
| Doc | Change |
| --- | --- |
| `.kiro/specs/e-handkerchief/requirements.md` | Glossary; Req 1.4, 1.5 and new 1.9; 7.1 and 7.3; new 11.13; 13.9 and new 13.10, 13.11; 14.1. |
| `.kiro/specs/e-handkerchief/design.md` | Known Limitations; sync steps 6 and 10; OAuth `?error=`; TranscriptionService cap; ToastService; KnotDetailScreen tick and pill; Router nav / Property 6; GeoService `locate`; CaptureScreen retry; precache; deploy; Property 7; email digest options; tokens. |
| `README.md` | Check-off tick and pill; Capture location retry; tree comments. |
| `CLAUDE.md` | 2026-10-03 and round-2 decisions, edge cases, session status. The end-of-session repair of the section order and the cut-off digest line is uncommitted. |

## 9. Drift check
`drift-check.ps1 .` → `0 dead / 0 refs`. There is no `docs/` architecture tree, so there are no IMPLEMENTATION.md rows to verify. Graph refresh skipped: this repo has no `graphify-out/` (P3, not requested). gbrain isn't installed, so this log is not indexed across repos.

## 10. Files changed
- **In `4c70b9a`:**
  - `.github/workflows/deploy.yml`, `app.css`, `sw.ts`;
  - `src/{app,cloudSyncService,geoService,router,router.chartest,syncPlan,syncPlan.chartest,toastService,transcriptionService}.ts`;
  - `src/screens/{captureScreen,knotDetailScreen,settingsScreen}.ts`;
  - `.kiro/specs/e-handkerchief/{design,requirements}.md`, `README.md`, `CLAUDE.md`;
  - the earlier draft of this log.
- **Uncommitted:** `CLAUDE.md` (log repair) and this log.
