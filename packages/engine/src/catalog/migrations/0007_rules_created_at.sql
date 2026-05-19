-- Add created_at to rules for deterministic tiebreaker ordering.
--
-- SQLite's ALTER TABLE ADD COLUMN forbids non-constant defaults, so
-- DEFAULT CURRENT_TIMESTAMP would fail on stricter builds (the bundled
-- SQLite shipped with better-sqlite3 enforces this on Windows but not
-- on the version Linux/macOS prebuilds tend to ship). The constant ''
-- default satisfies the rule, and the UPDATE backfills real timestamps
-- for any rows that already existed before this migration ran.
-- RulesRepo.create() supplies created_at explicitly on every new row,
-- so the placeholder default is never observed after migration.
ALTER TABLE rules ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
UPDATE rules SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE created_at = '';
