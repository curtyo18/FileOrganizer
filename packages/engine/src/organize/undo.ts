import * as fs from 'node:fs';
import { dirname } from 'node:path';
import type { OperationKind, OperationRecord } from '@fileorganizer/shared';
import { BatchesRepo } from '../catalog/batches-repo.js';
import type { Catalog } from '../catalog/connection.js';
import { hashFile } from '../scan/hasher.js';
import { quarantineFile, restoreFromQuarantine } from '../quarantine/quarantine.js';

function inverseUndoKind(op: OperationRecord): OperationKind {
  if (op.status === 'completed-via-existing') return 'restore';
  if (op.kind === 'move') return 'move';
  if (op.kind === 'copy') return 'restore';
  return op.kind;
}

export interface UndoOptions {
  db: Catalog;
  batchId: string;
  driveRoots: Map<string, string>;
  chunkBytes?: number;
}

export interface UndoResult {
  undoBatchId: string;
  reverted: number;
  skipped: number;
  errors: { operationId: number; reason: string }[];
}

const DEFAULT_CHUNK_BYTES = 1024 * 1024;

export async function undoBatch(opts: UndoOptions): Promise<UndoResult> {
  const batches = new BatchesRepo(opts.db);
  const original = batches.findById(opts.batchId);
  if (!original) {
    throw new Error(`batch ${opts.batchId} not found`);
  }

  const ops = batches.listOperations(opts.batchId).slice().reverse();
  const undo = batches.start({
    kind: 'undo',
    description: `undo of ${opts.batchId}`,
  });
  const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;

  let reverted = 0;
  let skipped = 0;
  const errors: { operationId: number; reason: string }[] = [];

  for (const op of ops) {
    if (op.status !== 'completed' && op.status !== 'completed-via-existing') {
      skipped += 1;
      continue;
    }
    try {
      const handled = await reverseOne(op, opts, chunkBytes, batches, undo.id);
      if (handled) {
        reverted += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      const reason = (err as Error).message;
      errors.push({ operationId: op.id, reason });
      skipped += 1;
      batches.recordOperation(undo.id, {
        kind: inverseUndoKind(op),
        fileId: op.fileId,
        sourceDriveId: op.destDriveId,
        sourcePath: op.destPath,
        destDriveId: op.sourceDriveId,
        destPath: op.sourcePath,
        errorMessage: reason,
        status: 'failed',
      });
    }
  }

  batches.finish(undo.id, errors.length === 0 ? 'completed' : 'failed', {
    reverted,
    skipped,
    errors: errors.length,
  });

  return { undoBatchId: undo.id, reverted, skipped, errors };
}

async function reverseOne(
  op: OperationRecord,
  opts: UndoOptions,
  chunkBytes: number,
  batches: BatchesRepo,
  undoBatchId: string,
): Promise<boolean> {
  if (op.status === 'completed-via-existing') {
    return reverseCompletedViaExisting(op, opts, batches, undoBatchId);
  }
  if (op.kind === 'move') {
    return reverseSameDriveMove(op, opts, chunkBytes, batches, undoBatchId);
  }
  if (op.kind === 'copy') {
    return reverseCrossDriveMove(op, opts, chunkBytes, batches, undoBatchId);
  }
  return false;
}

async function reverseSameDriveMove(
  op: OperationRecord,
  opts: UndoOptions,
  chunkBytes: number,
  batches: BatchesRepo,
  undoBatchId: string,
): Promise<boolean> {
  if (!op.destPath || !op.sourcePath || op.fileId == null) {
    throw new Error('op missing fileId/source/dest');
  }
  if (!fs.existsSync(op.destPath)) {
    throw new Error(`destination ${op.destPath} no longer exists`);
  }

  const fileSha = (
    opts.db.prepare(`SELECT sha256 FROM files WHERE id = ?`).get(op.fileId) as
      | { sha256: string }
      | undefined
  )?.sha256;
  const verifyHash = op.postHash ?? fileSha;
  if (!verifyHash) throw new Error(`file ${op.fileId} not found`);
  const live = await hashFile(op.destPath, { chunkBytes, sleepMs: 0 });
  if (live !== verifyHash) {
    throw new Error(
      op.postHash
        ? `post_hash mismatch at ${op.destPath}`
        : `hash drift at ${op.destPath}`,
    );
  }

  if (fs.existsSync(op.sourcePath)) {
    throw new Error(`original path ${op.sourcePath} occupied`);
  }

  fs.mkdirSync(dirname(op.sourcePath), { recursive: true });
  fs.renameSync(op.destPath, op.sourcePath);
  opts.db
    .prepare(`UPDATE files SET path = ?, state = 'indexed' WHERE id = ?`)
    .run(op.sourcePath, op.fileId);
  batches.recordOperation(undoBatchId, {
    kind: inverseUndoKind(op),
    fileId: op.fileId,
    sourceDriveId: op.destDriveId,
    sourcePath: op.destPath,
    destDriveId: op.sourceDriveId,
    destPath: op.sourcePath,
    status: 'completed',
  });
  return true;
}

async function reverseCrossDriveMove(
  op: OperationRecord,
  opts: UndoOptions,
  chunkBytes: number,
  batches: BatchesRepo,
  undoBatchId: string,
): Promise<boolean> {
  if (!op.destPath || !op.sourcePath || op.fileId == null || !op.sourceDriveId) {
    throw new Error('op missing fileId/source/dest/sourceDriveId');
  }
  if (!fs.existsSync(op.destPath)) {
    throw new Error(`destination ${op.destPath} no longer exists`);
  }

  const fileSha = (
    opts.db.prepare(`SELECT sha256 FROM files WHERE id = ?`).get(op.fileId) as
      | { sha256: string }
      | undefined
  )?.sha256;
  const verifyHash = op.postHash ?? fileSha;
  if (!verifyHash) throw new Error(`file ${op.fileId} not found`);
  const live = await hashFile(op.destPath, { chunkBytes, sleepMs: 0 });
  if (live !== verifyHash) {
    throw new Error(
      op.postHash
        ? `post_hash mismatch at ${op.destPath}`
        : `hash drift at ${op.destPath}`,
    );
  }

  const sourceRoot = opts.driveRoots.get(op.sourceDriveId);
  if (!sourceRoot) throw new Error(`no driveRoot for ${op.sourceDriveId}`);

  const qSnapshot = opts.db
    .prepare(
      `SELECT id, original_size AS originalSize, original_sha256 AS originalSha256,
              original_mtime AS originalMtime
         FROM quarantine WHERE original_path = ? AND batch_id = ?
         ORDER BY id DESC LIMIT 1`,
    )
    .get(op.sourcePath, op.batchId) as
    | { id: number; originalSize: number; originalSha256: string; originalMtime: string }
    | undefined;
  if (!qSnapshot) {
    throw new Error(`quarantine entry for ${op.sourcePath} not found`);
  }

  restoreFromQuarantine({ db: opts.db, driveRoot: sourceRoot, quarantineId: qSnapshot.id });
  try {
    fs.unlinkSync(op.destPath);
  } catch (err) {
    const reason = (err as Error).message;
    try {
      const rollback = quarantineFile({
        db: opts.db,
        batchId: op.batchId,
        driveId: op.sourceDriveId,
        driveRoot: sourceRoot,
        sourcePath: op.sourcePath,
        sha256: qSnapshot.originalSha256,
        sizeBytes: qSnapshot.originalSize,
        mtime: qSnapshot.originalMtime,
      });
      // Update catalog to reflect the re-quarantined reality so the reconciler
      // can reason about this file without manual SQL (spec §12.3).
      try {
        opts.db
          .prepare(`UPDATE files SET state = 'quarantined', path = ? WHERE id = ?`)
          .run(rollback.quarantinePath, op.fileId);
      } catch (catalogErr) {
        // A secondary DB failure must not mask the original unlink error; log and
        // continue so the outer throw surfaces the real cause to the caller.
        // NOTE: no structured logger is threaded through UndoOptions yet; emitting
        // in log.ts JSON shape so it parses consistently with the rest of the engine.
        process.stderr.write(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            msg: 'undo-catalog-update-failed',
            op_id: op.id,
            file_id: op.fileId,
            error: (catalogErr as Error).message,
          }) + '\n',
        );
      }
    } catch (rollbackErr) {
      throw new Error(
        `could not remove dest at ${op.destPath} after restoring source; rollback failed: ${(rollbackErr as Error).message} (original: ${reason})`,
      );
    }
    throw new Error(
      `could not remove dest at ${op.destPath} after restoring source; rolled back: ${reason}`,
    );
  }
  opts.db
    .prepare(`UPDATE files SET path = ?, drive_id = ?, state = 'indexed' WHERE id = ?`)
    .run(op.sourcePath, op.sourceDriveId, op.fileId);
  batches.recordOperation(undoBatchId, {
    kind: inverseUndoKind(op),
    fileId: op.fileId,
    sourceDriveId: op.destDriveId,
    sourcePath: op.destPath,
    destDriveId: op.sourceDriveId,
    destPath: op.sourcePath,
    status: 'completed',
  });
  return true;
}

