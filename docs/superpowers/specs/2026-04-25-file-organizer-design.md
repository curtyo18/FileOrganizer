# FileOrganizer — Design

**Date:** 2026-04-25
**Status:** Approved (brainstorm); pending implementation plan
**Owner:** Curt

## 1. Goal

A local tool that helps the user organize their personal files across multiple drives (including a NAS) before transitioning to a new computer. It must:

- Index personal content across 3–5 drives, ~2–10 TB total, including one NAS.
- Detect strict (byte-identical) duplicates across all drives.
- Organize photos and videos by year/month using EXIF dates where available.
- Apply a hybrid recent/archive scheme to documents, spreadsheets, presentations, audio, and ebooks.
- Catalog code without auto-organizing it.
- Move files according to user-defined rules, with cross-drive moves always gated by user review.
- Quarantine (not hard-delete) files removed by the tool, with a fully reversible operation log.
- Throttle scan and apply intensity so it can run during workday use or at full capacity overnight.

## 2. Non-Goals (v1)

The following are deliberately out of scope for v1 and deferred to later versions:

1. Backup, mirror, or sync features. The NAS is treated as another storage destination; sync is handled by other tools.
2. Perceptual / near-duplicate detection for images and video. Strict byte-identical only.
3. Filename-based date inference. Date sources are EXIF/metadata and filesystem mtime only.
4. Camera/device sub-bucketing for photos.
5. Multi-machine / multi-client support. Single machine in v1; the NAS is just a network drive.
6. Cloud storage integrations (Google Drive, Dropbox, OneDrive). Local + NAS only.
7. Auto-tagging or content-based search ("photos of dogs").
8. Mobile or remote UI access. Local web UI bound to `127.0.0.1`.
9. Scheduled scans. Scans are user-initiated; throttle profiles handle time-of-day during a running scan.
10. Automatic purge of quarantine. Quarantine is emptied on user command only.

## 3. High-Level Architecture

Three layers, all running locally on the user's machine:

1. **Engine** — headless Node 22 + TypeScript service. Owns all filesystem access, the catalog, scanning, organizing, and dedup. Exposes a local HTTP+WebSocket API.
2. **Catalog** — single SQLite database file at a user-chosen location, containing every persisted piece of state.
3. **UI** — TypeScript + Preact static frontend served by the engine on `127.0.0.1:<port>` and opened in the user's default browser.

Data flow:

```
UI ──HTTP/WS──▶ Engine API ──▶ Engine workers ──▶ Filesystem (read/write)
                    │                  │
                    ▼                  ▼
                SQLite catalog ◀───────┘
```

CLI entry point: `fileorganizer <command>` (`scan`, `serve`, `status`, `undo <batch-id>`, `move-catalog`, etc.). `fileorganizer serve` is the everyday mode; it starts the engine and opens the UI.

### 3.1 Stack

- **Runtime:** Node 22 LTS.
- **Language:** TypeScript end-to-end. Engine, UI, and a `shared/` package containing all cross-boundary types.
- **TS execution (dev):** `tsx`. Build with `tsc` or `esbuild`.
- **HTTP+WS:** `Hono`.
- **Catalog:** `better-sqlite3` (synchronous, very fast).
- **Hashing:** `node:crypto` (`createHash('sha256')`).
- **Concurrency:** `node:worker_threads` for parallel hashing.
- **Image EXIF:** `exifr`.
- **Video metadata:** subprocess to bundled `mediainfo.exe` (with `ffprobe.exe` as a backup).
- **Thumbnails:** `sharp`.
- **UI framework:** Preact. Build with `vite`.
- **Tests:** `vitest`.
- **Distribution:** repo-based for v1. `git clone`, `npm install`, `npm run fetch-binaries`, `npm run build`, `npm run start`. Single-binary packaging deferred until Node SEA matures.

### 3.2 Process model

- One Node process runs the engine, its API server, and all worker threads.
- The UI is static files served by the engine; it runs in the user's browser.
- Long-running work (scans, applies) happens on worker threads; the API stays responsive.
- A small pointer file at `%APPDATA%\FileOrganizer\catalog-location.txt` records the catalog location and the engine's current port. Aside from that file, nothing about the tool lives on the system drive.

## 4. Catalog (SQLite Schema)

The catalog is the single source of truth. One SQLite file, on a user-chosen drive (selected via a first-run wizard), movable later via `fileorganizer move-catalog`.

