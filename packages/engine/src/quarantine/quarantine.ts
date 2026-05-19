import { renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Catalog } from '../catalog/connection.js';
import { QuarantineError } from '@fileorganizer/shared';
import { isPathUnderRoot } from '../drives/paths.js';

export interface QuarantineFileInput {
  db: Catalog;
  batchId: string;
  driveId: string;
  driveRoot: string;
  sourcePath: string;
  sha256: string;
  sizeBytes: number;
  mtime: string;
}

export interface QuarantineResult {
  quarantineId: number;
  quarantinePath: string;
}

export const QUARANTINE_DIR_NAME = '_FileOrganizer_quarantine';

export function quarantineFile(input: QuarantineFileInput): QuarantineResult {
  if (!isPathUnderRoot(input.driveRoot, input.sourcePath)) {
    throw new QuarantineError(
      'QUARANTINE_BAD_PATH',
      `source path ${input.sourcePath} is not under drive root ${input.driveRoot}`,
    );
  }
  const rel = relative(input.driveRoot, input.sourcePath);
  const dest = join(input.driveRoot, QUARANTINE_DIR_NAME, input.batchId, rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    throw new QuarantineError(
      'QUARANTINE_COLLISION',
      `quarantine destination already exists: ${dest}`,
    );
  }
  renameSync(input.sourcePath, dest);
  const result = input.db
    .prepare(
      `INSERT INTO quarantine (drive_id, original_path, original_size, original_sha256,
       original_mtime, quarantine_path, quarantined_at, batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.driveId,
      input.sourcePath,
      input.sizeBytes,
      input.sha256,
      input.mtime,
      dest,
      new Date().toISOString(),
      input.batchId,
    );
  return { quarantineId: Number(result.lastInsertRowid), quarantinePath: dest };
}

export interface RestoreInput {
  db: Catalog;
  driveRoot: string;
  quarantineId: number;
}

export function restoreFromQuarantine(input: RestoreInput): void {
  const row = input.db
    .prepare(`SELECT * FROM quarantine WHERE id = ?`)
    .get(input.quarantineId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new QuarantineError(
      'QUARANTINE_NOT_FOUND',
      `quarantine record ${input.quarantineId} not found`,
    );
  }
  const src = row['quarantine_path'] as string;
  const dest = row['original_path'] as string;
  if (!existsSync(src)) {
    throw new QuarantineError('QUARANTINE_FILE_MISSING', `${src} not present`);
  }
  if (existsSync(dest)) {
    throw new QuarantineError(
      'RESTORE_COLLISION',
      `cannot restore to ${dest}: file exists at original path`,
    );
  }
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);
  input.db.prepare(`DELETE FROM quarantine WHERE id = ?`).run(input.quarantineId);
}
