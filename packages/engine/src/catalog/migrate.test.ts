import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCatalog, closeCatalog } from './connection.js';
import { migrate, currentSchemaVersion } from './migrate.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

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

  it('migration 0004 (scans rebuild) succeeds against a populated catalog', () => {
    // Regression for the user-hit failure: 0004 rebuilds the scans table
    // (CHECK-constraint widening), and the files table has a FK on
    // scans(id). With foreign_keys=ON, DROP TABLE scans fails. Simulate by
    // applying only 0001-0003, populating drives+scans+files, then calling
    // migrate() which has 0004 left to run.
    const path = join(freshDir(), 'catalog.db');
    const db = openCatalog(path);

    // Apply 0001-0003 manually so 0004 is the only one left for migrate().
    for (const f of ['0001_initial.sql', '0002_drive_mount_path.sql', '0003_roles.sql']) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'));
    }
    const stamp = db.prepare(
      `INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`,
    );
    for (const v of [1, 2, 3]) stamp.run(v, new Date().toISOString());

    db.prepare(
      `INSERT INTO drives (id, volume_serial, label, current_letter, kind, last_seen_at)
       VALUES ('d1', 'S1', 'D1', 'D', 'local', '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES ('s1', 'd1', '2026-01-01T00:00:00Z', 'completed', 'balanced')`,
    ).run();
    db.prepare(
      `INSERT INTO files (drive_id, path, name, extension, size_bytes, category,
                          sha256, mtime, ctime, date_source, state,
                          last_verified_at, scan_id)
       VALUES ('d1', '/x/a.jpg', 'a.jpg', 'jpg', 100, 'image',
               'h', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'mtime',
               'indexed', '2026-01-01T00:00:00Z', 's1')`,
    ).run();

    // migrate() should disable FKs around the transaction so 0004's DROP/
    // RENAME succeeds, then re-enable and verify integrity.
    expect(() => migrate(db)).not.toThrow();
    expect(currentSchemaVersion(db)).toBeGreaterThanOrEqual(4);

    // The file row's FK still points at the (rebuilt) scans table.
    const file = db.prepare(`SELECT scan_id FROM files WHERE path = '/x/a.jpg'`).get() as
      | { scan_id: string }
      | undefined;
    expect(file?.scan_id).toBe('s1');

    // The new CHECK constraint admits 'cancelled'.
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES ('s2', 'd1', '2026-01-01T00:00:00Z', 'cancelled', 'balanced')`,
    ).run();
    expect(
      (db.prepare(`SELECT status FROM scans WHERE id = 's2'`).get() as { status: string }).status,
    ).toBe('cancelled');

    closeCatalog(db);
  });
});
