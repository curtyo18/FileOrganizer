import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog } from './connection.js';
import { migrate, currentSchemaVersion } from './migrate.js';

const tmpDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fileorg-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('migrate', () => {
  it('applies all migrations to a fresh database', () => {
    const db = openCatalog(join(freshDir(), 'catalog.db'));
    migrate(db);
    expect(currentSchemaVersion(db)).toBeGreaterThanOrEqual(1);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const t of [
      'drives', 'scans', 'files', 'rules', 'batches', 'operations',
      'quarantine', 'settings', 'schema_version',
    ]) {
      expect(names).toContain(t);
    }
    closeCatalog(db);
  });

  it('is idempotent on a migrated database', () => {
    const path = join(freshDir(), 'catalog.db');
    const db = openCatalog(path);
    migrate(db);
    const v1 = currentSchemaVersion(db);
    migrate(db);
    const v2 = currentSchemaVersion(db);
    expect(v1).toBe(v2);
    closeCatalog(db);
  });
});
