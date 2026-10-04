# 2026-10-04 — toggle-location-random

## 0. Continuation brief
**Current state:** the Settings toggle overflow is fixed, Capture now tells "Location is off" apart from "blocked for this site", the Sharing setting has its new label and hint, the Random knot feature is in, the "Show N checked-off knots" toggle is at the top of the Knots list, and the dark-mode combobox highlight uses the shared token. All of it is implemented, reviewed and browser-checked at 320×640, but **not committed**. `main` is still at `4c70b9a`.

The working tree also still holds the staged 2026-10-03 `CLAUDE.md` log repair and the 2026-10-03 session log, which the user hadn't committed yet.

`tsc` (app and SW) exits 0, all 9 chartests and the timezone proptest pass. What remains is verification on a real phone and with a real Google account.

The decision and edge-case log is in `CLAUDE.md` › "2026-10-04". The plan is `~/.claude/plans/decisions-proceed-with-p2-recursive-dawn.md`.

**Next step:** the user commits (suggested message in `CLAUDE.md` › "Session status (as of 2026-10-04)"), pushes or deploys, and runs the P0/P1 phone checks in §6.

**Resume command/check:** `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status --short && git log --oneline -3'`, then open `CLAUDE.md` › "Session status (as of 2026-10-04)".

## 1. Work completed
- **Settings toggle overflow (user-reported on a phone).**
  - Cause: `buildToggle` returns `<label class="toggle-switch">`. In the Notifications row's plain `div.settings-row-control` the label stayed inline, so its 44×26 size was ignored and the absolutely positioned slider and knob spilled out to the right.
  - Fix: `.toggle-switch { display: block }`. The label wrappers of the Transcription, Email, Sharing and Notifications rows also got `settings-row-labelwrap` (`min-width: 0; flex: 1`).
- **Sharing setting copy.** Label "Append source when sharing", with the hint `Adds "— Shared from e-Handkerchief" and a link to the application at the end of what you share.`
- **Location off vs blocked (user-reported).**
  - Android Chrome reports PERMISSION_DENIED (code 1) both when the site is blocked and when the phone's Location is off.
  - New pure `src/locateFailure.ts` `classifyLocateFailure(code, permState)`. `geoService.locate()` queries the Permissions API only after a code-1 error (capped at 1 s) and resolves exactly once.
  - `LocateResult.reason` is now `denied | off | unknown | unavailable`; Capture has copy for each.
  - `src/locateFailure.chartest.ts` has 12 scenarios.
- **Random knot.**
  - "🎲 Random" in the Knots header (before Select, hidden in select mode) opens `#/random/{id}` for a random knot that is not checked off.
  - The knot page gets "Another random knot", which never repeats the current knot and is hidden in edit mode.
  - Pure `src/randomKnot.ts` `pickRandomKnot`; `src/randomKnot.chartest.ts` has 16 checks.
  - The router parses `#/random/{id}` to the `knot` route with `params.random = '1'`; the Knots tab stays current.
- **Checked-off toggle at the top.** "Show N checked-off knots" / "Hide checked-off knots" is now the first child of the Knots list (above the empty-state message), with margin-bottom spacing.
- **Combobox highlight.** `.combobox-option.is-highlighted` uses `var(--color-primary-soft)`, so it is right in dark mode.
- **Service worker.** `sw.ts` ASSETS gains `src/locateFailure.js` (after geoService) and `src/randomKnot.js` (after knotSummary): 42 entries.
- **Docs.** New Req 19 and amendments to Req 1.4, 1.5, 1.9, 6.10, 12.16, 13.11, 14.6; design.md, README and `CLAUDE.md` updated (§8).