### 4.1 Tables

**`drives`** — every drive the tool has ever seen. Identified by Windows volume serial, not drive letter.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Internal stable ID |
| volume_serial | TEXT | Windows volume serial number |
| label | TEXT | Human label |
| current_letter | TEXT | Last known drive letter, refreshed on connect |
| kind | TEXT | `local`, `external`, `network` |
| roles | JSON | e.g., `["media-archive", "backup"]` |
| total_bytes | INT | |
| free_bytes | INT | |
| last_seen_at | DATETIME | |

`connected` is a runtime computation, not persisted.

**`scans`** — record of every scan run.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| drive_id | TEXT FK | |
| started_at | DATETIME | |
| finished_at | DATETIME | |
| status | TEXT | `running`, `paused`, `completed`, `failed` |
| root_paths | JSON | What was scanned |
| throttle_profile | TEXT | Profile name in use |
| progress | JSON | Resume checkpoint |
| stats | JSON | Files scanned, indexed, skipped, errors |

**`files`** — the file index. Largest table.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| drive_id | TEXT FK | |
| path | TEXT | Drive-relative, no letter (e.g. `\foo\bar.jpg`) |
| name | TEXT | |
| extension | TEXT | |
| size_bytes | INT | |
| category | TEXT | `image`, `video`, `audio`, `document`, etc. |
| sha256 | TEXT | Indexed, dedup key |
| mtime | DATETIME | |
| ctime | DATETIME | |
| exif_date | DATETIME | Nullable; populated for images/videos when present |
| date_source | TEXT | `exif`, `mtime`, `none` |
| width | INT | Nullable |
| height | INT | Nullable |
| duration_seconds | REAL | Nullable |
| ntfs_file_id | TEXT | NTFS file reference number, for hardlink detection |
| state | TEXT | `indexed`, `quarantined`, `moved`, `deleted-from-source`, `missing` |
| last_verified_at | DATETIME | |
| scan_id | TEXT FK | |

**Indexes:** `(sha256)`, unique `(drive_id, path)`, `(category, exif_date)`, `(state)`.

**`rules`** — user-defined organizing rules. Schema in §6.1.

**`batches`** — operation grouping for undo and audit.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| kind | TEXT | `scan`, `move`, `dedupe`, `quarantine-empty`, `restore`, `undo` |
| started_at | DATETIME | |
| finished_at | DATETIME | |
| status | TEXT | |
| description | TEXT | |
| summary | JSON | Counts, total bytes, drives involved |

**`operations`** — individual file actions.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| batch_id | TEXT FK | |
| kind | TEXT | `move`, `copy`, `quarantine`, `restore`, `delete` |
| file_id | INT FK | |
| source_drive_id | TEXT | |
| source_path | TEXT | |
| dest_drive_id | TEXT | |
| dest_path | TEXT | |
| pre_hash | TEXT | sha256 before |
| post_hash | TEXT | sha256 after |
| quarantine_path | TEXT | Full path inside quarantine if applicable |
| status | TEXT | `pending`, `in-progress`, `completed`, `failed`, `reverted`, `dry-run` |
| error_message | TEXT | Nullable |

**`quarantine`** — metadata for quarantined files.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| drive_id | TEXT FK | |
| original_path | TEXT | |
| original_size | INT | |
| original_sha256 | TEXT | |
| original_mtime | DATETIME | |
| quarantine_path | TEXT | |
| quarantined_at | DATETIME | |
| batch_id | TEXT FK | |

**`settings`** — single-row key/value JSON. Holds: throttle profile definitions, throttle schedule, category map, role definitions, role-to-drive priority order, recent/archive cutoff, UI preferences. Stored in the DB so it travels with the catalog.

**`schema_version`** — single-row table gating startup migrations.

### 4.2 Migrations

Append-only numbered SQL files. On engine startup, the engine inspects `schema_version` and runs any pending migrations in order before opening the API server.

## 5. Scanning Pipeline

A scan is the engine's longest-running operation. The pipeline is **resumable**, **throttleable**, and **non-destructive** — a scan never modifies any file.

### 5.1 Stages

