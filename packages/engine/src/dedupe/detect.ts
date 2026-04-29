import type { Catalog } from '../catalog/connection.js';
import type { Category, FileState } from '@fileorganizer/shared';

export interface DuplicateCopy {
  fileId: number;
  driveId: string;
  path: string;
  sizeBytes: number;
  category: Category;
  state: FileState;
  mtime: string;
}

export interface DuplicateGroup {
  sha256: string;
  copies: DuplicateCopy[];
  fileSizeBytes: number;
  reclaimableBytes: number;
}

export interface DetectOptions {
  minSizeBytes: number;
  limit?: number;
  offset?: number;
}

export function detectDuplicates(db: Catalog, opts: DetectOptions): DuplicateGroup[] {
  const minSize = Math.max(opts.minSizeBytes, 1);
  const limit = opts.limit ?? -1;
  const offset = Math.max(opts.offset ?? 0, 0);
  const hashes = db
    .prepare(
      `SELECT sha256, COUNT(*) AS copies, MIN(size_bytes) AS size
       FROM files
       WHERE state = 'indexed' AND size_bytes >= ?
       GROUP BY sha256
       HAVING copies > 1
       ORDER BY (copies - 1) * MIN(size_bytes) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(minSize, limit, offset) as { sha256: string; copies: number; size: number }[];
  return hashes.map((row) => {
    const copies = db
      .prepare(
        `SELECT id AS fileId, drive_id AS driveId, path, size_bytes AS sizeBytes,
                category, state, mtime FROM files WHERE sha256 = ? AND state = 'indexed'`,
      )
      .all(row.sha256) as DuplicateCopy[];
    return {
      sha256: row.sha256,
      copies,
      fileSizeBytes: row.size,
      reclaimableBytes: (copies.length - 1) * row.size,
    };
  });
}

export function countDuplicateGroups(db: Catalog, opts: { minSizeBytes: number }): number {
  const minSize = Math.max(opts.minSizeBytes, 1);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total FROM (
         SELECT sha256 FROM files
         WHERE state = 'indexed' AND size_bytes >= ?
         GROUP BY sha256
         HAVING COUNT(*) > 1
       )`,
    )
    .get(minSize) as { total: number };
  return row.total;
}
