import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CatalogError } from '@fileorganizer/shared';

export type Catalog = Database.Database;

export function openCatalog(path: string): Catalog {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (err) {
    throw new CatalogError(
      'CATALOG_OPEN_FAILED',
      `failed to open catalog at ${path}: ${(err as Error).message}`,
      err,
    );
  }
}

export function closeCatalog(db: Catalog): void {
  db.close();
}

export function assertCatalogHealthy(db: Catalog, catalogPath?: string): void {
  const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const allOk = rows.length === 1 && rows[0]?.integrity_check === 'ok';
  if (!allOk) {
    const detail = rows.map((r) => r.integrity_check).join('; ');
    const location = catalogPath ? ` at ${catalogPath}` : '';
    throw new CatalogError(
      'CATALOG_CORRUPT',
      `CATALOG_CORRUPT: catalog${location} failed integrity_check — ${detail}\n` +
        `To rebuild, see https://github.com/curtyo18/FileOrganizer/wiki/recovering-a-corrupt-catalog`,
    );
  }
}
