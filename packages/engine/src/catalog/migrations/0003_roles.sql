CREATE TABLE roles (
    name TEXT PRIMARY KEY,
    drive_priority TEXT NOT NULL DEFAULT '[]',
    fill_threshold_percent INTEGER NOT NULL DEFAULT 90,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_roles_created_at ON roles (created_at);
