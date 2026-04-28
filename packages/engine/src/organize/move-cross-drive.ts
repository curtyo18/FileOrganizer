import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname } from 'node:path';
import { DriveError, IntegrityError } from '@fileorganizer/shared';
import type { Catalog } from '../catalog/connection.js';
import { hashFile } from '../scan/hasher.js';
import { quarantineFile } from '../quarantine/quarantine.js';
import { resolveCollision } from './collision.js';
import type { MoveOutcome } from './move-same-drive.js';

const DISCONNECT_CODES = new Set([
  'ENOENT',
  'EBUSY',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENETUNREACH',
]);

export interface MoveCrossDriveInput {
  db: Catalog;
  fileId: number;
  destPath: string;
  destDriveId: string;
  sourceDriveRoot: string;
  batchId: string;
  chunkBytes: number;
}

export async function moveCrossDrive(input: MoveCrossDriveInput): Promise<MoveOutcome> {
  const row = input.db
    .prepare(
      `SELECT path, sha256, drive_id AS driveId, size_bytes AS sizeBytes, mtime
       FROM files WHERE id = ?`,
    )
    .get(input.fileId) as
    | { path: string; sha256: string; driveId: string; sizeBytes: number; mtime: string }
    | undefined;
  if (!row) throw new Error(`file ${input.fileId} not found`);

  const decision = await resolveCollision(input.destPath, row.sha256, input.chunkBytes);

  if (decision.kind === 'same-content') {
    quarantineFile({
      db: input.db,
      batchId: input.batchId,
      driveId: row.driveId,
      driveRoot: input.sourceDriveRoot,
      sourcePath: row.path,
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
      mtime: row.mtime,
    });
    input.db
      .prepare(`UPDATE files SET state = 'quarantined' WHERE id = ?`)
      .run(input.fileId);
    return { kind: 'completed-via-existing', finalDestPath: decision.path };
  }

  const finalDestPath = decision.path;
  mkdirSync(dirname(finalDestPath), { recursive: true });
  try {
    await pipeline(createReadStream(row.path), createWriteStream(finalDestPath));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && DISCONNECT_CODES.has(code)) {
      throw new DriveError(
        'DRIVE_DISCONNECTED',
        `cross-drive copy failed: ${code}`,
        err,
      );
    }
    throw err;
  }

  const liveHash = await hashFile(finalDestPath, {
    chunkBytes: input.chunkBytes,
    sleepMs: 0,
  });
  if (liveHash !== row.sha256) {
    throw new IntegrityError(
      'CROSS_DRIVE_HASH_MISMATCH',
      `dest hash ${liveHash} != catalog ${row.sha256}`,
    );
  }

  quarantineFile({
    db: input.db,
    batchId: input.batchId,
    driveId: row.driveId,
    driveRoot: input.sourceDriveRoot,
    sourcePath: row.path,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    mtime: row.mtime,
  });
  input.db
    .prepare(`UPDATE files SET path = ?, drive_id = ?, state = 'moved' WHERE id = ?`)
    .run(finalDestPath, input.destDriveId, input.fileId);
  return { kind: 'moved', finalDestPath };
}
