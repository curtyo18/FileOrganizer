import { existsSync } from 'node:fs';
import type { Catalog } from '../catalog/connection.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { quarantineFile } from '../quarantine/quarantine.js';
import { hashFile } from '../scan/hasher.js';
import { IntegrityError } from '@fileorganizer/shared';
import type { DedupeOperation } from './planner.js';

export interface ApplyDedupeInput {
  db: Catalog;
  operations: DedupeOperation[];
  driveRoots: Map<string, string>;
  chunkBytes: number;
  sleepMs: number;
}

export interface ApplyDedupeResult {
  batchId: string;
  completed: number;
  failed: number;
  reclaimedBytes: number;
}

export async function applyDedupe(input: ApplyDedupeInput): Promise<ApplyDedupeResult> {
  const batches = new BatchesRepo(input.db);
  const batch = batches.start({
    kind: 'dedupe',
    description: `dedupe ${input.operations.length} ops`,
  });
  let completed = 0;
  let failed = 0;
  let reclaimedBytes = 0;
  try {
    for (const op of input.operations) {
      const fileRow = input.db
        .prepare(
          `SELECT drive_id AS driveId, path, sha256, size_bytes AS sizeBytes, mtime
           FROM files WHERE id = ?`,
        )
        .get(op.removeFileId) as
        | { driveId: string; path: string; sha256: string; sizeBytes: number; mtime: string }
        | undefined;
      if (!fileRow) {
        failed += 1;
        continue;
      }
      const driveRoot = input.driveRoots.get(fileRow.driveId);
      if (!driveRoot) {
        failed += 1;
        continue;
      }
      const dbOp = batches.recordOperation(batch.id, {
        kind: 'quarantine',
        fileId: op.removeFileId,
        sourceDriveId: fileRow.driveId,
        sourcePath: fileRow.path,
        preHash: fileRow.sha256,
        status: 'in-progress',
      });
      try {
        if (!existsSync(fileRow.path)) {
          throw new IntegrityError('FILE_MISSING', `${fileRow.path} no longer exists`);
        }
        const liveHash = await hashFile(fileRow.path, { chunkBytes: input.chunkBytes, sleepMs: input.sleepMs });
        if (liveHash !== fileRow.sha256) {
          throw new IntegrityError(
            'HASH_MISMATCH',
            `live hash ${liveHash} != catalog hash ${fileRow.sha256} for ${fileRow.path}`,
          );
        }
        const result = quarantineFile({
          db: input.db,
          batchId: batch.id,
          driveId: fileRow.driveId,
          driveRoot,
          sourcePath: fileRow.path,
          sha256: fileRow.sha256,
          sizeBytes: fileRow.sizeBytes,
          mtime: fileRow.mtime,
        });
        input.db
          .prepare(`UPDATE files SET state = 'quarantined' WHERE id = ?`)
          .run(op.removeFileId);
        batches.updateOperationStatus(dbOp.id, 'completed', {
          quarantinePath: result.quarantinePath,
          postHash: liveHash,
        });
        completed += 1;
        reclaimedBytes += fileRow.sizeBytes;
      } catch (err) {
        batches.updateOperationStatus(dbOp.id, 'failed', { errorMessage: (err as Error).message });
        failed += 1;
      }
    }
    batches.finish(batch.id, failed === 0 ? 'completed' : 'failed', {
      completed,
      failed,
      reclaimedBytes,
    });
  } catch (err) {
    batches.finish(batch.id, 'failed', { completed, failed, error: (err as Error).message });
    throw err;
  }
  return { batchId: batch.id, completed, failed, reclaimedBytes };
}
