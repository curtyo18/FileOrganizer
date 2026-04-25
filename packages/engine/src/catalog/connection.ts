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
