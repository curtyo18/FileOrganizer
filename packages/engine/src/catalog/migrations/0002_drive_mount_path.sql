ALTER TABLE drives ADD COLUMN mount_path TEXT;

-- Backfill: any Windows drive with a current_letter has its mount path
-- equal to '<letter>:\'. POSIX rows stay NULL until the next scan upserts them.
UPDATE drives
SET mount_path = SUBSTR(current_letter, 1, 1) || ':\'
WHERE mount_path IS NULL AND current_letter IS NOT NULL;
