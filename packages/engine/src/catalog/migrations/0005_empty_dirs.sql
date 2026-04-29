-- Per-drive cache of recursively-empty directories observed by the scan
-- walker. Backs the cleanup screen's GET path so it can return instantly
-- instead of re-walking the drive synchronously on every request.
CREATE TABLE empty_dirs (
    drive_id TEXT NOT NULL REFERENCES drives(id),
    path TEXT NOT NULL,
    last_seen_scan_id TEXT NOT NULL REFERENCES scans(id),
    found_at TEXT NOT NULL,
    PRIMARY KEY (drive_id, path)
);
CREATE INDEX idx_empty_dirs_drive ON empty_dirs (drive_id);
