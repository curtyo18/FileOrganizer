import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog } from './connection.js';

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