## 2. Decisions
| Decision | Verdict | Why |
| --- | --- | --- |
| Daily email digest (P2) | kept deferred (user) | The user chose to leave it for now; options stay in design.md. |
| Supercharge `docs/` tree, graphify graph, OpenSpec (P3) | KIV (user) | Not done this session; the design is kept in plan Step 5. |
| Digest option: "In-app digest, no server" | discarded (user) | Not chosen. |
| Digest options (a) and (b) | discarded (user) | Not chosen; the digest stays deferred. |
| Location copy: reuse "unavailable" for the off case | discarded (user) | Not chosen; the user approved separate "off" and "unknown" copy. |
| Location copy: "Location is off — turn it on, then tap to retry" and "Location is off or blocked — turn it on or allow it for this site, then tap to retry" | kept (user) | Tell the user which setting to change. |
| Sharing setting: keep the label, add a hint | discarded (user) | Not chosen; the label is now "Append source when sharing" with the hint. |
| Sharing hint dash: "—" instead of the typed "-" | kept (user, via plan approval) | Matches the real footer; flagged in the plan. |
| Random entry point: Knots header only | discarded (user) | Not chosen; the final design is the header button plus "Another random knot" on the knot page. |
| Random entry point: Capture screen | discarded (user) | Not chosen. |
| Random: unchecked knots only, from the whole store | kept (user) | Design approved. |
| "No unchecked knots yet" toast | kept (user) | User-approved wording. |
| "This is your only unchecked knot" / "Could not load knots" toasts | kept (Claude), **needs user review** | Invented by Claude; not yet approved. |
| `.toggle-switch` `display: block` (not inline-block) | kept (Claude, plan approved) | Avoids the baseline gap. |
| "Show N checked-off knots" toggle moved to the top | kept (user) | Hard to reach at the bottom of a long list. |
| Combobox highlight uses `--color-primary-soft` | kept (Claude, plan approved) | Closes the 2026-10-03 P3 item. |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
| --- | --- | --- |
| `npx tsc -p tsconfig.json` / `npx tsc -p tsconfig.sw.json` | exit 0 / exit 0 | Types are OK. |
| `node src/{dayCutoff,deviceLabel,knotDiff,knotSummary,locateFailure,mergeMessage,randomKnot,router,syncPlan}.chartest.js` | all 9 passed (locateFailure 12 scenarios, randomKnot 16, router 24) | The new classifier, picker and route; no regressions. |
| `node src/components/timezoneCombobox.proptest.js` | all properties passed | No regression. |
| SW ASSETS existence | 42 entries, 0 missing | The precache install won't 404. |
| Browser 320×640: Settings toggles | pass | They stay inside their rows in light and dark, with `Notification.permission` stubbed to granted; document width 320. |
| Browser 320×640: Capture location copy | pass | granted → off; denied → blocked; prompt, throw or hang → combined; code 2 → unavailable. A retry after "off" then success resolves the location. |
| Browser 320×640: Knots header | pass | Random at x 163–246, Select at 254–304. |
| Browser 320×640: checked-off toggle | pass | It is the first child of the list, and Show/Hide works. |
| Browser 320×640: Random | pass | Opens `#/random/test-2` with the Knots tab current. On the knot page "Another random knot" + Share fit on row 1 and Edit + Delete wrap to row 2, with no horizontal scroll. Both empty-state toasts appear; Random is hidden in select mode. 8 consecutive "Another" taps across 3 knots gave 0 repeats. |
| Browser: combobox highlight, dark | pass | `rgba(76,175,118,0.18)`. |
| Real phone / real Google account | not run | See §6. |

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
| --- | --- | --- | --- | --- |
| branch | `main` @ `4c70b9a` | dirty: see §10 | `wsl -e bash -c 'cd /mnt/c/FMW/Code/Kiro/e-Handkerchief && git status --short'` | the user commits |
| process | scratchpad `serve.js` on 127.0.0.1:8765 | stopped | none | none |
| data | browser-pane IndexedDB `e-handkerchief-db` and SW registration @127.0.0.1:8765 | deleted / unregistered | none | none |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
| --- | --- | --- | --- |
| none | — | `openspec list --json` → `no_openspec_root` | — |