1. **Pre-flight.** Resolve the target drive: confirm volume serial matches the `drives` row; refresh `current_letter`. Refuse to scan if volume serial doesn't match. Capture capacity. Open `scans` row with `status='running'`.
2. **Walk.** Single-threaded directory walker. Emits file paths into a bounded "to-hash" queue. Filters in order: path exclusions → category filter → size sanity (>50 GB flagged but not skipped).
3. **Quick-check.** For each candidate, look up `(drive_id, path)`; if size + mtime match the existing row, skip hashing and bump `last_verified_at` and `scan_id`. This is what makes incremental rescans cheap.
4. **Hash + metadata extraction.** Worker threads stream the file with throttle-controlled chunk size, compute sha256, then run category-specific metadata extraction (`exifr` for images, `mediainfo` subprocess for video).
5. **DB writer (single thread).** Drains a "to-write" queue and `INSERT OR REPLACE`s into `files`. Single-writer keeps SQLite happy. Commits in batches (default 500 rows or 1 second).
6. **Checkpointing.** Every 1000 files, persist `progress` JSON in the `scans` row.
7. **Post-scan.** Files in the catalog for this drive but not seen in this scan are marked `state='missing'`, never deleted from the catalog. Update drive capacity. Mark `scans` row completed.

### 5.2 Path exclusions

Always skipped, on every drive:

- `Windows`, `Program Files`, `Program Files (x86)`, `ProgramData`, `$Recycle.Bin`, `System Volume Information`
- Hidden directories starting with `.` (e.g., `.git`, `.venv`)
- Build/dependency directories: `node_modules`, `__pycache__`, `dist`, `build`, `target`, `vendor`
- The tool's own quarantine folder (`_FileOrganizer_quarantine`)
- Per-drive user-configured exclusions

### 5.3 Category map

The category map lives in `settings` and is iterable via the UI or config. Initial map:

| Category | Extensions |
|---|---|
| Images | jpg, jpeg, png, gif, bmp, tiff, heic, webp, raw, cr2, nef, arw, dng |
| Video | mp4, mov, avi, mkv, wmv, flv, webm, m4v, mpg, mpeg |
| Audio | mp3, wav, flac, m4a, aac, ogg, wma |
| Documents | pdf, doc, docx, odt, rtf, txt, md |
| Spreadsheets | xls, xlsx, ods, csv |
| Presentations | ppt, pptx, odp, key |
| Archives | zip, rar, 7z, tar, gz |
| Ebooks | epub, mobi, azw, azw3 |
| Code | py, js, ts, tsx, jsx, go, rs, java, c, cpp, h, hpp, ipynb, sh, rb, php, swift, kt |

Files outside the active category map are skipped entirely — no hash, no catalog row. Archives are opaque (contents not inspected). Creative source files (.psd, .ai, .prproj, etc.) are deliberately not included.

### 5.4 Date resolution

For media files, the resolved date used by rules is determined by:

1. **EXIF / metadata.** Images: `DateTimeOriginal`, then `DateTimeDigitized`, then XMP `CreateDate`. Videos: MP4/MOV `creation_time` atom, MKV segment date, MediaInfo fallback.
2. **Filesystem mtime.** If no EXIF/metadata date exists.
3. **None.** Recorded as `date_source='none'`. These files route to an `_undated` bucket when archived.

Filename pattern parsing is explicitly not supported.

**Suspicious dates** (EXIF in the future, EXIF before 1990, or EXIF disagreeing with mtime by more than a year) are flagged for review rather than silently used.

### 5.5 Throttle profiles

Three profiles, hot-swappable mid-scan:

| Setting | `idle` | `balanced` | `full-send` |
|---|---|---|---|
| Local hash workers | 1 | half cores | all cores |
| NAS hash workers | 1 | 1 | 2 |
| Read chunk size | 256 KB | 1 MB | 4 MB |
| Inter-chunk sleep (ms) | 5 | 1 | 0 |
| Process priority | below normal | normal | normal |
| Max open files | 4 | 16 | 64 |

NAS workers are capped low even on `full-send` because the bottleneck is network bandwidth and concurrent reads thrash mechanical disks.

**Schedule-driven auto-switching.** A 60-second cron checks the configured weekly schedule; crossing a window boundary switches the profile and emits a UI event. Manual override during a scan persists until the scan ends.

**Pause/resume.** Pause flips a flag; in-flight files finish, workers idle, DB writer commits. Scan state is fully checkpointed.

### 5.6 Error handling

