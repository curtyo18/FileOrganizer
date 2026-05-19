-- Add created_at to rules for deterministic tiebreaker ordering.
-- Existing rows receive the current timestamp; new rows use CURRENT_TIMESTAMP.
ALTER TABLE rules ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
