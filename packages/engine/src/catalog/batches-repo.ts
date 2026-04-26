import { randomUUID } from 'node:crypto';
import type { Catalog } from './connection.js';
import type {
  BatchKind,
  BatchRecord,
  OperationKind,
  OperationRecord,
  OperationStatus,
} from '@fileorganizer/shared';

export interface StartBatchInput {
  kind: BatchKind;
  description: string;
}

export interface RecordOperationInput {
  kind: OperationKind;
  fileId?: number | null;
  sourceDriveId?: string | null;
  sourcePath?: string | null;
  destDriveId?: string | null;
  destPath?: string | null;
  preHash?: string | null;
  postHash?: string | null;
  quarantinePath?: string | null;
  status: OperationStatus;
}

export class BatchesRepo {
  constructor(private readonly db: Catalog) {}

  start(input: StartBatchInput): BatchRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO batches (id, kind, started_at, status, description, summary)
         VALUES (?, ?, ?, 'in-progress', ?, '{}')`,
      )
      .run(id, input.kind, now, input.description);
    return this.findById(id)!;
  }

  finish(id: string, status: OperationStatus, summary: Record<string, unknown>): void {
    this.db
      .prepare(`UPDATE batches SET status = ?, finished_at = ?, summary = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), JSON.stringify(summary), id);
  }

  recordOperation(batchId: string, op: RecordOperationInput): OperationRecord {
    const result = this.db
      .prepare(
        `INSERT INTO operations (batch_id, kind, file_id, source_drive_id, source_path,
         dest_drive_id, dest_path, pre_hash, post_hash, quarantine_path, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        batchId,
        op.kind,
        op.fileId ?? null,
        op.sourceDriveId ?? null,
        op.sourcePath ?? null,
        op.destDriveId ?? null,
        op.destPath ?? null,
        op.preHash ?? null,
        op.postHash ?? null,
        op.quarantinePath ?? null,
        op.status,
        null,
      );
    return this.findOperation(Number(result.lastInsertRowid))!;
  }

  updateOperationStatus(
    operationId: number,
    status: OperationStatus,
    fields: { postHash?: string; quarantinePath?: string; errorMessage?: string } = {},
  ): void {
    const sets: string[] = ['status = ?'];
    const values: unknown[] = [status];
    if (fields.postHash !== undefined) {
      sets.push('post_hash = ?');
      values.push(fields.postHash);
    }
    if (fields.quarantinePath !== undefined) {
      sets.push('quarantine_path = ?');
      values.push(fields.quarantinePath);
    }
    if (fields.errorMessage !== undefined) {
      sets.push('error_message = ?');
      values.push(fields.errorMessage);
    }
    values.push(operationId);
    this.db.prepare(`UPDATE operations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  listOperations(batchId: string): OperationRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM operations WHERE batch_id = ? ORDER BY id`)
      .all(batchId) as Record<string, unknown>[];
    return rows.map(opRow);
  }

  findById(id: string): BatchRecord | null {
    const row = this.db.prepare(`SELECT * FROM batches WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? batchRow(row) : null;
  }

  findOperation(id: number): OperationRecord | null {
    const row = this.db.prepare(`SELECT * FROM operations WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? opRow(row) : null;
  }

  list(opts: { limit?: number } = {}): BatchRecord[] {
    const limit = opts.limit ?? 100;
    const rows = this.db
      .prepare(`SELECT * FROM batches ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(batchRow);
  }
}

function batchRow(row: Record<string, unknown>): BatchRecord {
  return {
    id: row['id'] as string,
    kind: row['kind'] as BatchKind,
    startedAt: row['started_at'] as string,
    finishedAt: (row['finished_at'] as string | null) ?? null,
    status: row['status'] as OperationStatus,
    description: (row['description'] as string) ?? '',
    summary: JSON.parse((row['summary'] as string) || '{}'),
  };
}

function opRow(row: Record<string, unknown>): OperationRecord {
  return {
    id: row['id'] as number,
    batchId: row['batch_id'] as string,
    kind: row['kind'] as OperationKind,
    fileId: (row['file_id'] as number | null) ?? null,
    sourceDriveId: (row['source_drive_id'] as string | null) ?? null,
    sourcePath: (row['source_path'] as string | null) ?? null,
    destDriveId: (row['dest_drive_id'] as string | null) ?? null,
    destPath: (row['dest_path'] as string | null) ?? null,
    preHash: (row['pre_hash'] as string | null) ?? null,
    postHash: (row['post_hash'] as string | null) ?? null,
    quarantinePath: (row['quarantine_path'] as string | null) ?? null,
    status: row['status'] as OperationStatus,
    errorMessage: (row['error_message'] as string | null) ?? null,
  };
}