- **File-level errors** (permission denied, file vanished, corrupt EXIF): logged, file skipped, scan continues.
- **Drive-level errors** (NAS unreachable): scan paused with `status='paused'`, UI notification. Resume on reconnect.
- **Catastrophic errors** (DB locked, no disk space on catalog drive): scan halted with `status='failed'`, clear error message.

## 6. Rules Engine & Organizing

### 6.1 Rule shape

Rules live in the `rules` table:

```ts
type Rule = {
  id: string;
  name: string;
  priority: number;        // lower runs first
  enabled: boolean;
  match: {
    category?: Category[];
    date_before?: string;          // ISO date
    date_after?: string;
    date_source_min?: 'exif' | 'mtime' | 'any';
    min_size_bytes?: number | null;
    max_size_bytes?: number | null;
    path_glob?: string | null;
    source_drives?: string[] | null;
    source_roles?: string[] | null;
  };
  destination_role: string;
  destination_template: string;    // e.g., "Photos/{year}/{month:02}/{filename}"
  move_policy: 'same-drive-auto' | 'cross-drive-review' | 'always-review';
  quarantine_policy: 'default' | 'skip-quarantine';
};
```

Rules are evaluated in `priority` order, first-match-wins. A file matches at most one rule per planning run.

### 6.2 Destination template placeholders

- `{year}`, `{month}`, `{month:02}`, `{day}`, `{day:02}` from resolved date
- `{filename}` original filename including extension
- `{stem}` / `{ext}` split form
- `{category}`
- `{drive_label}`

The `destination_role` is resolved at apply time to a concrete drive via the role definitions in `settings`, then template-rendered into a path under that drive's role mount root.

### 6.3 Plan / Apply split

**Plan** is a pure function over current catalog state. Output: a flat list of `PlannedOperation` objects, one per matched file. Each records source file, matching rule, resolved destination drive + path, kind (`same-drive-move` / `cross-drive-move` / `noop`), estimated bytes. Files matching no rule appear in an "Unsorted" view, not the plan.

Plan is cheap to recompute (SQL query + path templating). Users iterate on rules with the planner running live.

**Apply** splits planner output into approval buckets:

- **Auto-apply**: `same-drive-move` operations under rules with `move_policy='same-drive-auto'`. Atomic rename; logged but executed without review.
- **Review-required**: every `cross-drive-move`, plus everything from `move_policy='always-review'`. Lands in the review queue for batch approval.

When a batch is approved:

1. **Same-drive move:** OS rename. Update `files.path` in catalog.
2. **Cross-drive move:**
    1. Pre-flight: free space check at destination with 5% safety margin. Abort batch up front if insufficient.
    2. Create destination directory tree.
    3. Stream-copy source → destination with progress events.
    4. Re-hash destination, compare to source's recorded sha256. Mismatch → abort op, mark `failed`, leave both files in place.
    5. Source → quarantine (atomic rename to `\_FileOrganizer_quarantine\<batch-id>\<original-relative-path>`). Record metadata.
    6. Update `files` row.
    7. Mark op `completed`.

Throttle profile applies during apply (controls copy speed).

### 6.4 Filename collisions

If the rendered destination path is occupied:

- **Same hash:** destination already correct. Source goes to quarantine; op marked `completed-via-existing`.
- **Different hash:** suffix the source's filename `_1`, `_2`, etc. until unique.
- **Never overwrite.**

### 6.5 Undo

`fileorganizer undo <batch-id>` walks `operations` in reverse:

- For each `completed` op, re-verify the destination file's hash matches `post_hash`. Mismatch → refuse to undo that op, record in undo report, continue with the rest.
- Same-drive moves: rename back. Cross-drive moves: restore from quarantine.

An undo creates a new batch with `kind='undo'` referencing the original — fully auditable, and undoes can themselves be undone.

### 6.6 Unsorted bucket

Anything in the catalog matching no rule shows up in an Unsorted view. From there: write a new rule prefilled from the active filter, or run a manual one-off batch (same review/quarantine semantics as a rule-driven batch).

### 6.7 Rule shadowing

Because rules are first-match-wins, a rule may silently never fire. The UI surfaces, per rule, "would match N files / actually matches M files in current plan" so shadowing is visible.

### 6.8 Dry-run

Every apply can be `--dry-run`. Engine performs every check (free-space, simulated directory creation, source re-hash) without making any change. Operation rows are written with `status='dry-run'`.

