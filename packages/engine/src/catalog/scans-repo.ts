import { randomUUID } from 'node:crypto';
import type { Catalog } from './connection.js';
import type {
  ScanProgress,
  ScanRecord,
  ScanStats,
  ScanStatus,
  ThrottleProfileName,
} from '@fileorganizer/shared';

export interface StartScanInput {
  driveId: string;
  rootPaths: string[];
  throttleProfile: ThrottleProfileName;
}

const EMPTY_PROGRESS: ScanProgress = {
  lastCompletedDirectory: null,
  filesSeen: 0,
  filesIndexed: 0,
  filesSkipped: 0,
  bytesProcessed: 0,
};

const EMPTY_STATS: ScanStats = { ...EMPTY_PROGRESS, errors: 0 };

export class ScansRepo {
  constructor(private readonly db: Catalog) {}

  start(input: StartScanInput): ScanRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scans (id, drive_id, started_at, status, root_paths, throttle_profile, progress, stats)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.driveId,
        now,
        JSON.stringify(input.rootPaths),
        input.throttleProfile,
        JSON.stringify(EMPTY_PROGRESS),
        JSON.stringify(EMPTY_STATS),
      );
    return this.findById(id)!;
  }

  updateProgress(id: string, progress: ScanProgress): void {
    this.db
      .prepare(`UPDATE scans SET progress = ? WHERE id = ?`)
      .run(JSON.stringify(progress), id);
  }

  finish(id: string, status: ScanStatus, statsOverride: Partial<ScanStats>): void {
    // Merge stats atomically in a single UPDATE to eliminate the TOCTOU window
    // that existed when finish() called findById() then UPDATE separately.
    // SQLite json_patch(progress, override) merges the caller-supplied override
    // onto the existing progress column in one statement — no pre-read needed.
    // We apply two patches: first overlay {"errors":0} onto progress (so the
    // baseline stats mirror the last progress snapshot), then overlay the
    // caller's statsOverride to honour any explicit values.
    this.db
      .prepare(
        `UPDATE scans
            SET status = ?,
                finished_at = ?,
                stats = json_patch(json_patch(progress, '{"errors":0}'), ?)
          WHERE id = ?`,
      )
      .run(status, new Date().toISOString(), JSON.stringify(statsOverride), id);
  }

  pause(id: string): void {
    this.db.prepare(`UPDATE scans SET status = 'paused' WHERE id = ?`).run(id);
  }

  findById(id: string): ScanRecord | null {
    const row = this.db.prepare(`SELECT * FROM scans WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toRecord(row) : null;
  }

  hasRunning(driveId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM scans WHERE drive_id = ? AND status = 'running' LIMIT 1`)
      .get(driveId) as { 1: number } | undefined;
    return row !== undefined;
  }

  list(opts: { driveId?: string; limit?: number } = {}): ScanRecord[] {
    const limit = opts.limit ?? 100;
    const rows = (opts.driveId
      ? this.db
          .prepare(`SELECT * FROM scans WHERE drive_id = ? ORDER BY started_at DESC LIMIT ?`)
          .all(opts.driveId, limit)
      : this.db
          .prepare(`SELECT * FROM scans ORDER BY started_at DESC LIMIT ?`)
          .all(limit)) as Record<string, unknown>[];
    return rows.map(toRecord);
  }
}

function toRecord(row: Record<string, unknown>): ScanRecord {
  return {
    id: row['id'] as string,
    driveId: row['drive_id'] as string,
    startedAt: row['started_at'] as string,
    finishedAt: (row['finished_at'] as string | null) ?? null,
    status: row['status'] as ScanStatus,
    rootPaths: JSON.parse((row['root_paths'] as string) || '[]') as string[],
    throttleProfile: row['throttle_profile'] as ThrottleProfileName,
    progress: JSON.parse((row['progress'] as string) || '{}') as ScanProgress,
    stats: JSON.parse((row['stats'] as string) || '{}') as ScanStats,
  };
}
