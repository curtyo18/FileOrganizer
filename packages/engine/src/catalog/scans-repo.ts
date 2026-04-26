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
    const existing = this.findById(id);
    if (!existing) return;
    const stats: ScanStats = { ...existing.progress, errors: 0, ...statsOverride };
    this.db
      .prepare(`UPDATE scans SET status = ?, finished_at = ?, stats = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), JSON.stringify(stats), id);
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
