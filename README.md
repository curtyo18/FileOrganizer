# FileOrganizer

A local-first tool for cleaning up personal file storage across multiple
drives — find byte-identical duplicates, organize photos and documents by
year, route categories to specific drives (including a NAS), and recover
disk space before a machine migration.

Runs entirely on your own machine. Nothing leaves your network, nothing is
uploaded anywhere. The catalog is a local SQLite file you own and can move.

![FileOrganizer dashboard](docs/screenshots/dashboard.png)

## What it does

- **Scans** drives and indexes images, video, audio, documents, spreadsheets,
  presentations, archives, ebooks, and code into a local catalog. System
  files (`Windows`, `Program Files`, `node_modules`, `.git`, etc.) are
  skipped automatically.
- **Detects byte-identical duplicates** across every indexed drive at once,
  ranks them, and proposes a keeper based on drive role, path depth,
  filesystem mtime, and other tiebreakers.
- **Quarantines** non-keepers into a per-drive `_FileOrganizer_quarantine/`
  folder. Nothing is hard-deleted — files are recoverable until you
  explicitly purge.
- **Organizes** photos and documents by date and category, with
  cross-drive moves gated by your approval, dry-run preview, and
  per-batch undo.
- Scans are **resumable** and **throttleable** — run at full speed overnight,
  idle profile during the workday.

## Prerequisites

- **Node 22 or 24 LTS** (24 recommended). Node 18 is too old.
- **Git** to clone.
- **Windows is the primary target.** POSIX (macOS / Linux) works for the
  scanner and most of the catalog, but volume detection and drive-letter
  resolution have less coverage there.
- For video metadata, the engine shells out to MediaInfo CLI. `npm run
  fetch-binaries` downloads it to `packages/engine/bin/`. If that fails (or
  you skip it), video files are still indexed — just without their embedded
  creation date.

## Install from source

```
git clone https://github.com/curtyo18/FileOrganizer.git
cd FileOrganizer
npm install
npm run fetch-binaries     # downloads MediaInfo CLI into packages/engine/bin/
npm run build
```

If `fetch-binaries` fails (corporate proxy, sandbox, transient 5xx) the
script prints the URL and target path so you can drop the binary in
manually. The engine tolerates a missing MediaInfo and just emits null
video metadata.

## Quick start

```
npm run start
```

The first `npm run start` builds the UI, creates a catalog at the default
location, and boots a local web server bound to `127.0.0.1`. Open the
printed URL in your browser. Go to **Scans**, paste any absolute folder
path, hit Scan. The drive is auto-detected and registered.

Catalog default location:
- Windows: `%APPDATA%\FileOrganizer\catalog.db`
- macOS/Linux: `~/.fileorganizer/catalog.db`

## Daily use

```
# Run the local UI:
npm run start
# Then open the URL printed in the console (typically http://127.0.0.1:<port>).
```

Inside the UI:

- **Dashboard** (`gd`) — quick health view: drive count, scan status, recent
  batches.
- **Drives** (`gb` — _b_rowse) — registered drives, mount points, role
  assignments.
- **Scans** (`gs`) — start a scan from any folder, watch progress, resume
  after a pause.
- **Organize** (`go`) — edit rules, plan moves, dry-run, apply, undo.
- **Duplicates** (`gu`) — review byte-identical sets, send non-keepers to
  quarantine.
- **History** (`gh`) — every batch with per-operation status; undo any
  organize batch.
- **Quarantine** (`gq`) — restore quarantined files back to their original
  path, or purge after you've reviewed them.
- **Roles** (`gr`) — define which drive(s) hold which categories, with
  priority + overflow.
- **Throttle** (`gt`) — switch profiles (idle / balanced / full-send) or
  schedule them by hour.

## CLI (optional)

The web UI uses the same engine, but the CLI is also exposed:

