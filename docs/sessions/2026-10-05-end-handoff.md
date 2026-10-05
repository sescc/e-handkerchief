# 2026-10-05 — end-handoff

## 0. Continuation brief
**Current state:** all of this session's work is committed and pushed:
- **`304a492`** (round 1): location fallback, Manage-backups copy placement, m4a import, Mic processing off, notification failure line. It also carries the 2026-10-04 end-handoff log and the "🎲 Another random knot" label.
- **`e3110c7`** (round 2): the service worker had never registered, because of a stray `export {}`. It is now fixed, with a CI guard.

GitHub Pages serves the round-2 `sw.js` (build `e3110c73-29`, no `export` line), so the CI parse guard passed. The only change after the commits is this log plus the `CLAUDE.md` session-status line that records the commit hashes.

For the full session, read `2026-10-05-location-m4a-mic-notif.md` (rounds 1 and 2) and this log.

**Next step:** the user runs the phone checks in §6. The service-worker check goes first, because it unblocks the notification and offline checks.

**Resume command/check:** `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status --short && git log --oneline -3'`, then `CLAUDE.md` › "Session status (as of 2026-10-05)".

## 1. Work completed
- Since the round-1 log: the round-2 root cause and fix, recorded in that log's §11 and in `CLAUDE.md` › "2026-10-05 (round 2)".
- End reconcile: the `CLAUDE.md` 2026-10-05 status now names `304a492` and `e3110c7` as committed and pushed. Before, it said "not committed".

## 2. Decisions
| Decision | Verdict | Why |
| --- | --- | --- |
| Classic-script SW (remove `export {}`) | kept (Claude, plan approved) | Module service workers aren't universal. |
| Register the SW as a module | discarded | Older Firefox lacks support. |
| CI `new Function` parse guard on `sw.js` | kept (Claude, plan approved) | A module-syntax `sw.js` now fails the build instead of silently never registering. |
| `SW_WAITING` only when `registration.active` exists | kept (Claude, plan approved) | No "New version" toast on the first install. |
| Don't cache query-string URLs in `networkFirst` | kept (Claude, plan approved) | Keeps the single-use OAuth `?code=` out of Cache Storage. |
| Verify SW behaviour in the in-app browser pane | discarded (Claude) | The pane can't register any SW. Use headless Edge over CDP instead (`scratchpad/cdp-swtest.mjs`, not in the repo). |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
| --- | --- | --- |
| `npx tsc -p tsconfig.json` / `npx tsc -p tsconfig.sw.json` | exit 0 / exit 0 | Types are OK in SW script mode. |
| `node -e "new Function(require('fs').readFileSync('sw.js','utf8'))"` | exit 0 (the old file failed: `SyntaxError: Unexpected token 'export'`) | `sw.js` runs as a classic script. |
| All 10 chartests + the timezone proptest | 0 failures | No regressions. |
| Headless Edge (CDP), fresh profile | registered, ready, controller set, 43 precached, 0 query URLs cached, no `SW_WAITING` on first install | The SW works end to end locally. |
| The deployed `https://sescc.github.io/e-handkerchief/sw.js` | build `e3110c73-29`, no `export {}` | The fix is live and the CI guard passed. |
| `drift-check.ps1 .` | `0 dead / 0 refs` | No dead doc references. |

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
| --- | --- | --- | --- | --- |
| branch | `main` @ `e3110c7`, even with `origin/main` | clean except this log and `CLAUDE.md` | `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status -sb'` | the user commits |
| deployment | GitHub Pages `sescc.github.io/e-handkerchief` | serving build `e3110c73-29` | fetch `sw.js` and read `BUILD_VERSION` | none |
| port | 127.0.0.1:8765 (scratchpad `serve.js`) | free (stopped) | none | none |
| port | 9333 (headless Edge CDP) | free (no process) | none | none |
| artifact | scratchpad `edge-profile*` directories | partly left (locked cache files) | scratchpad only | disposable, deleted with the scratchpad |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
| --- | --- | --- | --- |
| none | — | `openspec list --json` → `changes: [], root: null` | — |

## 6. Open items
| Priority | Item | Doc/code reference | Next action | Done when |
| --- | --- | --- | --- | --- |
| P0 | SW and notification on the phone | `sw.ts`, `src/notificationService.ts` | Open the app online once, then fully close and reopen it. Check Settings › Notifications: no failure line, and "Tap to tie a knot" in the drawer. Tap it and Capture opens. Then airplane mode → the app loads offline. | All hold on the phone. |
| P0 | Round-1 phone checks | `CLAUDE.md` › Session status (as of 2026-10-05) | Location off → "Location unavailable", then retry; Mic: no hiccups, comfortable level; m4a via Library plays and transcribes; photo picking still convenient. | All behave as checked locally. |
| P1 | Claude-invented copy | the notification failure line, the m4a import toast, "This is your only unchecked knot", "Could not load knots" | The user reviews the wording. | Approved. |
| P2 | Photo/Video error copy lists M4A | `src/components/mediaCapture.ts` `handleMediaError` | Optional per-button copy. | Decided. |
| P2 | Daily email digest | design.md | Deferred (user). | — |
| P3 | Supercharge scaffold (`docs/` tree, graph, OpenSpec) | plan `decisions-proceed-with-p2-recursive-dawn.md` Step 5 | KIV (user). | — |

## 7. Architecture / model changes
None since the round-1 log. The SW (`Loc`: service worker; `Trn`: precache, network-first/cache-first, notification click, update message) now actually runs in production for the first time.

## 8. Docs reconciled
| Doc | Change |
| --- | --- |
| `CLAUDE.md` | 2026-10-05 Session status: both rounds marked committed and pushed (`304a492`, `e3110c7`). |

## 9. Drift check
`drift-check.ps1 .` → `0 dead / 0 refs`. Graph refresh skipped: there is no `graphify-out/` (P3 KIV). gbrain: the round-1/2 log is indexed as `inbox/2026-10-05-d35c989e` and this log as `inbox/2026-10-05-76afd144`. This log was captured before this line was added.

## 10. Files changed
- `CLAUDE.md` (status line)
- `docs/sessions/2026-10-05-end-handoff.md` (this log)
