import { randomUUID } from 'node:crypto';
import type { Catalog } from '../catalog/connection.js';
import type { DriveRecord, DriveKind } from '@fileorganizer/shared';

export interface UpsertDriveInput {
  volumeSerial: string;
  label: string;
  currentLetter: string | null;
  mountPath?: string | null;
  kind: DriveKind;
  roles: string[];
  totalBytes: number;
  freeBytes: number;
}

export class DriveRepo {
  constructor(private readonly db: Catalog) {}

  upsert(input: UpsertDriveInput): DriveRecord {
    const existing = this.db
      .prepare(`SELECT * FROM drives WHERE volume_serial = ?`)
      .get(input.volumeSerial) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    if (existing) {
      // Preserve an existing mount_path if the upsert call doesn't supply one.
      const mountPath =
        input.mountPath !== undefined ? input.mountPath : (existing['mount_path'] as string | null);
      this.db
        .prepare(
          `UPDATE drives SET label = ?, current_letter = ?, mount_path = ?, kind = ?, roles = ?,
           total_bytes = ?, free_bytes = ?, last_seen_at = ? WHERE id = ?`,
        )
        .run(
          input.label,
          input.currentLetter,
          mountPath,
          input.kind,
          JSON.stringify(input.roles),
          input.totalBytes,
          input.freeBytes,
          now,
          existing['id'] as string,
        );
      return this.findById(existing['id'] as string)!;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO drives (id, volume_serial, label, current_letter, mount_path, kind, roles,
         total_bytes, free_bytes, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.volumeSerial,
        input.label,
        input.currentLetter,
        input.mountPath ?? null,
        input.kind,
        JSON.stringify(input.roles),
        input.totalBytes,
        input.freeBytes,
        now,
      );
    return this.findById(id)!;
  }

  findById(id: string): DriveRecord | null {
    const row = this.db.prepare(`SELECT * FROM drives WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.toRecord(row) : null;
  }

  list(): DriveRecord[] {
    const rows = this.db.prepare(`SELECT * FROM drives ORDER BY label`).all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.toRecord(r));
  }

  private toRecord(row: Record<string, unknown>): DriveRecord {
    return {
      id: row['id'] as string,
      volumeSerial: row['volume_serial'] as string,
      label: row['label'] as string,
      currentLetter: (row['current_letter'] as string | null) ?? null,
      mountPath: (row['mount_path'] as string | null) ?? null,
      kind: row['kind'] as DriveKind,
      roles: JSON.parse((row['roles'] as string) || '[]') as string[],
      totalBytes: row['total_bytes'] as number,
      freeBytes: row['free_bytes'] as number,
      lastSeenAt: row['last_seen_at'] as string,
      connected: false,
    };
  }
}
