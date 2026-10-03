# 2026-10-03 — open-items-mobile-detail

## 0. Continuation brief
**Current state:** every non-P3 open item from the 2026-09-29 log is done, along with the user-reported mobile overflow on the knot detail page. It is all implemented, reviewed, type-checked, tested and browser-checked at 320×640, but **uncommitted**: 15 files changed, plus this log. The plan is `~/.claude/plans/proceed-with-all-open-partitioned-tulip.md`. Decisions and edge cases are in `CLAUDE.md` › "2026-10-03" and "Edge cases added 2026-10-03".

**Next step:** the user reviews and commits (suggested message in `CLAUDE.md` › Session status 2026-10-03), deploys, then runs the real-device checklist in §6.

**Resume command/check:** `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status --short'`

## 1. Work completed
- **Knot detail on mobile.**
  - The header is two rows: ← Back on row 1; smaller Share / Edit / Delete on row 2, which wraps.
  - Check off is now the ✓/↩ `.knot-check-btn` tick beside the timestamp (`.knot-detail-meta`) and is hidden in edit mode.
  - `.edit-actions` wraps.
- **"+" nav glyph:** a CSS specificity fix (`.nav-bar .capture-btn[aria-current="page"]`).
- **OAuth `?error=`:** `cloudSyncService.handleOAuthError`, called from `app.ts` init.
- **Race narrowing:**
  - The pure `remoteChangedSinceBase` in `syncPlan.ts` is used by `upsertKnot` and by a new re-list and re-check in `doSyncAll` step 6.
  - A race conflict is recorded, counted via `countConflicts()`, and its upload job is cleared.
- **Transcription:**
  - `STOP_SAFETY_MS = 3000` force-finishes `stop()`.
  - `onerror` ignores late events once the session has resolved.
- **Housekeeping:**
  - `timezoneCombobox.js` is precached.
  - `deploy.yml` deletes `*.chartest.js` / `*.proptest.js`.
  - The 9 no-op `removeEventListener` calls now use named handlers.
- **Docs:**
  - design.md: Known Limitations, sync step 6/10, OAuth, TranscriptionService, KnotDetailScreen, precache, deploy, Property 7, and a new "Daily Email Summary — options (deferred)" section.
  - requirements.md: glossary, 7.1, 7.3, new 11.13, 13.9 and 14.1.
  - README and CLAUDE.md.

### Round 2 (same day)
- **Notice:** the transcription notice is back to 5 s or dismiss on tap. All plain `show()` toasts can now be tapped away.
- **Knot page:** a green "✓ Checked off · <date time>" pill, plus a `--color-primary-soft` token.
- **Nav:** "+" is darker with a ring when on Capture. `navTabForRoute` makes knot and review pages highlight Knots.
- **Capture location:** tap-to-retry, with separate copy for blocked and unavailable, via `geoService.locate()`.
- See CLAUDE.md › "2026-10-03 (round 2)".

## 2. Decisions
| Decision | Verdict | Why |
| --- | --- | --- |
| Detail header: two rows + in-card tick | kept (user) | A tick alone still left about 410px in a single row. |
| Icon-only buttons | discarded (user) | Not chosen. |
| Narrow the race by re-checking in Merge | kept (user) | Drive v3 has no ETag/If-Match, so the race can't be closed. |
| Self-heal the check-off keys after a content PATCH | discarded (user) | Not chosen; the per-key merge is still to be checked on a device. |
| Per-device Drive files | discarded (user) | A large redesign. |
| Drive `version` as a guard | discarded (Claude) | Check-off PATCHes bump it. |
| Req 7: rewrite the text + 3 s stop cap | kept (user) | The code transcribes live, so the old 30 s wording was wrong. |
| Req 7.3 notice: 6 s, no dismiss-on-tap | kept (Claude, matches code) | `toastService.show(msg, 6000)` is what ships. |
| Daily email digest: design write-up only | kept (user) | Still deferred. |
| 2026-09-29 Claude-invented copy | kept as is (user, via plan approval) | No edits were marked. |
| "Google Drive connection cancelled" | kept (Claude, approved with plan) | — |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
| --- | --- | --- |
| `npx tsc -p tsconfig.json` / `tsconfig.sw.json` | exit 0 / exit 0 | Types are OK. |
| `node src/{syncPlan,mergeMessage,dayCutoff,deviceLabel,knotDiff,knotSummary,router}.chartest.js` | all passed (syncPlan now has 36 scenarios) | The guard's semantics; no regressions. |
| `node src/components/timezoneCombobox.proptest.js` | all properties passed | No regression. |
| SW ASSETS existence (40 entries) | missing=0 | The precache install won't 404. |
| Browser at 320×640 (local server, in-app pane) | pass | Detail header fits (doc width 320); tick + Undo; tick hidden in edit mode; "+" white on `#/` and `#/knot/…`; `?error=access_denied` → toast and clean URL. |
| Conflict screen at 320px | not stubbed | Reuses the header CSS; `.conflict-actions` is already a column. |
| Real Google account / devices | not run | See §6. |

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
| --- | --- | --- | --- | --- |
| branch | `main` @ `fc1dc7c` + uncommitted changes | dirty (15 files + this log) | `git status` via WSL | the user commits |
| process | scratchpad `serve.js` on 127.0.0.1:8765 | stopped | none | none |
| data | browser-pane IndexedDB `e-handkerchief-db` | deleted after the test | none | none |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
| --- | --- | --- | --- |
| none | — | OpenSpec isn't initialised in this repo | — |

## 6. Open items
| Priority | Item | Next action | Done when |
| --- | --- | --- | --- |
| P0 | Per-key `appProperties` merge | Check off K on A, then Merge. Edit K's text on B, then Merge on B and then on A. | Both devices show the new text and the check-off; Manage backups shows "Checked off". |
| P0 | Conflict flow | Edit K on two offline devices, then Merge; try this device / cloud / both. | A review appears and each choice works. |
| P1 | Other device checks | 3 devices take turns; an offline save then Merge says "1 backed up"; Android notification; multi-share with media; cancelling Google consent gives the toast and a clean URL; detail page on a real phone. | All ticked. |
| P2 | Daily email digest | Pick (a)/(b)/(c) in design.md, or keep it deferred. | Decision logged. |
| done | Req 7.3 notice → 5 s or tap (round 2) | — | — |
| done | Checked-off pill on knot page (round 2) | — | — |
| P3 | Optional `docs/` tree + graphify graph | Ask the user. | Done or declined. |

## 7. Architecture / model changes
- New pure transform: `remoteChangedSinceBase(remote, base, local)`. A new guard runs inside `doSyncAll` step 6.
- New OAuth transition: `handleOAuthError`.
- New timer state in the live transcription handle (`stopSafetyTimer`).
- There are no new data fields or IDB changes.

## 8. Docs reconciled
`.kiro/specs/e-handkerchief/{design,requirements}.md`, `README.md` and `CLAUDE.md` (see §1).

## 9. Drift check
`drift-check.ps1 .` reported "0 dead / 0 refs". There is no `docs/` architecture tree, so there are no IMPLEMENTATION.md rows to check.

## 10. Files changed
`.github/workflows/deploy.yml`, `app.css`, `sw.ts`, `src/{app,cloudSyncService,syncPlan,syncPlan.chartest,transcriptionService}.ts`, `src/screens/{captureScreen,knotDetailScreen,settingsScreen}.ts`, `.kiro/specs/e-handkerchief/{design,requirements}.md`, `README.md`, `CLAUDE.md`, plus this log.
