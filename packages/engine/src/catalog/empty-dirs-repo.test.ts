import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { EmptyDirsRepo } from './empty-dirs-repo.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-empty-repo-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  db.prepare(
    `INSERT INTO drives (id, volume_serial, label, current_letter, kind, last_seen_at)
     VALUES ('d1', 'S1', 'D1', 'D', 'local', '2026-01-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO drives (id, volume_serial, label, current_letter, kind, last_seen_at)
     VALUES ('d2', 'S2', 'D2', 'E', 'local', '2026-01-01T00:00:00Z')`,
  ).run();
  for (const id of ['s1', 's2', 's3']) {
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, 'd1', '2026-01-01T00:00:00Z', 'completed', 'balanced')`,
    ).run(id);
  }
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('EmptyDirsRepo.upsert', () => {
  it('inserts a new row', () => {
    const repo = new EmptyDirsRepo(db);
    repo.upsert('d1', '/a/b/c', 's1', '2026-01-01T00:00:00Z');
    const row = db
      .prepare(
        `SELECT path, last_seen_scan_id AS scanId, found_at AS foundAt
         FROM empty_dirs WHERE drive_id = 'd1'`,
      )
      .get() as { path: string; scanId: string; foundAt: string };
    expect(row.path).toBe('/a/b/c');
    expect(row.scanId).toBe('s1');
    expect(row.foundAt).toBe('2026-01-01T00:00:00Z');
  });

  it('is idempotent on the same (drive_id, path)', () => {
    const repo = new EmptyDirsRepo(db);
    repo.upsert('d1', '/a', 's1', '2026-01-01T00:00:00Z');
    repo.upsert('d1', '/a', 's1', '2026-01-02T00:00:00Z');
    const count = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM empty_dirs WHERE drive_id = 'd1'`)
        .get() as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  it('overwrites last_seen_scan_id and found_at on conflict', () => {
    const repo = new EmptyDirsRepo(db);
    repo.upsert('d1', '/a', 's1', '2026-01-01T00:00:00Z');
    repo.upsert('d1', '/a', 's2', '2026-02-01T00:00:00Z');
    const row = db
      .prepare(
        `SELECT last_seen_scan_id AS scanId, found_at AS foundAt
         FROM empty_dirs WHERE drive_id = 'd1' AND path = '/a'`,
      )
      .get() as { scanId: string; foundAt: string };
    expect(row.scanId).toBe('s2');
    expect(row.foundAt).toBe('2026-02-01T00:00:00Z');
  });
});

describe('EmptyDirsRepo.pruneStale', () => {
  it('deletes rows whose last_seen_scan_id != currentScanId', () => {
    const repo = new EmptyDirsRepo(db);
    repo.upsert('d1', '/a', 's1', '2026-01-01T00:00:00Z');
    repo.upsert('d1', '/b', 's2', '2026-02-01T00:00:00Z');
    repo.upsert('d1', '/c', 's2', '2026-02-01T00:00:00Z');
    const removed = repo.pruneStale('d1', 's2');
    expect(removed).toBe(1);
    const remaining = db
      .prepare(`SELECT path FROM empty_dirs WHERE drive_id = 'd1' ORDER BY path`)
      .all() as { path: string }[];
    expect(remaining.map((r) => r.path)).toEqual(['/b', '/c']);
  });

  it('only touches the requested drive', () => {
    const repo = new EmptyDirsRepo(db);
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES ('s2-d2', 'd2', '2026-01-01T00:00:00Z', 'completed', 'balanced')`,
    ).run();
    repo.upsert('d1', '/a', 's1', '2026-01-01T00:00:00Z');
    repo.upsert('d2', '/x', 's2-d2', '2026-01-01T00:00:00Z');
    repo.pruneStale('d1', 's2');
    const d2 = db
      .prepare(`SELECT path FROM empty_dirs WHERE drive_id = 'd2'`)
      .all() as { path: string }[];
    expect(d2.map((r) => r.path)).toEqual(['/x']);
  });
});

describe('EmptyDirsRepo.listForDrive', () => {
  it('returns paths ordered deepest-first by string length', () => {
    const repo = new EmptyDirsRepo(db);
    repo.upsert('d1', '/a', 's1', '2026-01-01T00:00:00Z');
    repo.upsert('d1', '/a/b/c', 's1', '2026-01-01T00:00:00Z');
    repo.upsert('d1', '/a/b', 's1', '2026-01-01T00:00:00Z');
    const result = repo.listForDrive('d1');
    expect(result.paths).toEqual(['/a/b/c', '/a/b', '/a']);
    expect(result.totalEmpty).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('respects an explicit cap and flags truncation', () => {
    const repo = new EmptyDirsRepo(db);
    for (let i = 0; i < 12; i += 1) {
      repo.upsert('d1', `/dir-${String(i).padStart(2, '0')}`, 's1', '2026-01-01T00:00:00Z');
    }
    const result = repo.listForDrive('d1', 5);
    expect(result.paths).toHaveLength(5);
    expect(result.totalEmpty).toBe(12);
    expect(result.truncated).toBe(true);
  });

  it('defaults to a 5000 cap when none is given', () => {
    const repo = new EmptyDirsRepo(db);
    repo.upsert('d1', '/only', 's1', '2026-01-01T00:00:00Z');
    const result = repo.listForDrive('d1');
    expect(result.paths).toEqual(['/only']);
    expect(result.truncated).toBe(false);
  });

  it('returns every row without truncation when cap is null', () => {
    const repo = new EmptyDirsRepo(db);
    for (let i = 0; i < 7; i += 1) {
      repo.upsert('d1', `/dir-${String(i).padStart(2, '0')}`, 's1', '2026-01-01T00:00:00Z');
    }
    const defaulted = repo.listForDrive('d1');
    expect(defaulted.paths).toHaveLength(7);
    expect(defaulted.totalEmpty).toBe(7);
    expect(defaulted.truncated).toBe(false);

    const capped = repo.listForDrive('d1', 3);
    expect(capped.paths).toHaveLength(3);
    expect(capped.totalEmpty).toBe(7);
    expect(capped.truncated).toBe(true);

    const unbounded = repo.listForDrive('d1', null);
    expect(unbounded.paths).toHaveLength(7);
    expect(unbounded.totalEmpty).toBe(7);
    expect(unbounded.truncated).toBe(false);
  });
});
