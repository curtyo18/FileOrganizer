import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, assertCatalogHealthy } from './connection.js';
import { migrate } from './migrate.js';
import { CatalogError } from '@fileorganizer/shared';

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

describe('assertCatalogHealthy', () => {
  it('passes on a healthy migrated catalog', () => {
    const dir = freshDir();
    const path = join(dir, 'catalog.db');
    const db = openCatalog(path);
    try {
      migrate(db);
      expect(() => assertCatalogHealthy(db)).not.toThrow();
    } finally {
      closeCatalog(db);
    }
  });

  it('throws CATALOG_CORRUPT when the freelist trunk pointer is corrupted', () => {
    const dir = freshDir();
    const path = join(dir, 'catalog.db');
    // Create, migrate, and checkpoint so all pages are in the main .db file.
    const db = openCatalog(path);
    migrate(db);
    // Force a full checkpoint so WAL is empty and the main file is authoritative.
    db.pragma('wal_checkpoint(TRUNCATE)');
    closeCatalog(db);

    // SQLite file header, offset 32-35 (big-endian uint32): freelist trunk page
    // number. After migrate the freelist is non-empty (some migration scratch
    // pages end up free). Setting the trunk pointer to a non-existent page
    // number (9999) while leaving the freelist count intact creates a *logical*
    // inconsistency that PRAGMA integrity_check catches and reports as rows,
    // while still allowing the file to be opened normally (all startup PRAGMAs
    // in openCatalog succeed). Bytes 0-31 of the header (magic, page-size, etc.)
    // are untouched.
    const fd = openSync(path, 'r+');
    const corruptTrunk = Buffer.from([0x00, 0x00, 0x27, 0x0f]); // page 9999
    writeSync(fd, corruptTrunk, 0, 4, 32);
    closeSync(fd);

    const corruptDb = openCatalog(path);
    try {
      expect(() => assertCatalogHealthy(corruptDb)).toThrow(CatalogError);
      try {
        assertCatalogHealthy(corruptDb);
      } catch (err) {
        expect((err as CatalogError).code).toBe('CATALOG_CORRUPT');
        expect((err as CatalogError).message).toContain('integrity_check');
      }
    } finally {
      closeCatalog(corruptDb);
    }
  });
});

describe('openCatalog', () => {
  it('creates the database file if missing', () => {
    const dir = freshDir();
    const path = join(dir, 'catalog.db');
    const db = openCatalog(path);
    expect(db).toBeDefined();
    closeCatalog(db);
  });

  it('opens an existing database', () => {
    const dir = freshDir();
    const path = join(dir, 'catalog.db');
    const db1 = openCatalog(path);
    closeCatalog(db1);
    const db2 = openCatalog(path);
    expect(db2).toBeDefined();
    closeCatalog(db2);
  });

  it('enables WAL and foreign keys', () => {
    const dir = freshDir();
    const path = join(dir, 'catalog.db');
    const db = openCatalog(path);
    const journalMode = db.pragma('journal_mode', { simple: true });
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(journalMode).toBe('wal');
    expect(fk).toBe(1);
    closeCatalog(db);
  });
});
