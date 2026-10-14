# 2026-10-09 — offline-gps-thumbs-badges

This session ran from 2026-10-08 to 2026-10-09. It also covers the 2026-10-06 round (`88a2563`), which never got its own log: that round is recorded in `CLAUDE.md` › "2026-10-06".

## 0. Continuation brief
**Current state:** all of this session's work is committed and pushed by the user, and `main` is even with `origin/main` at `c93df63`. The commits are:
- **`cb2cb60`:** picked-media save failures (InvalidBlob) and the stuck edit screen; the offline GPS wait and the address backfill; Calendar thumbnails; centre-cropped thumbnails; "Not backed up" / "Backup deleted" badges; the Calendar month grid overflow.
- **`c93df63`:** the Calendar day list shows the time inline instead of the full date.

Everything was browser-checked at 320×640 in the in-app pane with stubs. Nothing has been checked on a real phone.

The decision and edge-case log is in `CLAUDE.md` › "2026-10-08" and "2026-10-09". The status is in "Session status (as of 2026-10-09)". The plan for the 10-09 round is `~/.claude/plans/1-offline-usage-although-noble-iverson.md`; it ends with the time-inline plan, which overwrote the earlier three-feature plan in the same file. The three-feature design survives in `CLAUDE.md` › "2026-10-09".

**Next step:** the user runs the phone checks in §6 P0 after the Pages deploy finishes.

**Resume command/check:** `git status -sb && git log --oneline -3`, then `CLAUDE.md` › "Session status (as of 2026-10-09)".

## 1. Work completed
- **Start:** preflight passed (graphify, semble, openspec, gbrain and git are all present). There's no `openspec/` and no graph (P3 KIV).
- **The user's 2026-10-06 phone results:** Library › Audio file, the single desktop audio filter, and fast Dictate are all OK. Library › Photo or video is unstable on mobile, which led to the next item.
- **InvalidBlob / stuck edit screen (10-08):**
  - `pickFile` reads the picked file fully at pick time and raises `FileReadError` if it can't.
  - The edit screen's Save Changes destroys the media panel only after a successful save. It has a "Saving…" guard and a toast on any failure.
  - The new pure `src/saveError.ts` turns a failed save into readable copy.
- **Offline GPS (10-09):**
  - `geoService.locate(deadlineMs)`; Capture uses 120 s when offline and 10 s online.
  - The new `src/addressBackfill.ts` (pure) and `src/addressBackfillService.ts` fill in a missing address once the device is online, only on the device that tied the knot. They run at app start and on `online`, not from Capture's save.
- **Calendar (10-09):**
  - `src/mediaSummary.ts`. Each day-list row shows one right-aligned 40 px tile per media type, with a count.
  - `generateThumbnail` centre-crops.
  - The month grid fits 320 px.
  - Rows show `formatKnotTime(...) · text` instead of the full date.
- **Backup badges (10-09):**
  - `src/backupStatus.ts` (pure) and `SyncStateRecord.backupDeletedAt`, plus the `backup:changed` event, `getBackupStatuses()` and `uploadingIds`.
  - Badges on the Knots list and the knot page.
- **`sw.ts` ASSETS:** 49 entries.
- **Docs:** the Kiro spec, README and `CLAUDE.md` were updated each round.
- **Process:** Opus orchestrated, and Sonnet agents wrote all code and docs. Three of them ran in parallel on the 10-09 round. A rate limit stopped all three before their first edit; they were resumed with no loss.

## 2. Decisions
| Decision | Verdict | Why |
| --- | --- | --- |
| Read picked files into memory at pick time | kept (Claude, plan shown) | Android picker and cloud files are lazy, so IndexedDB failed at save with InvalidBlob. |
| Pick-time copy "Couldn't read that file — it may still be downloading…" | kept (user, Option A) | — |
| Save-failure copy "<prefix> — a photo, video or audio file couldn't be saved. Remove it and pick it again." | kept (user, Option A) | Any other error keeps "<prefix>: <detail>". |
| Edit save: destroy the media panel after the save, with a Saving guard | kept (Claude) | Root cause of the vanishing buttons and the dead Save. |
| Offline: wait up to 2 min for a fresh fix | kept (user) | Coordinates need no internet; a cold GPS fix takes longer than 10 s. |
| Offline: accept a cached last-known position | discarded (user) | Could record the wrong place. |
| Fill in the address later, on the creating device only | kept (user + Claude) | Avoids two devices editing the same knot and triggering a conflict review. |
| Start the backfill straight from Capture's save | discarded (Claude, review fix) | It would race the save's own upload (a duplicate Drive file, or `setBase` landing out of order). |
| Calendar: one thumbnail per type, with a count | kept (user) | — |
| Calendar photo tiles from the full blob | kept (Claude) | The stored 80×80 thumbnails were stretched. |
| Badges on the Knots list and knot page | kept (user) | Manage backups lists Drive files only. |
| Rows for local-only knots in Manage backups | discarded (user) | Not chosen. |
| Badge rule order: disconnected › uploading › conflict › deleted › base equal › not backed up | kept (Claude, plan approved) | Pure function with a 20-check chartest. |
| Calendar grid: `minmax(0, 1fr)` plus `.calendar-day { min-width: 0; width: 100% }` | kept (Claude) | A grid item with `aspect-ratio` isn't stretched, so it stayed 44 px wide. |
| Calendar rows: time inline ("03:36 · text") | kept (user, after a prototype) | Saves a line per knot. |
| Calendar rows: time on its own line, or no time | discarded (user) | — |

