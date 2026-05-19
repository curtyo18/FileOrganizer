import { mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Catalog } from '../catalog/connection.js';
import { quarantineFile } from '../quarantine/quarantine.js';
import { resolveCollision } from './collision.js';

export interface MoveSameDriveInput {
  db: Catalog;
  fileId: number;
  destPath: string;
  driveRoot: string;
  batchId: string;
  chunkBytes: number;
}

export type MoveOutcome =
  | { kind: 'moved'; finalDestPath: string; postHash: string; quarantinePath: string | null }
  | { kind: 'completed-via-existing'; finalDestPath: string; postHash: string; quarantinePath: string | null };

export async function moveSameDrive(input: MoveSameDriveInput): Promise<MoveOutcome> {
  const row = input.db
    .prepare(`SELECT path, sha256, drive_id AS driveId, size_bytes AS sizeBytes, mtime
              FROM files WHERE id = ?`)
    .get(input.fileId) as
    | { path: string; sha256: string; driveId: string; sizeBytes: number; mtime: string }
    | undefined;
  if (!row) throw new Error(`file ${input.fileId} not found`);

  const decision = await resolveCollision(input.destPath, row.sha256, input.chunkBytes);

  if (decision.kind === 'same-content') {
    const qResult = quarantineFile({
      db: input.db,
      batchId: input.batchId,
      driveId: row.driveId,
      driveRoot: input.driveRoot,
      sourcePath: row.path,
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
      mtime: row.mtime,
    });
    input.db
      .prepare(`UPDATE files SET state = 'quarantined' WHERE id = ?`)
      .run(input.fileId);
    return { kind: 'completed-via-existing', finalDestPath: decision.path, postHash: row.sha256, quarantinePath: qResult.quarantinePath };
  }

  const finalDestPath = decision.path;
  mkdirSync(dirname(finalDestPath), { recursive: true });
  renameSync(row.path, finalDestPath);
  input.db
    .prepare(`UPDATE files SET path = ?, state = 'moved' WHERE id = ?`)
    .run(finalDestPath, input.fileId);
  // Atomic rename preserves bytes on POSIX/NTFS, so the catalog's sha256
  // equals the post-rename file content — no re-hash needed (cross-drive
  // path re-hashes because pipeline copies may corrupt mid-stream).
  return { kind: 'moved', finalDestPath, postHash: row.sha256, quarantinePath: null };
}
