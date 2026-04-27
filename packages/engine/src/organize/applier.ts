import type { Catalog } from '../catalog/connection.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { RulesRepo } from '../rules/repo.js';
import { moveCrossDrive } from './move-cross-drive.js';
import { moveSameDrive, type MoveOutcome } from './move-same-drive.js';
import type { PlannedOperation } from './planner.js';

export interface AutoApplyInput {
  db: Catalog;
  operations: PlannedOperation[];
  driveRoots: Map<string, string>;
  chunkBytes: number;
}

export interface AutoApplyResult {
  autoBatchId: string | null;
  autoApplied: number;
  reviewQueue: PlannedOperation[];
}

export async function autoApply(input: AutoApplyInput): Promise<AutoApplyResult> {
  const rules = new RulesRepo(input.db).list();
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const auto: PlannedOperation[] = [];
  const review: PlannedOperation[] = [];

  for (const op of input.operations) {
    if (op.kind === 'noop') continue;
    const rule = ruleById.get(op.ruleId);
    if (!rule) {
      review.push(op);
      continue;
    }
    if (op.kind === 'same-drive-move' && rule.movePolicy === 'same-drive-auto') {
      auto.push(op);
    } else {
      review.push(op);
    }
  }

  if (auto.length === 0) {
    return { autoBatchId: null, autoApplied: 0, reviewQueue: review };
  }

  const result = await runBatch({
    db: input.db,
    description: 'auto same-drive moves',
    operations: auto,
    driveRoots: input.driveRoots,
    chunkBytes: input.chunkBytes,
  });

  return {
    autoBatchId: result.batchId,
    autoApplied: result.completed,
    reviewQueue: review,
  };
}

export interface ApplyApprovedBatchInput {
  db: Catalog;
  description: string;
  operations: PlannedOperation[];
  driveRoots: Map<string, string>;
  chunkBytes: number;
}

export interface ApplyApprovedBatchResult {
  batchId: string;
  completed: number;
  failed: number;
}

export async function applyApprovedBatch(
  input: ApplyApprovedBatchInput,
): Promise<ApplyApprovedBatchResult> {
  return runBatch(input);
}

async function runBatch(input: ApplyApprovedBatchInput): Promise<ApplyApprovedBatchResult> {
  const batches = new BatchesRepo(input.db);
  const batch = batches.start({ kind: 'move', description: input.description });
  let completed = 0;
  let failed = 0;

  for (const op of input.operations) {
    const ledgerOp = batches.recordOperation(batch.id, {
      kind: op.kind === 'cross-drive-move' ? 'copy' : 'move',
      fileId: op.fileId,
      sourceDriveId: op.sourceDriveId,
      sourcePath: op.sourcePath,
      destDriveId: op.destDriveId,
      destPath: op.destPath,
      status: 'in-progress',
    });

    try {
      const outcome = await runOne(op, batch.id, input);
      const finalStatus = outcome.kind === 'completed-via-existing' ? 'completed-via-existing' : 'completed';
      batches.updateOperationStatus(ledgerOp.id, finalStatus);
      completed += 1;
    } catch (err) {
      batches.updateOperationStatus(ledgerOp.id, 'failed', {
        errorMessage: (err as Error).message,
      });
      failed += 1;
    }
  }

  batches.finish(batch.id, failed === 0 ? 'completed' : 'failed', { completed, failed });
  return { batchId: batch.id, completed, failed };
}

async function runOne(
  op: PlannedOperation,
  batchId: string,
  input: ApplyApprovedBatchInput,
): Promise<MoveOutcome> {
  if (op.kind === 'same-drive-move') {
    const driveRoot = input.driveRoots.get(op.sourceDriveId);
    if (!driveRoot) throw new Error(`no drive root supplied for drive ${op.sourceDriveId}`);
    return moveSameDrive({
      db: input.db,
      fileId: op.fileId,
      destPath: op.destPath,
      driveRoot,
      batchId,
      chunkBytes: input.chunkBytes,
    });
  }
  if (op.kind === 'cross-drive-move') {
    const sourceRoot = input.driveRoots.get(op.sourceDriveId);
    if (!sourceRoot) throw new Error(`no drive root supplied for drive ${op.sourceDriveId}`);
    return moveCrossDrive({
      db: input.db,
      fileId: op.fileId,
      destPath: op.destPath,
      destDriveId: op.destDriveId,
      sourceDriveRoot: sourceRoot,
      batchId,
      chunkBytes: input.chunkBytes,
    });
  }
  throw new Error(`unsupported op kind: ${op.kind}`);
}