## 3. Tests, checks, benchmarks
| Check | Result | What it proved |
| --- | --- | --- |
| `npx tsc -p tsconfig.json` / `-p tsconfig.sw.json` | exit 0 / exit 0 | Types are OK. |
| `node -e "new Function(…sw.js…)"` | exit 0 | `sw.js` is still a classic script. |
| 15 chartests (new: saveError 20, addressBackfill 15, mediaSummary 17, backupStatus 20) + timezone proptest | all pass | No regressions, and the new pure modules are pinned. |
| ASSETS path check | 49 entries, 0 missing | The offline cold start can load every module. |
| Browser 320×640: unreadable pick / IDB `put` throwing InvalidBlob (Capture + Edit) | pass | Pick-time message; media-write toast; form and media panel kept; Saving guard; retry saves. |
| Browser: GPS stubs | pass | Offline gives the copy and a 120 s timeout, and coordinates after the fix; online keeps 10 s; an offline retry uses 120 s. |
| Browser: backfill with Nominatim stubbed | pass | Queued offline, filled on `online`, `updatedAt` bumped, pending list emptied. |
| Browser: Calendar thumbnails (dark + light) | pass | Photo "3", video ▶, audio ▶ "2", right-aligned; text-only rows have none. |
| Browser: badges (Drive stubbed as connected) | pass | All rule cases, a live update, the page pill hidden in Edit, none when disconnected. |
| Browser: month grid | pass | Width 320 (was 336); cells 39.4×44 with no overlap; square at 768 px (79.4×79.4). |
| Browser: time inline | pass | "7:37 AM · …" in 12h; a checked-off row's text is struck through but not its time. |
| `drift-check.ps1 .` | `0 dead / 0 refs` | No dead doc references (there's no IMPLEMENTATION.md tree to check). |
| Real phone | not run | See §6. |

## 4. Live handoff state
| Type | Handle / location | State | Inspect / resume | Stop / cleanup |
| --- | --- | --- | --- | --- |
| branch | `main` @ `c93df63` | clean except this log and the `CLAUDE.md` status line; even with `origin/main` | `git status -sb` | the user commits |
| deployment | GitHub Pages `<owner>.github.io/e-handkerchief` | unknown (a push triggers deploy.yml) | check the Actions run for `c93df63`, then fetch `sw.js` and read `BUILD_VERSION` | none |
| port | 127.0.0.1:8765 (scratchpad `serve.js`) | free; the server was stopped after each check | none | none |
| data | browser-pane IndexedDB `e-handkerchief-db` @127.0.0.1:8765 | deleted after each check | none | none |
| agents | three Sonnet subagents (GPS/backfill, Calendar, badges) | idle, finished | none | none |

## 5. In-flight changes (from OpenSpec)
| Change | Tasks | Status | Next ready artifact |
| --- | --- | --- | --- |
| none | — | `openspec list --json` → `changes: []`, `no_openspec_root` (P3 KIV) | — |

## 6. Open items
| Priority | Item | Doc/code reference | Next action | Done when |
| --- | --- | --- | --- | --- |
| P0 | Phone: picked media and edit save | `src/mediaService.ts` `pickFile`; `src/screens/knotDetailScreen.ts` | Library › Photo or video with a Google Photos item that isn't on the phone yet; edit a knot, add a photo, save. | It attaches and saves, or the pick-time message shows straight away; never InvalidBlob; the edit screen never locks. |
| P0 | Phone: offline GPS and backfill | `src/geoService.ts`, `src/addressBackfillService.ts` | Airplane mode with Location on → Capture → wait → save; go online and reopen the app. | Coordinates within about 2 min; the address appears afterwards. |
| P0 | Phone: Calendar | `src/screens/calendarScreen.ts`, `app.css` | Open a day with real photos and videos. | Thumbnails look right; the grid doesn't scroll sideways; scrolling is smooth with many large photos. |
| P0 | Phone: badges with Drive | `src/backupStatus.ts`, `src/cloudSyncService.ts` | Tie a knot offline; then delete a backup in Manage backups. | "☁ Not backed up" until it uploads; "☁ Backup deleted" on that knot. |
| P1 | Badge copy (Claude-proposed, in the approved plan) | `knotsScreen.ts`, `knotDetailScreen.ts` | The user reviews the wording. | Approved or changed. |
| P1 | Earlier real-Google-account, multi-device checks | `CLAUDE.md` › Session status (2026-10-03 onwards) | Run them with two devices. | All hold; the `appProperties` per-key merge confirmed. |
| P2 | Known limits (Dictate merge; backfill vs an open Edit; old stretched video thumbnails) | `CLAUDE.md` edge cases 10-06 / 10-09 | Revisit only if seen in use. | — |
| P2 | Unsupported-format copy (Claude-invented) | `src/components/mediaCapture.ts` `handleMediaError` | The user reviews it (keep for now). | Decided. |
| P2 | Daily email digest | design.md | KIV (user). | — |
| P3 | Supercharge scaffold (`docs/` tree, graph, OpenSpec) | plan `decisions-proceed-with-p2-recursive-dawn.md` Step 5 | KIV (user). | — |

## 7. Architecture / model changes
- **Dat:**
  - `AppSettings.pendingAddressKnotIds` (local only);
  - `SyncStateRecord.backupDeletedAt`.
  - No IDB version change.
- **Trn (pure):**
  - `saveErrorMessage` / `isMediaWriteError`;
  - `needsAddress` / `addPending` / `removePending`;
  - `summarizeMedia` / `describeMediaSummary`;
  - `backupStatus`;
  - `formatKnotTime`.
- **Trn (effectful):**
  - `fillPendingAddresses`;
  - `getBackupStatuses`;
  - `pickFile` now reads bytes;
  - `generateThumbnail` crops.
- **Trm:**
  - the new `backup:changed` eventBus event;
  - Nominatim calls from the backfill (at least 1.1 s apart).
- **Loc:** unchanged (page, SW, IndexedDB, Drive, Nominatim).
- **Coherence:** the backfill writes only on the device that tied the knot, so it can't cause a two-device content conflict. The badge rule reads existing sync bookkeeping and never writes to Drive.

## 8. Docs reconciled
| Doc | Change |
| --- | --- |
| `.kiro/specs/e-handkerchief/requirements.md` | 3.8, 5.6, 13.12 (10-08); 1.3/1.5 amended, 1.10, 1.11, 3.5 amended, 6.11, 11.14, 13.13 (incl. time inline), 13.14 (10-09). |
| `.kiro/specs/e-handkerchief/design.md` | MediaService, SaveError, error table (and the stale geolocation row), GeoService, AddressBackfill, MediaSummary, BackupStatus, CloudSyncService, CalendarScreen, `formatKnotTime`, Properties 16–19, precache and test lists, src tree. |
| `README.md` | Tests and src tree; the offline location paragraph; Calendar thumbnails; the "not in Drive" badges; the pick and save messages. |
| `CLAUDE.md` | 2026-10-08 and 2026-10-09 decisions, edge cases and session status; the 10-09 status now names `cb2cb60` / `c93df63` as committed and pushed. |

## 9. Drift check
`drift-check.ps1 .` → `0 dead / 0 refs`. There's no `docs/<component>` tree, so nothing to fix. The graph refresh is skipped: there's no `graphify-out/` (P3 KIV).

## 10. Files changed
- **Code (committed):**
  - `src/{mediaService,geoService,cloudSyncService,eventBus,types,dateFormat,app}.ts`
  - `src/components/mediaCapture.ts`
  - `src/screens/{captureScreen,knotDetailScreen,knotsScreen,calendarScreen}.ts`
  - `sw.ts`, `app.css`
- **New (committed):** `src/{saveError,addressBackfill,addressBackfillService,mediaSummary,backupStatus}.ts` and their chartests (except the service).
- **Docs (committed):** requirements.md, design.md, README.md, CLAUDE.md.
- **Uncommitted:** this log, and the `CLAUDE.md` 10-09 status line.