async function reverseCompletedViaExisting(
  op: OperationRecord,
  opts: UndoOptions,
  batches: BatchesRepo,
  undoBatchId: string,
): Promise<boolean> {
  if (!op.sourcePath || op.fileId == null || !op.sourceDriveId) {
    throw new Error('op missing fileId/source/sourceDriveId');
  }
  const sourceRoot = opts.driveRoots.get(op.sourceDriveId);
  if (!sourceRoot) throw new Error(`no driveRoot for ${op.sourceDriveId}`);
  const qRow = opts.db
    .prepare(
      `SELECT id FROM quarantine WHERE original_path = ? AND batch_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(op.sourcePath, op.batchId) as { id: number } | undefined;
  if (!qRow) {
    throw new Error(`quarantine entry for ${op.sourcePath} not found`);
  }
  restoreFromQuarantine({ db: opts.db, driveRoot: sourceRoot, quarantineId: qRow.id });
  opts.db
    .prepare(`UPDATE files SET state = 'indexed' WHERE id = ?`)
    .run(op.fileId);
  batches.recordOperation(undoBatchId, {
    kind: inverseUndoKind(op),
    fileId: op.fileId,
    sourceDriveId: op.sourceDriveId,
    sourcePath: op.destPath,
    destDriveId: op.sourceDriveId,
    destPath: op.sourcePath,
    status: 'completed',
  });
  return true;
}
