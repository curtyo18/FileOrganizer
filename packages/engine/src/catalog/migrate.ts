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

export function migrate(db: Catalog, migrationsDir: string = MIGRATIONS_DIR): void {
  const current = currentSchemaVersion(db);
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file.slice(0, 4), 10);
    if (version <= current) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    // Schema-rebuild migrations (e.g. CHECK constraint widening via the
    // CREATE/INSERT/DROP/RENAME dance) hit "FOREIGN KEY constraint failed"
    // on the DROP step when the rebuilt table is referenced by another
    // table's FK. SQLite enforces this schema-level check at DROP time
    // regardless of `defer_foreign_keys`, and `PRAGMA foreign_keys` can't
    // be toggled inside a transaction. Disable FKs around each migration's
    // transaction, then re-enable and verify integrity with foreign_key_check.
    db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        db.exec(sql);
        // FK check INSIDE the transaction so a violation rolls back the
        // schema_version insert along with the migration itself.
        const violations = db.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new CatalogError(
            'MIGRATION_FK_VIOLATIONS',
            `migration ${file} left ${violations.length} foreign-key violations`,
          );
        }
        db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(
          version,
          new Date().toISOString(),
        );
      });
      try {
        tx();
      } catch (err) {
        if (err instanceof CatalogError) throw err;
        throw new CatalogError(
          'MIGRATION_FAILED',
          `migration ${file} failed: ${(err as Error).message}`,
          err,
        );
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}
