import type { Catalog } from './connection.js';

export interface EmptyDirsListResult {
  paths: string[];
  totalEmpty: number;
  truncated: boolean;
}

const DEFAULT_LIST_CAP = 5000;

export class EmptyDirsRepo {
  constructor(private readonly db: Catalog) {}

  upsert(driveId: string, path: string, scanId: string, foundAt: string): void {
    this.db
      .prepare(
        `INSERT INTO empty_dirs (drive_id, path, last_seen_scan_id, found_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(drive_id, path) DO UPDATE SET
           last_seen_scan_id = excluded.last_seen_scan_id,
           found_at = excluded.found_at`,
      )
      .run(driveId, path, scanId, foundAt);
  }

  pruneStale(driveId: string, currentScanId: string): number {
    const result = this.db
      .prepare(`DELETE FROM empty_dirs WHERE drive_id = ? AND last_seen_scan_id != ?`)
      .run(driveId, currentScanId);
    return Number(result.changes);
  }

  listForDrive(driveId: string, cap?: number | null): EmptyDirsListResult {
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM empty_dirs WHERE drive_id = ?`)
      .get(driveId) as { n: number };
    const totalEmpty = totalRow.n;
    const rows =
      cap === null
        ? (this.db
            .prepare(
              `SELECT path FROM empty_dirs WHERE drive_id = ?
               ORDER BY LENGTH(path) DESC, path ASC`,
            )
            .all(driveId) as { path: string }[])
        : (this.db
            .prepare(
              `SELECT path FROM empty_dirs WHERE drive_id = ?
               ORDER BY LENGTH(path) DESC, path ASC
               LIMIT ?`,
            )
            .all(driveId, cap ?? DEFAULT_LIST_CAP) as { path: string }[]);
    return {
      paths: rows.map((r) => r.path),
      totalEmpty,
      truncated: cap !== null && totalEmpty > rows.length,
    };
  }
}
