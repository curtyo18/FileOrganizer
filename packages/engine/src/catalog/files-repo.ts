import type { Catalog } from './connection.js';
import type { Category, DateSource, FileRecord, FileState } from '@fileorganizer/shared';

export interface UpsertFileInput {
  driveId: string;
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  category: Category;
  sha256: string;
  mtime: string;
  ctime: string;
  exifDate: string | null;
  dateSource: DateSource;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  ntfsFileId: string | null;
  state: FileState;
  scanId: string;
}

export type QuickCheckResult =
  | { kind: 'skip'; fileId: number }
  | { kind: 'rehash'; fileId: number }
  | { kind: 'new' };

export class FilesRepo {
  constructor(private readonly db: Catalog) {}

  upsertOne(input: UpsertFileInput): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO files (
          drive_id, path, name, extension, size_bytes, category, sha256,
          mtime, ctime, exif_date, date_source, width, height, duration_seconds,
          ntfs_file_id, state, last_verified_at, scan_id
        ) VALUES (
          @driveId, @path, @name, @extension, @sizeBytes, @category, @sha256,
          @mtime, @ctime, @exifDate, @dateSource, @width, @height, @durationSeconds,
          @ntfsFileId, @state, @lastVerifiedAt, @scanId
        )
        ON CONFLICT(drive_id, path) DO UPDATE SET
          name = excluded.name,
          extension = excluded.extension,
          size_bytes = excluded.size_bytes,
          category = excluded.category,
          sha256 = excluded.sha256,
          mtime = excluded.mtime,
          ctime = excluded.ctime,
          exif_date = excluded.exif_date,
          date_source = excluded.date_source,
          width = excluded.width,
          height = excluded.height,
          duration_seconds = excluded.duration_seconds,
          ntfs_file_id = excluded.ntfs_file_id,
          state = excluded.state,
          last_verified_at = excluded.last_verified_at,
          scan_id = excluded.scan_id`,
      )
      .run({ ...input, lastVerifiedAt: now });
  }

  quickCheck(
    driveId: string,
    path: string,
    sizeBytes: number,
    mtime: string,
  ): QuickCheckResult {
    const row = this.db
      .prepare(`SELECT id, size_bytes, mtime FROM files WHERE drive_id = ? AND path = ?`)
      .get(driveId, path) as { id: number; size_bytes: number; mtime: string } | undefined;
    if (!row) return { kind: 'new' };
    if (row.size_bytes === sizeBytes && row.mtime === mtime) {
      return { kind: 'skip', fileId: row.id };
    }
    return { kind: 'rehash', fileId: row.id };
  }

  bumpLastVerified(fileId: number, scanId: string): void {
    this.db
      .prepare(`UPDATE files SET last_verified_at = ?, scan_id = ?, state = 'indexed' WHERE id = ?`)
      .run(new Date().toISOString(), scanId, fileId);
  }

  findByPath(driveId: string, path: string): FileRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM files WHERE drive_id = ? AND path = ?`)
      .get(driveId, path) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : null;
  }

  markMissing(driveId: string, currentScanId: string): number {
    const result = this.db
      .prepare(
        `UPDATE files SET state = 'missing'
         WHERE drive_id = ? AND scan_id != ? AND state = 'indexed'`,
      )
      .run(driveId, currentScanId);
    return result.changes;
  }
}

function toRecord(row: Record<string, unknown>): FileRecord {
  return {
    id: row['id'] as number,
    driveId: row['drive_id'] as string,
    path: row['path'] as string,
    name: row['name'] as string,
    extension: row['extension'] as string,
    sizeBytes: row['size_bytes'] as number,
    category: row['category'] as Category,
    sha256: row['sha256'] as string,
    mtime: row['mtime'] as string,
    ctime: row['ctime'] as string,
    exifDate: (row['exif_date'] as string | null) ?? null,
    dateSource: row['date_source'] as DateSource,
    width: (row['width'] as number | null) ?? null,
    height: (row['height'] as number | null) ?? null,
    durationSeconds: (row['duration_seconds'] as number | null) ?? null,
    ntfsFileId: (row['ntfs_file_id'] as string | null) ?? null,
    state: row['state'] as FileState,
    lastVerifiedAt: row['last_verified_at'] as string,
    scanId: row['scan_id'] as string,
  };
}
