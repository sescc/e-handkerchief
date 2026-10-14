# 2026-10-14 — search-public-readme-scrub

This session ran from 2026-10-14 into 2026-10-15. The decision and edge-case log is in `CLAUDE.md`, under "2026-10-14", "2026-10-14 (round 2)" (two sections) and "2026-10-14 (round 3)". The status is in "Session status (as of 2026-10-14)". The plan file is `~/.claude/plans/1-with-the-increase-enchanted-squirrel.md`; it holds round 3, and each round overwrote the previous one.

## 0. Continuation brief
**Current state:**
- Rounds 1–3 are committed and pushed:
  - **`1d86466`:** search, the backups filter, `DRIVE_BACKUP=off`, the public README and guide, the licence, `npm test`, and the scrub.
  - **`c714607`:** the multi-select chips and "On device", the Dictate half-word fix, removal of the `public/` and `static/` folders, the README tree and the five screenshots.
- **History rewrite:** the user rewrote the repository history with `git filter-repo` (author and committer go to the GitHub noreply address; personal strings in old file versions are replaced) and force-pushed. All commit hashes before 2026-10-14 changed.
- **Uncommitted:** Claude remapped the 61 short hashes quoted in `CLAUDE.md`, `docs/sessions/*.md` and the memory notes. That remap, a small `CLAUDE.md` status cleanup, and this log are not committed.
- **Live:** the Wiki mirror is live, publishing `docs/guide/` to the GitHub Wiki.

**Next step:**
1. The user commits and pushes the remaining docs (`git add -A`).
2. The user confirms the Worker `ALLOWED_ORIGIN` secrets.
3. The user runs the phone checks in §6 after the Pages deploy.

**Resume command/check:** `git status -sb && git log --oneline -3`, run from the repo root, then `CLAUDE.md` › "Session status (as of 2026-10-14)".

## 1. Work completed
- **Round 1 (`1d86466`):**
  - **Search:**
    - `src/knotSearch.ts` (pure; ignores accents and case; every word must match), `src/searchState.ts` (the shared in-memory query), `src/components/searchRow.ts` and `src/components/searchHighlight.ts` (DOM nodes only, no `innerHTML`).
    - The 🔍 between "Knots" and Random focuses the field at once. Results include faded checked-off knots, and matches are highlighted.
    - Calendar: matching days highlighted, other days dimmed, "N matches on M days", and ‹ › jumps.
  - **Manage backups filter:** `src/backupFilter.ts`.
  - **Drive opt-out:** `DRIVE_BACKUP=off` for forks, via `src/driveBackup.ts`, the `config.js` placeholder, a `deploy.yml` branch and a `storedToken()` gate in `cloudSyncService`.
  - **Docs and repo:**
    - The README is rewritten for visitors and self-hosters.
    - `docs/guide/` has 8 pages, mirrored to the Wiki by `.github/workflows/wiki.yml`.
    - New `CONTRIBUTING.md`, `LICENSE` (PolyForm Noncommercial 1.0.0), and `npm test` via `scripts/run-tests.js`.
  - **Scrub:**
    - Paths, timezone hints, the username and a project-id fragment are gone from the files.
    - The timezone shortlist and the test and doc examples are neutral.
    - `ALLOWED_ORIGIN` becomes a Worker secret.
  - Independent personal-data verifier: clean.
- **Round 2 (`c714607`):**
  - **Chips:** All · Backup only · Checked off · On device, multi-select (place chips OR'd together, Checked off AND'd on top).
  - **Dictate:** a same-instance character-prefix merge rule (`charPrefix` in `src/transcriptMerge.ts`) fixes "Dict Dictation Dictation in aeroplane mode".
  - **Icons:** a separate session removed the unused `public/` and `static/` icon folders.
- **Round 3 (`c714607`):**
  - The README Project structure is a tree again.
  - Five screenshots, dark and light alternating: Capture, the traveller's knot, Calendar, Knots search, Manage backups. They show a CC0 Colosseum photo and made-up data.
- **After the rewrite:** the commit hashes in the docs were remapped.
- **Process:** Opus orchestrated. Sonnet agents A (code), B (docs) and F (`transcriptMerge`) wrote all code and most docs, and an independent Sonnet verifier checked the scrub.