```
npx tsx packages/engine/src/cli/index.ts init --catalog D:\custom\catalog.db
npx tsx packages/engine/src/cli/index.ts scan --path "D:\Pictures"
npx tsx packages/engine/src/cli/index.ts status
```

## Is it safe to run?

- **Scanning is read-only.** The engine reads files to compute hashes and
  EXIF metadata. It never modifies or moves a file during a scan.
- **Dedup moves files into a per-drive quarantine folder, not the trash.**
  Each batch creates `<drive>\_FileOrganizer_quarantine\<batch-id>\…`
  preserving the original folder structure. The Quarantine screen lets you
  restore any subset back to the original path. There is no auto-purge.
- **Nothing crosses drives without your explicit approval** (cross-drive
  copies first verify the destination hash, then quarantine the source —
  so a power loss leaves both copies, never zero).
- **Startup reconciliation** — every boot scans the operations ledger for
  in-flight work from a prior crash and resolves it from filesystem
  evidence (dest matches recorded hash → completed; source still there →
  failed; both gone → ambiguous and surfaced).
- **Free-space pre-flight** — before any cross-drive batch, the engine
  totals bytes-needed per destination drive and refuses to start if the
  destination's free space (minus a 5% safety margin) wouldn't cover it.
- **NAS disconnect handling** — if a network drive disappears mid-copy,
  the engine raises a typed `DriveError`, halts the batch, and the API
  surfaces it as 503 instead of corrupting state.

That said, this is alpha-quality software. **Run it against a small test
folder first**, or ensure you have a backup of anything irreplaceable
before turning it loose on a real library.

## Troubleshooting

- **"catalog file is locked"** — another FileOrganizer process is running.
  Close it (the running terminal, or end the specific node PID) and retry.
  Don't `taskkill /F /IM node.exe` — that takes down unrelated Node
  processes too.
- **"NAS not reachable" / 503 with `DRIVE_DISCONNECTED`** — your network
  drive went offline mid-batch. Reconnect the drive and re-run the
  organize. The interrupted batch is in History as `failed`; future
  applies start fresh batches.
- **"mediainfo not found"** — run `npm run fetch-binaries`. If the
  download fails (e.g. behind a corporate proxy), download `MediaInfo
  CLI` from <https://mediaarea.net/en/MediaInfo>, extract `MediaInfo.exe`
  (or `mediainfo` on POSIX), and place it in `packages/engine/bin/`.
- **"insufficient free space on <label>"** — the planner's pre-flight saw
  a destination drive too full for the proposed moves. Adjust the role's
  drive priority/overflow on the Roles screen, or move some files
  manually first to make room.
- **A scan stops with `paused` status** — open it on the Scans screen
  and click Resume. Resume re-walks all directories; unchanged files
  (by size+mtime) are not re-hashed.

## Architecture

Three packages in this monorepo:

- `packages/shared` — types and constants used by both engine and UI.
- `packages/engine` — Node 22 + TypeScript headless service. Owns the
  SQLite catalog, scanning, organizing, deduping, throttle scheduling,
  and the local HTTP API.
- `packages/ui` — Preact + Vite frontend served by the engine on
  `127.0.0.1`. Dark dense pro-tool aesthetic; design tokens in
  `packages/ui/src/styles.css`.

Key building blocks:

- **Engine**: `better-sqlite3`, `Hono` HTTP server, `node:crypto` for
  hashing, `node:worker_threads` for parallelism, `exifr` for image
  metadata, MediaInfo subprocess for video.
- **Catalog**: a single SQLite file. Schema in
  `packages/engine/src/catalog/migrations/`. Move it to a different drive
  any time — the pointer is one small JSON file under `%APPDATA%`.
- **Throttle profiles** (idle / balanced / full-send) cap concurrency,
  hash chunk size, and per-chunk sleep. The scheduler watches the clock
  so a "full-send overnight, idle on weekday mornings" profile is one
  config away.

## License

No license set yet. If you want to use, fork, or modify this code, open an
issue first.
