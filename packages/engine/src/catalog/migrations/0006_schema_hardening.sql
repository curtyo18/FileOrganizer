-- Schema hardening: CHECK constraints, FK ON DELETE actions, and index improvements.
--
-- SQLite cannot ALTER a CHECK constraint or change FK actions in place; the
-- affected tables (batches, operations, quarantine) are rebuilt via the
-- CREATE/INSERT/DROP/RENAME dance.  The migrate runner disables foreign_keys
-- for the duration of each migration transaction so the DROP steps succeed
-- even though other tables reference these tables.
--
-- Dependency order: batches first (operations and quarantine reference it),
-- then operations, then quarantine.

-- ── 1. Rebuild `batches` — add CHECK on status ──────────────────────────────
-- status values mirror OperationStatus in packages/shared/src/types.ts — keep in sync
CREATE TABLE batches_new (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'in-progress', 'completed', 'completed-via-existing',
        'failed', 'reverted', 'dry-run'
    )),
    description TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO batches_new (id, kind, started_at, finished_at, status, description, summary)
SELECT id, kind, started_at, finished_at, status, description, summary FROM batches;

DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;

-- Recreate index that existed on the original table
CREATE INDEX idx_batches_started_at ON batches (started_at);

-- ── 2. Rebuild `operations` — add CHECK on status + ON DELETE CASCADE/SET NULL ─
CREATE TABLE operations_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    source_drive_id TEXT,
    source_path TEXT,
    dest_drive_id TEXT,
    dest_path TEXT,
    pre_hash TEXT,
    post_hash TEXT,
    quarantine_path TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'in-progress', 'completed', 'completed-via-existing',
        'failed', 'reverted', 'dry-run'
    )),
    error_message TEXT
);

INSERT INTO operations_new (id, batch_id, kind, file_id, source_drive_id, source_path,
                             dest_drive_id, dest_path, pre_hash, post_hash,
                             quarantine_path, status, error_message)
SELECT id, batch_id, kind, file_id, source_drive_id, source_path,
       dest_drive_id, dest_path, pre_hash, post_hash,
       quarantine_path, status, error_message FROM operations;

DROP TABLE operations;
ALTER TABLE operations_new RENAME TO operations;

-- Recreate indexes that existed on the original table
CREATE INDEX idx_operations_batch ON operations (batch_id);
CREATE INDEX idx_operations_status ON operations (status);

-- ── 3. Rebuild `quarantine` — add ON DELETE CASCADE on batch_id ─────────────
CREATE TABLE quarantine_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id TEXT NOT NULL REFERENCES drives(id),
    original_path TEXT NOT NULL,
    original_size INTEGER NOT NULL,
    original_sha256 TEXT NOT NULL,
    original_mtime TEXT NOT NULL,
    quarantine_path TEXT NOT NULL,
    quarantined_at TEXT NOT NULL,
    batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE
);

INSERT INTO quarantine_new (id, drive_id, original_path, original_size, original_sha256,
                             original_mtime, quarantine_path, quarantined_at, batch_id)
SELECT id, drive_id, original_path, original_size, original_sha256,
       original_mtime, quarantine_path, quarantined_at, batch_id FROM quarantine;

DROP TABLE quarantine;
ALTER TABLE quarantine_new RENAME TO quarantine;

-- Recreate indexes that existed on the original table
CREATE INDEX idx_quarantine_drive ON quarantine (drive_id);
CREATE INDEX idx_quarantine_hash ON quarantine (original_sha256);

-- ── 4. Index changes on `files` ──────────────────────────────────────────────
-- New index: scan_id lookup used by markMissing
CREATE INDEX idx_files_scan_id ON files (scan_id);

-- Rebuild idx_files_state as a partial index: only index non-indexed states
-- (missing / quarantined / moved / deleted-from-source).  The vast majority
-- of rows are 'indexed', so excluding them cuts write cost and index size
-- while still serving the lookups that actually need it.
DROP INDEX IF EXISTS idx_files_state;
CREATE INDEX idx_files_state ON files (state) WHERE state != 'indexed';
