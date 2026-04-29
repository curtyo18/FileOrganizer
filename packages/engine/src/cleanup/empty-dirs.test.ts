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
import { findEmptyDirs, removeEmptyDirs } from './empty-dirs.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-empty-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('findEmptyDirs', () => {
  it('returns recursively-empty directories sorted deepest-first', () => {
    const root = join(dir, 'tree');
    mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true });
    mkdirSync(join(root, 'd', 'e'), { recursive: true });
    mkdirSync(join(root, 'has-file'), { recursive: true });
    writeFileSync(join(root, 'has-file', 'x.txt'), 'x');
    mkdirSync(join(root, 'mixed', 'sibling-empty'), { recursive: true });
    writeFileSync(join(root, 'mixed', 'leaf.txt'), 'leaf');

    const result = findEmptyDirs(root);

    const paths = result.paths;
    expect(paths).toContain(join(root, 'a', 'b', 'c'));
    expect(paths).toContain(join(root, 'd', 'e'));
    expect(paths).toContain(join(root, 'mixed', 'sibling-empty'));
    expect(paths).not.toContain(join(root, 'has-file'));
    expect(paths).not.toContain(join(root, 'mixed'));

    for (let i = 1; i < paths.length; i += 1) {
      expect(paths[i - 1]!.length).toBeGreaterThanOrEqual(paths[i]!.length);
    }

    expect(result.totalEmpty).toBe(paths.length);
    expect(result.truncated).toBe(false);
  });

  it('skips excluded names like node_modules and quarantine', () => {
    const root = join(dir, 'with-excludes');
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, '_FileOrganizer_quarantine', 'old'), { recursive: true });
    mkdirSync(join(root, 'real-empty'), { recursive: true });

    const result = findEmptyDirs(root);
    expect(result.paths).toContain(join(root, 'real-empty'));
    expect(result.paths).not.toContain(join(root, 'node_modules', 'pkg'));
    expect(result.paths).not.toContain(join(root, '_FileOrganizer_quarantine', 'old'));
  });

  it('flags truncated when the count exceeds cap', () => {
    const root = join(dir, 'big');
    for (let i = 0; i < 30; i += 1) {
      mkdirSync(join(root, `dir-${i}`), { recursive: true });
    }
    const result = findEmptyDirs(root, { cap: 10 });
    expect(result.paths.length).toBeLessThanOrEqual(10);
    expect(result.truncated).toBe(true);
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
