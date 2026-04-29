-- SQLite can't ALTER a CHECK constraint in place; rebuild the scans table
-- so its status enum admits 'cancelled' alongside the existing values.
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
