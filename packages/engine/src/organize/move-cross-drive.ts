import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname } from 'node:path';
import { IntegrityError } from '@fileorganizer/shared';
import type { Catalog } from '../catalog/connection.js';
import { hashFile } from '../scan/hasher.js';
import { quarantineFile } from '../quarantine/quarantine.js';

export interface MoveCrossDriveInput {
  db: Catalog;
  fileId: number;
  destPath: string;
  destDriveId: string;
  sourceDriveRoot: string;
  batchId: string;
  chunkBytes: number;
}

export async function moveCrossDrive(input: MoveCrossDriveInput): Promise<void> {
  const row = input.db
    .prepare(
      `SELECT path, sha256, drive_id AS driveId, size_bytes AS sizeBytes, mtime
       FROM files WHERE id = ?`,
    )
    .get(input.fileId) as
    | { path: string; sha256: string; driveId: string; sizeBytes: number; mtime: string }
    | undefined;
  if (!row) throw new Error(`file ${input.fileId} not found`);

  mkdirSync(dirname(input.destPath), { recursive: true });
  await pipeline(createReadStream(row.path), createWriteStream(input.destPath));

  const liveHash = await hashFile(input.destPath, {
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
    .run(input.destPath, input.destDriveId, input.fileId);
}
