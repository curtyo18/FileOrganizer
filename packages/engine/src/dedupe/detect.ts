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
  ntfsFileId: string | null;
}

export interface DuplicateGroup {
  sha256: string;
  copies: DuplicateCopy[];
  fileSizeBytes: number;
  reclaimableBytes: number;
  samePhysicalFile?: boolean;
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
  const groups: DuplicateGroup[] = [];
  for (const row of hashes) {
    const copies = db
      .prepare(
        `SELECT id AS fileId, drive_id AS driveId, path, size_bytes AS sizeBytes,
                category, state, mtime, ntfs_file_id AS ntfsFileId
         FROM files WHERE sha256 = ? AND state = 'indexed'`,
      )
      .all(row.sha256) as DuplicateCopy[];

    // Collapse hardlinks: files on the same drive with the same ntfsFileId share
    // physical bytes. Keep one representative per (driveId, ntfsFileId) where
    // ntfsFileId is non-null; treat null ntfsFileIds as distinct physical files
    // (POSIX or pre-population legacy rows).
    const seen = new Set<string>();
    const collapsed: DuplicateCopy[] = [];
    let collapsedAny = false;
    for (const copy of copies) {
      if (copy.ntfsFileId != null) {
        const key = `${copy.driveId}:${copy.ntfsFileId}`;
        if (seen.has(key)) {
          collapsedAny = true;
          continue; // drop hardlinked duplicate
        }
        seen.add(key);
      }
      collapsed.push(copy);
    }

    if (collapsed.length < 2) continue; // not actually duplicates after collapse

    const distinctSize = collapsed[0]!.sizeBytes;
    const reclaimableBytes = (collapsed.length - 1) * distinctSize;
    const group: DuplicateGroup = {
      sha256: row.sha256,
      copies: collapsed,
      fileSizeBytes: distinctSize,
      reclaimableBytes,
    };
    if (collapsedAny) {
      group.samePhysicalFile = true;
    }
    groups.push(group);
  }
  return groups;
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