## 6. Open items
| Priority | Item | Doc/code reference | Next action | Done when |
| --- | --- | --- | --- | --- |
| P0 | Phone checks of today's changes | `src/screens/{settingsScreen,captureScreen,knotsScreen,knotDetailScreen}.ts`, `app.css` | On a phone: Location off → "Location is off" copy, then turn Location on and tap retry; the Settings toggle sits inside its row; Random and Another; the checked-off toggle at the top. | It looks and behaves as browser-checked. |
| P0 | 2026-10-03 phone and real-Google-account checks (including the Drive `appProperties` per-key merge and the conflict review flow) | `CLAUDE.md` › Session status 2026-10-03 / 2026-09-29 | Run the checklists there. | All ticked. |
| P1 | Claude-invented toast copy: "This is your only unchecked knot" / "Could not load knots" | `src/screens/knotDetailScreen.ts`, `src/screens/knotsScreen.ts` | The user reviews or changes the wording. | Wording approved. |
| P2 | Daily email digest | design.md › "Daily Email Summary — options (deferred)" | The user decides when to revisit. | Decision logged. |
| P3 | Supercharge `docs/` tree, graph and OpenSpec | plan `decisions-proceed-with-p2-recursive-dawn.md` Step 5 | KIV (user); revisit when asked. | Scaffolded, or declined and logged. |

## 7. Architecture / model changes
- **New pure transforms:**
  - `classifyLocateFailure(code, permState)` (`src/locateFailure.ts`);
  - `pickRandomKnot(knots, excludeId, rand)` (`src/randomKnot.ts`).
- **Changed contract:** `LocateResult.reason` widened from `denied | unavailable` to `denied | off | unknown | unavailable`; `geoService.locate()` resolves exactly once.
- **New route form:** `#/random/{id}`, which parses to the `knot` route with `params.random = '1'`. No new `Route` value.
- There are no new persisted data fields and no IDB change.

## 8. Docs reconciled
| Doc | Change |
| --- | --- |
| `.kiro/specs/e-handkerchief/requirements.md` | Req 1.4, 1.5, 1.9; new 6.10; 12.16; 13.11; 14.6; new Req 19 (Random Knot). |
| `.kiro/specs/e-handkerchief/design.md` | Component table; GeoService API and contracts; Router and `navTabForRoute`; CaptureScreen retry copy; KnotsScreen Random and toggle position; KnotDetailScreen "Another random knot"; Settings › Sharing and toggle layout; precache list; project tree; test run list; Property 6, new Properties 12 and 13; Error Handling; CSS tokens. |
| `README.md` | Test list; Capture location messages; new "Random knot" section; checked-off toggle position; Sharing setting name; tree comments. |
| `CLAUDE.md` | 2026-10-04 decisions, edge cases and session status; superseded notes on the combobox highlight and the location copy. |

## 9. Drift check
`drift-check.ps1 .` → `0 dead / 0 refs`. There is no `docs/` architecture tree (P3, KIV), so there are no IMPLEMENTATION.md rows to verify. There is no graph. gbrain isn't installed, so this log is not indexed across repos.

## 10. Files changed
- **Uncommitted, modified (`git diff --stat`, 13 files):**
  - `.kiro/specs/e-handkerchief/{design,requirements}.md`, `README.md`, `CLAUDE.md`;
  - `app.css`, `sw.ts`;
  - `src/{geoService,router,router.chartest}.ts`;
  - `src/screens/{captureScreen,knotDetailScreen,knotsScreen,settingsScreen}.ts`.
- **Uncommitted, new:** `src/locateFailure.ts`, `src/locateFailure.chartest.ts`, `src/randomKnot.ts`, `src/randomKnot.chartest.ts`, and this log.
- **Already staged from 2026-10-03, still uncommitted:** the `CLAUDE.md` log-order repair and `docs/sessions/2026-10-03-open-items-mobile-detail.md`.
