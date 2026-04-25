CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE drives (
    id TEXT PRIMARY KEY,
    volume_serial TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    current_letter TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('local', 'external', 'network')),
    roles TEXT NOT NULL DEFAULT '[]',
    total_bytes INTEGER NOT NULL DEFAULT 0,
    free_bytes INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE scans (
    id TEXT PRIMARY KEY,
    drive_id TEXT NOT NULL REFERENCES drives(id),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'failed')),
    root_paths TEXT NOT NULL DEFAULT '[]',
    throttle_profile TEXT NOT NULL,
    progress TEXT NOT NULL DEFAULT '{}',
    stats TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id TEXT NOT NULL REFERENCES drives(id),
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    extension TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    category TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    mtime TEXT NOT NULL,
    ctime TEXT NOT NULL,
    exif_date TEXT,
    date_source TEXT NOT NULL CHECK (date_source IN ('exif', 'mtime', 'none')),
    width INTEGER,
    height INTEGER,
    duration_seconds REAL,
    ntfs_file_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('indexed', 'quarantined', 'moved', 'deleted-from-source', 'missing')),
    last_verified_at TEXT NOT NULL,
    scan_id TEXT NOT NULL REFERENCES scans(id),
    UNIQUE (drive_id, path)
);

CREATE INDEX idx_files_sha256 ON files (sha256);
CREATE INDEX idx_files_category_exif ON files (category, exif_date);
CREATE INDEX idx_files_state ON files (state);

CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    match_json TEXT NOT NULL,
    destination_role TEXT NOT NULL,
    destination_template TEXT NOT NULL,
    move_policy TEXT NOT NULL,
    quarantine_policy TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX idx_rules_priority ON rules (priority);

CREATE TABLE batches (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_batches_started_at ON batches (started_at);

CREATE TABLE operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL REFERENCES batches(id),
    kind TEXT NOT NULL,
    file_id INTEGER REFERENCES files(id),
    source_drive_id TEXT,
    source_path TEXT,
    dest_drive_id TEXT,
    dest_path TEXT,
    pre_hash TEXT,
    post_hash TEXT,
    quarantine_path TEXT,
    status TEXT NOT NULL,
    error_message TEXT
);

CREATE INDEX idx_operations_batch ON operations (batch_id);
CREATE INDEX idx_operations_status ON operations (status);

CREATE TABLE quarantine (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id TEXT NOT NULL REFERENCES drives(id),
    original_path TEXT NOT NULL,
    original_size INTEGER NOT NULL,
    original_sha256 TEXT NOT NULL,
    original_mtime TEXT NOT NULL,
    quarantine_path TEXT NOT NULL,
    quarantined_at TEXT NOT NULL,
    batch_id TEXT NOT NULL REFERENCES batches(id)
);

CREATE INDEX idx_quarantine_drive ON quarantine (drive_id);
CREATE INDEX idx_quarantine_hash ON quarantine (original_sha256);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
