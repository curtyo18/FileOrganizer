import { readPointer } from '../catalog/locator.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { CatalogError } from '@fileorganizer/shared';

export interface StatusOptions {
  pointerPath: string;
}

export interface StatusResult {
  driveCount: number;
  catalogPath: string;
  drives: { label: string; serial: string; sizeBytes: number; freeBytes: number }[];
}

export function runStatus(opts: StatusOptions): StatusResult {
  const ptr = readPointer(opts.pointerPath);
  if (!ptr) {
    throw new CatalogError('POINTER_MISSING', `no catalog pointer at ${opts.pointerPath}`);
  }
  const db = openCatalog(ptr.catalogPath);
  try {
    migrate(db);
    const drives = new DriveRepo(db).list();
    return {
      driveCount: drives.length,
      catalogPath: ptr.catalogPath,
      drives: drives.map((d) => ({
        label: d.label,
        serial: d.volumeSerial,
        sizeBytes: d.totalBytes,
        freeBytes: d.freeBytes,
      })),
    };
  } finally {
    closeCatalog(db);
  }
}

export function formatStatus(s: StatusResult): string {
  const lines: string[] = [];
  lines.push(`Catalog: ${s.catalogPath}`);
  lines.push(`Drives: ${s.driveCount}`);
  for (const d of s.drives) {
    lines.push(`  - ${d.label} [${d.serial}] ${formatBytes(d.freeBytes)} free of ${formatBytes(d.sizeBytes)}`);
  }
  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