### 6.9 Default organizing strategy

Default rules created on first run:

- **Photos:** `images` → role `media-archive`, template `Photos/{year}/{month:02}/{filename}`, EXIF-or-mtime date.
- **Video:** `video` → role `media-archive`, template `Videos/{year}/{month:02}/{filename}`.
- **Documents (recent):** `documents`/`spreadsheets`/`presentations`/`ebooks` modified within the last 2 years → role `active-documents`, template `Documents/{category}/{filename}`.
- **Documents (archive):** same categories modified before the cutoff → role `document-archive`, template `Documents/_archive/{year}/{category}/{filename}`.
- **Audio:** same hybrid recent/archive treatment.
- **Code:** catalogued only — no rules, no auto-organizing.
- **Archives:** catalogued only — no rules.

The 2-year recent/archive cutoff is a global default with per-rule overrides.

## 7. Drive Roles

Drives carry a *set* of roles, not a single role. A NAS can be `[backup, media-archive, document-archive]`; an SSD can be `[active-documents, active-projects]`.

Roles are defined in `settings`. Each role has a `priority` ordering across the drives that carry it: a `[primary, overflow1, overflow2, ...]` list. When a rule resolves to a role, the engine picks the first connected drive in the priority list that has free space above the configured threshold (default: stop using a drive once it's >90% full). Otherwise, fall through to the next overflow drive.

If no drive in the role's priority list is connected, rules targeting that role are paused with a clear "role not available" status.

The `backup` role is informational in v1 — it does not trigger any automatic mirroring. It exists so the role taxonomy is ready for v2.

## 8. Deduplication

Strict (byte-identical) only. Detection is a single SQL query grouping `files` by `sha256`.

### 8.1 Keeper-scoring

For each duplicate group, the engine proposes one canonical keeper. Tiebreakers in order:

1. **Drive role priority** — copy on a drive carrying the file's rule-resolved role wins.
2. **Most-organized location** — copy whose path matches some rule's destination template wins.
3. **Path depth** — deeper, more structured path wins (`E:\Photos\2023\08\IMG_1234.jpg` > `E:\IMG_1234.jpg`).
4. **Drive kind** — local SSD > local HDD > NAS > external.
5. **Filesystem mtime** — older mtime wins.
6. **Lexicographic path order** — stable tiebreaker.

The score is recorded with the proposal so the UI can show *why* this one was picked. Per-group user override is remembered for that hash.

### 8.2 No auto-resolve in v1

Even on byte-identical duplicates, dedup batches require user review. Bulk operations are available ("approve all groups under 100 KB", "exclude all groups touching the NAS"), but the user is always in the loop.

### 8.3 Apply

Dedup operations move non-keeper copies to quarantine. The keeper is left in place. Cross-drive dedup is *not* a move — it's quarantine-only on the redundant side, no copy step, no cross-drive bytes flowing.

Right before quarantining a non-keeper, the engine re-hashes both the keeper and the non-keeper. Both must match the recorded hash. If either has changed since the catalog was last updated, the op is aborted (file may have been edited since the scan).

### 8.4 Hardlinks and same-physical-file detection

Two paths sharing an NTFS file ID on the same drive are the same physical bytes. These are flagged `same-physical-file` and excluded from dedup proposals (no space to reclaim).

### 8.5 Empty and tiny files

Zero-byte files share a single sha256 and would form a giant duplicate group. They are surfaced in a separate "Empty files" view, not the duplicates view. A configurable minimum-size threshold (default 4 KB) excludes very small files from duplicate groups; off by default.

## 9. Quarantine

Each drive has a tool-managed `\_FileOrganizer_quarantine\` folder at the root. Files are moved here with full original-path metadata recorded in the `quarantine` table.

- **No auto-purge.** Files stay until the user explicitly empties.
- **Restore** is a first-class operation. Picks files in the UI → engine puts them back at original paths. Works even if the surrounding directory structure has changed since.
- **Per-batch override.** At approval time, a batch can be marked `skip-quarantine` (bypass the quarantine step, hard-delete instead). The override is recorded on the batch for audit.
- **Quarantine never crosses drives.** Quarantining is always a same-drive rename — instant, free, important for the NAS.

The Quarantine UI shows per-drive size, batch list, and a "purge older than X days" tool with count + size preview before confirming.

## 10. UI

Local web UI, served by the engine on `127.0.0.1:<port>`, opened in the user's default browser. TypeScript + Preact + Vite. Virtualized lists for any view that can show thousands of rows.

### 10.1 Sections

1. **Dashboard.** Drive cards (label, letter, kind, status, fill bar, roles, last scanned). Actionable cards: duplicates reclaimable, unsorted files, pending cross-drive batches, quarantine size, drives not scanned recently. Live activity strip for running scans/applies.
2. **Drives.** Manage drives: label, roles, role priority for this drive, throttle defaults, exclusions. Global throttle profile editor and weekly schedule editor live here.
3. **Scans.** Start/pause/resume scans, monitor progress, scan history.
4. **Browse.** Catalog explorer. Drive + folder tree, filter bar (category, date, size, hash, text), virtualized list/grid. Selection actions: create rule, move to..., show duplicates, open containing folder.
5. **Organize.** Three sub-views: Rules editor (drag-reorder, live "matches N" badges, shadow detection), Plan/Review queue (planner output, approve/dry-run), Unsorted (no-rule files; "create rule from filter").
6. **Duplicates.** Groups list sorted by reclaimable bytes. Per-group: copies with thumbnails, score breakdown, change-keeper, include/exclude. Bulk operations across groups. Persistent review-batch pane.
7. **History.** Filterable batches table. Drill into a batch for ops detail. Undo button per batch.
8. **Quarantine.** Per-drive view. Restore-all, purge, per-file controls, "purge older than" tool with preview.

### 10.2 Cross-cutting

- Notifications (top-right toasts) for completed scans, failed ops, drive disconnects, throttle auto-switches.
- Keyboard shortcuts: `g d` dashboard, `g b` browse, `/` focus search, `j`/`k` list nav, `space` toggle selection.
- Dark mode default; light theme toggle.
- Empty states with first-run guidance on every section.

### 10.3 Out of scope for v1 UI

- Mobile-responsive design (desktop browser only).
- Real-time collaborative anything.
- Theming beyond dark/light.
- EXIF editor (read only, never write).

## 11. API (Engine ↔ UI)

REST + WebSocket on the same `127.0.0.1:<port>` Hono server.

- **REST** for request/response: rule CRUD, drive CRUD, scan control, plan, approve batch, undo, list duplicates, restore from quarantine, etc.
- **WebSocket** for live events: scan progress, apply progress, throttle profile changes, drive connect/disconnect, batch status transitions.

Endpoints are hand-written in TS; request/response types live in `shared/`. No OpenAPI generation, no tRPC, no GraphQL. Loopback-only binding. Random unprivileged port chosen at startup; UI reads it from the pointer file. No auth — only access path is loopback on the user's own machine.

## 12. Cross-Cutting Concerns

### 12.1 Project layout

```
fileorganizer/
  packages/
    shared/          # Types, constants
    engine/
      src/
        catalog/     # SQLite access, schema migrations
        scan/        # Walker, hasher, metadata extractors
        rules/       # Match evaluation, destination resolution
        organize/    # Plan, apply, undo
        dedupe/      # Group detection, scoring
        quarantine/  # Move-to-quarantine, restore, purge
        api/         # Hono HTTP+WS server
        drives/      # Volume detection, mount tracking
        throttle/    # Profile management, scheduler
        thumbnails/  # On-demand generation, cache
        cli/         # `fileorganizer <cmd>` entry points
      bin/
        mediainfo.exe   # gitignored, fetched on install
        ffprobe.exe     # gitignored, fetched on install
    ui/
      src/
        routes/      # Dashboard, Drives, Scans, Browse, Organize, Duplicates, History, Quarantine
        components/
        api/         # Engine API client (HTTP + WS)
  scripts/
    fetch-binaries.ts   # downloads mediainfo/ffprobe
    init-catalog.ts     # interactive first-run wizard
  docs/
    superpowers/
      specs/
      plans/
```

Monorepo via npm workspaces. `shared/` is the dependency contract between engine and UI.

### 12.2 Testing

1. **Unit tests** (`vitest`) on pure functions: rule matching, destination template rendering, keeper-scoring, plan generation.
2. **Integration tests** against a temp directory + temp SQLite catalog. End-to-end: scan a known tree, verify catalog, run planned move, verify filesystem, undo, verify restored.
3. **Smoke tests** for CLI and API: spin up engine in a child process, hit API, assert responses.

UI tests limited to component-level interaction tests for the rule builder and dedup view; the rest is glue around the API.

A test fixtures script generates synthetic photos with embedded EXIF and known duplicates (not committed as binaries).

### 12.3 Error handling and recovery

Operating principle: **no operation may leave the system in a state that requires manual SQL surgery to recover.**

- **DB transactions** wrap each batch's operations. Filesystem op happens outside the transaction; ordering is filesystem op → catalog update → commit.
- **Reconciliation on startup.** Engine checks for `operations` rows with `status='in-progress'` and reconciles filesystem state vs claimed state. Fix up the catalog, or mark the op `failed`.
- **Filesystem op atomicity.** Same-drive moves use `rename` (atomic on NTFS). Cross-drive moves are copy → verify → rename source to quarantine — source is never `unlink`'d. Worst case from power failure: destination exists *and* source exists in quarantine; reconciliation handles it.
- **NAS disconnect during apply.** Pauses batch with `status='paused-disconnected'`. User can resume from UI. Already-completed ops stay completed.
- **Out of disk on destination.** Pre-flight check before batch. Mid-stream ENOSPC: partial destination deleted, op `failed`, batch continues.
- **Catalog corruption.** Startup `PRAGMA integrity_check`; on failure, refuse to start with docs link to rebuild flow. Daily background `PRAGMA optimize`.

### 12.4 Logging

Structured JSON-lines logs to `<catalog-dir>\logs\engine-YYYY-MM-DD.log`. Levels: `debug` (off by default), `info`, `warn`, `error`. Every log line for a batch carries the batch ID for `grep`-friendly auditing.

### 12.5 Distribution (v1)

- Repo-based. `git clone`, `npm install`, `npm run fetch-binaries` (mediainfo + ffprobe to `engine/bin/`), `npm run build`, `npm run start`.
- `start.bat` runs the engine and opens the UI; stays in a terminal window for log visibility.
- Optional Windows Task Scheduler entry for always-on use.
- Single-binary `.exe` packaging deferred until Node SEA matures.

### 12.6 Performance targets

Soft targets for v1:

- Scan, local SSD, full-send: ≥ 200 MB/s sustained hashing, ≥ 50,000 files/min on the unchanged-skip path.
- Scan, NAS, full-send: ~80% of single-connection raw network read speed.
- Scan resume: zero re-hashing of unchanged files; checkpoint resume in seconds.
- Plan generation, 5M files / 1000 rules: < 3 seconds.
- Duplicate group detection, 5M files: < 1 second.
- UI list rendering: 100K virtualized rows scroll smoothly.
- First-paint dashboard: < 500 ms after engine is up.

## 13. v1 Milestones

Each milestone ends with a useful, independently testable subset of the tool.

1. **M1 — Foundations.** Project skeleton, shared types, SQLite schema + migrations, drive registry (manual entry, volume serial detection), settings, throttle profile data model. CLI `status` shows registered drives. *Deliverable: engine starts, persists, and reports.*
2. **M2 — Scan.** Walker + hash + metadata + DB writer + checkpointing + throttle. CLI `scan <drive>` works. *Deliverable: a fully-indexed catalog of one drive.*
3. **M3 — Browse + Drives + Scans UI.** Engine API, Hono server, Preact frontend skeleton, read-only screens (Dashboard, Drives, Scans, Browse). Scan controls. *Deliverable: you can see what you have.*
4. **M4 — Duplicates.** Detection + keeper-scoring + dedup batch apply with quarantine. Duplicates and Quarantine screens. *Deliverable: first disk space recovered.*
5. **M5 — Rules + Organize.** Rules data model, planner, plan UI, apply with cross-drive review and undo. Operation log and History screen. Same-drive auto-apply. *Deliverable: indexed files organized into target structure.*
6. **M6 — Roles + Schedules.** Role abstraction, role priority/overflow, throttle schedule editor, cross-drive role resolution replacing direct drive paths. *Deliverable: rules survive drive reorganizations.*
7. **M7 — Polish + Hardening.** Reconciliation pass on startup, error path completeness, perf tuning, keyboard shortcuts, docs, install script. *Deliverable: v1 trusted to run unattended overnight.*

The implementation plan (next document) will sequence work within and across milestones.