## 2. Decisions
| Decision | Verdict | Why |
| --- | --- | --- |
| Search on the Knots list; Calendar shares the in-memory query and highlights days | kept (user, after a prototype) | One query, two views. |
| Separate search box on the Calendar | discarded (user) | Duplicates the Knots search. |
| Text search in Manage backups | discarded; filter box + chips kept (user) | The backup descriptions are already loaded, so no download is needed. |
| Chips multi-select: place chips OR, Checked off AND, All clears | kept (user, round 2) | Allows combinations such as Checked off + Backup only. |
| Chip label "Local" | replaced by "On device" (user, round 2) | Clearer. |
| 🔍 icon in the header gap, opening a row with the field focused | kept (user) | The ~70 px gap is too narrow for a text field. |
| README for visitors and self-hosters; detail in `docs/guide/` mirrored to the Wiki | kept (user) | `docs/` is the single source, so the Wiki can't drift. |
| Wiki edited separately by hand | discarded | It would drift. |
| Project structure: flat map | superseded by a tree with one `src/` level (user, round 3) | The user prefers the branching look. |
| Licence PolyForm Noncommercial 1.0.0 "for now" | kept (user) | Allows non-commercial forking and self-hosting; can be loosened later. |
| `DRIVE_BACKUP=off` for forks only | kept (user) | Supersedes "Drive backup is not optional" for forks only. |
| Five screenshots alternating dark/light, with the CC0 Colosseum traveller story | kept (user, round 3) | Shows distinct features; no personal data. |
| Char-prefix merge rule also across restarts (`foldSegment`) | discarded (Claude, review) | Would lose "Yes" in "Yes" + pause + "Yesterday I went"; losing text is worse than a repeat. |
| A "last word of acc" prefix rule | discarded (Claude) | "Buy a car" + "Carpet cleaning" would lose "car". |
| Rewrite the git history (noreply identity, personal strings) | kept (user, after Claude explained force-push) | The repo is public; the old commits carried a personal email. |
| A replace rule for the username in `github.io` URLs | discarded (Claude) | Would break the README live link, which the user approved. |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
| --- | --- | --- |
| `npm test` (compiles both configs, runs every chartest and proptest) | 19/19 test files (knotSearch 59, backupFilter 39, driveBackup 13, transcriptMerge 53) | No regressions; the new pure modules are pinned. |
| `node -e "new Function(…sw.js…)"` | exit 0 | `sw.js` is still a classic script. |
| ASSETS path check | 55 entries, all exist | Offline cold start loads every module. |
| Deploy injection simulated (strict without secrets / strict with secrets / `off` / `OFF`) | fail / inject / `off` / `off` | The opt-out works, and the owner's deploy stays strict. |
| Browser, 320×640, light and dark | pass | Search, focus, highlights, Calendar match states and jumps, shared query, chips on one line (end at x 292), Drive-off hides Cloud Backup, a stored token with Drive off reads as disconnected. |
| Dictate replay through the real `transcriptionService` with a fake SpeechRecognition | "Dictation in aeroplane mode" | The half-word repeat is fixed. |
| Screenshots (headless Edge over CDP) | 5 PNGs, chunks IHDR/IDAT/IEND only | No metadata; made-up data only. |
| Independent personal-data verifier | 1 finding (a project-id fragment), fixed | The working tree is clean apart from the approved live link. |
| `drift-check.ps1 .` | `0 dead / 0 refs` | No `docs/<component>` mapping tree to check (P3 KIV). |
| Real phone | not run | See §6. |

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
| --- | --- | --- | --- | --- |
| branch | `main` @ `c714607` | even with `origin/main`; uncommitted: the hash remap in `CLAUDE.md` and `docs/sessions/*.md`, the `CLAUDE.md` cleanup, this log | `git status -sb` | the user commits (`git add -A`) |
| deployment | GitHub Pages (site) and the GitHub Wiki | Wiki publishing works (the guide is live); the Pages deploy of `c714607` was not checked | the repo's Actions tab | none |
| Workers | `ehk-oauth`, `ehk-transcribe` (Cloudflare) | `oauth-worker` was redeployed from its folder; `ALLOWED_ORIGIN` secret status on both Workers is **unknown** | Cloudflare dashboard › Workers › each › Settings › Variables and Secrets | see §6 P0 |
| port | 127.0.0.1:8765 (scratchpad `serve.js`) | free; the server was stopped after each check | none | none |
| data | browser-pane IndexedDB at 127.0.0.1:8765 | deleted after each check | none | none |
| agents | Sonnet A (code), B (docs), F (`transcriptMerge`), the verifier | idle, finished | none | none |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
| --- | --- | --- | --- |
| none | — | `openspec list --json` → `changes: []`, `root: null` (no `openspec/`; P3 KIV) | — |

