-- SQLite can't ALTER a CHECK constraint in place; rebuild the scans table
-- so its status enum admits 'cancelled' alongside the existing values.
-- The migrate runner disables foreign_keys for the duration of each
-- migration's transaction (re-enabling + running foreign_key_check after),
-- so the DROP/RENAME below is safe even though files.scan_id references
-- scans(id).
CREATE TABLE scans_new (
    id TEXT PRIMARY KEY,
    drive_id TEXT NOT NULL REFERENCES drives(id),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
    root_paths TEXT NOT NULL DEFAULT '[]',
    throttle_profile TEXT NOT NULL,
    progress TEXT NOT NULL DEFAULT '{}',
    stats TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO scans_new (id, drive_id, started_at, finished_at, status, root_paths, throttle_profile, progress, stats)
SELECT id, drive_id, started_at, finished_at, status, root_paths, throttle_profile, progress, stats FROM scans;

DROP TABLE scans;
ALTER TABLE scans_new RENAME TO scans;
