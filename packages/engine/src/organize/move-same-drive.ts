import { mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Catalog } from '../catalog/connection.js';

export interface MoveSameDriveInput {
  db: Catalog;
  fileId: number;
  destPath: string;
}

export function moveSameDrive(input: MoveSameDriveInput): void {
  const row = input.db
    .prepare(`SELECT path FROM files WHERE id = ?`)
    .get(input.fileId) as { path: string } | undefined;
  if (!row) throw new Error(`file ${input.fileId} not found`);
  mkdirSync(dirname(input.destPath), { recursive: true });
  renameSync(row.path, input.destPath);
  input.db
    .prepare(`UPDATE files SET path = ?, state = 'moved' WHERE id = ?`)
    .run(input.destPath, input.fileId);
}
