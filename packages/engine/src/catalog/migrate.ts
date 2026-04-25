import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Catalog } from './connection.js';
import { CatalogError } from '@fileorganizer/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function currentSchemaVersion(db: Catalog): number {
  const tableExists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`,
    )
    .get() as { name: string } | undefined;
  if (!tableExists) return 0;
  const row = db
    .prepare(`SELECT MAX(version) AS v FROM schema_version`)
    .get() as { v: number | null };
  return row.v ?? 0;
}

export function migrate(db: Catalog): void {
  const current = currentSchemaVersion(db);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file.slice(0, 4), 10);
    if (version <= current) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(
        version,
        new Date().toISOString(),
      );
    });
    try {
      tx();
    } catch (err) {
      throw new CatalogError(
        'MIGRATION_FAILED',
        `migration ${file} failed: ${(err as Error).message}`,
        err,
      );
    }
  }
}