## 6. Open items
| Priority | Item | Doc/code reference | Next action | Done when |
| --- | --- | --- | --- | --- |
| P0 | Commit the hash remap, the `CLAUDE.md` cleanup and this log | `CLAUDE.md`, `docs/sessions/` | `git add -A`, commit, push | `git status` is clean and even with origin. |
| P0 | Worker `ALLOWED_ORIGIN` secrets | `oauth-worker/README.md`, `transcribe-worker/README.md` | In each Worker folder: `npx wrangler secret put ALLOWED_ORIGIN` (the site origin). Deploy first only if a plain var of that name exists. | Drive Connect works on the live site, and "Transcribe voice" works. |
| P0 | Phone checks | `CLAUDE.md` › Session status (2026-10-14) | Search on Knots and Calendar (keyboard, ‹ ›); the chips; Dictate in airplane mode ("Dictation in airplane mode", then a two-sentence phrase) | No repeats or drops; the chips behave. |
| P1 | Earlier phone and real-Google-account checks | `CLAUDE.md` › Session status (2026-10-09 and older) | Offline GPS and backfill, Calendar thumbnails, badges, Google Photos pick, two-device sync | All hold. |
| P2 | Coordinate format differs: "+41.89021, +12.49223" on the knot page vs "41.89021, 12.49223" elsewhere | `src/screens/knotDetailScreen.ts` `formatCoords` | The user decides whether to unify | Decided. |
| P2 | Unapproved Claude copy: the backup badges, the unsupported-format message | `knotsScreen.ts`, `knotDetailScreen.ts`, `mediaCapture.ts` | The user reviews the wording | Approved or changed. |
| P2 | Known limits: the legacy-transcript match has no highlight; Calendar ‹ › scrolls to the panel; the Dictate restart partial repeat; "Yes"/"Yesterday" within one instance | `CLAUDE.md` 2026-10-14 edge cases | Revisit only if seen in use | — |
| P3 | Daily email digest; supercharge scaffold (`docs/` tree, graph, OpenSpec) | design.md; plan `decisions-proceed-with-p2-recursive-dawn.md` Step 5 | KIV (user) | — |

## 7. Architecture / model changes
- **Dat:**
  - the in-memory search query (`searchState`, not persisted);
  - `BackupChipSelection`;
  - `window.__DRIVE_BACKUP__`, injected from the repo variable `DRIVE_BACKUP`.
- **Trn (pure):**
  - `normalizeForSearch`, `queryTokens`, `knotMatches`, `searchKnots`, `matchRanges`;
  - `filterBackups`, `backupMatchesChips`, `backupMainLine`;
  - `isDriveBackupEnabled`;
  - `charPrefix` (same-instance only in `mergeFinalPieces` / `appendSegment`).
- **Trn (effectful):**
  - `createSearchRow`;
  - `setHighlightedText`;
  - the `storedToken()` gate in `cloudSyncService`.
- **Trm:**
  - the `search:changed` eventBus event;
  - `wiki.yml` publishing `docs/guide/` to the Wiki repo.
- **Loc:** unchanged. The Workers' `ALLOWED_ORIGIN` moved from `wrangler.toml` vars to Worker secrets, which is configuration, not code.
- **Coherence:** search and the filter are read-only views over already-loaded data, with no new writes. `foldSegment` still never revises across instances, so no text is lost. With Drive off, a single gate makes every Drive path report disconnected.

## 8. Docs reconciled
| Doc | Change |
| --- | --- |
| `.kiro/specs/e-handkerchief/requirements.md` | New Req 20 (Search) and Req 21 (Drive opt-out); 6.2, 6.12, 7.5, 11.1, 11.9, 11.15, 12.18, 14.11 and the glossary amended. |
| `.kiro/specs/e-handkerchief/design.md` | KnotSearch, SearchState, SearchRow/SearchHighlight, BackupFilter, DriveBackup, TranscriptMerge (char-prefix), deploy-time injection, screens, Properties 20–22, precache (55) and test (19) lists, the file tree. |
| `.kiro/specs/searchable-timezone-selector/*` | Neutral examples (Paris). |
| `README.md`, `CONTRIBUTING.md`, `docs/guide/*` | New README with the tree and five screenshots; the guide is mirrored to the Wiki. |
| `CLAUDE.md` | 2026-10-14 decisions and edge cases (rounds 1–3), the session status, the commit-hash remap. |
| `docs/sessions/*.md` (older logs) | Recorded exceptions to immutability: the scrub of paths and timezone hints (round 1) and the commit-hash remap after the history rewrite; nothing else changed. |

## 9. Drift check
`drift-check.ps1 .` → `0 dead / 0 refs`. There's no `docs/<component>` tree, so nothing to fix. The graph refresh is skipped because there's no `graphify-out/` (P3 KIV).

## 10. Files changed
- **Code (committed):**
  - `src/{knotSearch,searchState,backupFilter,driveBackup}.ts` and their chartests;
  - `src/components/{searchRow,searchHighlight}.ts`;
  - `src/screens/{knotsScreen,calendarScreen,settingsScreen}.ts`;
  - `src/{app,cloudSyncService,eventBus,transcriptMerge,dateFormat,types,dayCutoff.chartest}.ts`;
  - `src/components/timezoneCombobox.ts`, `sw.ts`, `app.css`, `config.js`;
  - `.github/workflows/{deploy,wiki}.yml`;
  - `scripts/{run-tests,generate-icons}.js`, `package.json`.
- **Docs and repo (committed):**
  - `README.md`, `CONTRIBUTING.md`, `LICENSE`;
  - `docs/guide/*`, `docs/images/*`;
  - both Worker READMEs, `wrangler.toml` files and `.dev.vars.example` files;
  - the Kiro spec files.
- **Removed (committed):** `public/`, `static/`.
- **Uncommitted:** `CLAUDE.md`, `docs/sessions/*.md` (the hash remap), this log.
