# FileOrganizer

Local tool to organize personal files across multiple drives. See:

- Design spec: `docs/superpowers/specs/2026-04-25-file-organizer-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-25-file-organizer-implementation.md`

## Quick start

```
npm install
npm run start
```

That's it. `npm run start` builds the UI, creates a catalog at the default
location on first run, and boots the local web server. Open the printed URL
(`http://127.0.0.1:<port>`) in your browser, go to Scans, type any folder
path, hit Scan.

The catalog is created at:
- Windows: `%APPDATA%\FileOrganizer\catalog.db`
- macOS/Linux: `~/.fileorganizer/catalog.db`

## CLI (optional)

You can also use the CLI directly:

```
npx tsx packages/engine/src/cli/index.ts init --catalog D:\custom\catalog.db
npx tsx packages/engine/src/cli/index.ts scan --path "D:\Pictures"
npx tsx packages/engine/src/cli/index.ts status
```

## Status

This is a work in progress. See the implementation plan for current milestone
status.
