import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { EmptyDirsRepo } from '../catalog/empty-dirs-repo.js';
import { findEmptyDirs, removeEmptyDirs } from './empty-dirs.js';

let dir: string;
let db: Catalog;
let driveId: string;
let scanId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-empty-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  driveId = 'd1';
  scanId = 's1';
  db.prepare(
    `INSERT INTO drives (id, volume_serial, label, current_letter, kind, last_seen_at)
     VALUES (?, 'S1', 'D1', 'D', 'local', '2026-01-01T00:00:00Z')`,
  ).run(driveId);
  db.prepare(
    `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
     VALUES (?, ?, '2026-01-01T00:00:00Z', 'completed', 'balanced')`,
  ).run(scanId, driveId);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('findEmptyDirs', () => {
  it('returns empty_dirs rows for the drive ordered deepest-first', () => {
    const repo = new EmptyDirsRepo(db);
    repo.upsert(driveId, '/x/a', scanId, '2026-01-01T00:00:00Z');
    repo.upsert(driveId, '/x/a/b/c', scanId, '2026-01-01T00:00:00Z');
    repo.upsert(driveId, '/x/a/b', scanId, '2026-01-01T00:00:00Z');

    const result = findEmptyDirs(db, driveId);
    expect(result.paths).toEqual(['/x/a/b/c', '/x/a/b', '/x/a']);
    expect(result.totalEmpty).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('flags truncated when the row count exceeds cap', () => {
    const repo = new EmptyDirsRepo(db);
    for (let i = 0; i < 30; i += 1) {
      repo.upsert(driveId, `/x/dir-${String(i).padStart(2, '0')}`, scanId, '2026-01-01T00:00:00Z');
    }
    const result = findEmptyDirs(db, driveId, { cap: 10 });
    expect(result.paths).toHaveLength(10);
    expect(result.totalEmpty).toBe(30);
    expect(result.truncated).toBe(true);
  });

  it('isolates results per drive', () => {
    db.prepare(
      `INSERT INTO drives (id, volume_serial, label, current_letter, kind, last_seen_at)
       VALUES ('d2', 'S2', 'D2', 'E', 'local', '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES ('s2', 'd2', '2026-01-01T00:00:00Z', 'completed', 'balanced')`,
    ).run();
    const repo = new EmptyDirsRepo(db);
    repo.upsert(driveId, '/x/a', scanId, '2026-01-01T00:00:00Z');
    repo.upsert('d2', '/y/b', 's2', '2026-01-01T00:00:00Z');

    expect(findEmptyDirs(db, driveId).paths).toEqual(['/x/a']);
    expect(findEmptyDirs(db, 'd2').paths).toEqual(['/y/b']);
  });

  it('returns an empty result when the drive has no rows', () => {
    const result = findEmptyDirs(db, driveId);
    expect(result).toEqual({ paths: [], totalEmpty: 0, truncated: false });
  });
});

describe('removeEmptyDirs', () => {
  it('removes the listed empty paths and records each as a delete op', () => {
    const root = join(dir, 'remove');
    const a = join(root, 'a', 'b');
    const c = join(root, 'c');
    mkdirSync(a, { recursive: true });
    mkdirSync(c, { recursive: true });

    const result = removeEmptyDirs(db, {
      driveRoot: root,
      paths: [join(root, 'a'), a, c],
    });

    expect(result.removed).toBe(3);
    expect(result.failed).toHaveLength(0);
    expect(existsSync(a)).toBe(false);
    expect(existsSync(join(root, 'a'))).toBe(false);
    expect(existsSync(c)).toBe(false);

    const ops = db
      .prepare(`SELECT kind, status, source_path FROM operations WHERE batch_id = ?`)
      .all(result.batchId) as { kind: string; status: string; source_path: string }[];
    expect(ops.length).toBe(3);
    for (const op of ops) {
      expect(op.kind).toBe('delete');
      expect(op.status).toBe('completed');
    }
  });

  it('records "not empty" failure for paths that became non-empty between scan and apply', () => {
    const root = join(dir, 'race');
    const stable = join(root, 'stable');
    const racy = join(root, 'racy');
    mkdirSync(stable, { recursive: true });
    mkdirSync(racy, { recursive: true });
    writeFileSync(join(racy, 'late.txt'), 'oops');

    const result = removeEmptyDirs(db, {
      driveRoot: root,
      paths: [stable, racy],
    });

    expect(result.removed).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.path).toBe(racy);
    expect(result.failed[0]!.reason).toBe('not empty');
    expect(existsSync(stable)).toBe(false);
    expect(existsSync(racy)).toBe(true);
  });

  it('rejects paths that escape the drive root via ..', () => {
    const root = join(dir, 'guard');
    mkdirSync(root, { recursive: true });
    const outside = join(dir, 'outside');
    mkdirSync(outside, { recursive: true });

    const result = removeEmptyDirs(db, {
      driveRoot: root,
      paths: [join(root, '..', 'outside')],
    });

    expect(result.removed).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toBe('path escapes drive root');
    expect(existsSync(outside)).toBe(true);
  });
});
