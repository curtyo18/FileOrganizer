import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo, type UpsertFileInput } from '../catalog/files-repo.js';
import { detectDuplicates } from './detect.js';

let dir: string;
let db: Catalog;
let driveId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-dedup-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  driveId = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  }).id;
  db.prepare(
    `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
  ).run('s1', driveId, new Date().toISOString(), 'completed', 'balanced');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function f(path: string, sha: string, size = 100): UpsertFileInput {
  return {
    driveId,
    path,
    name: path.split('/').pop()!,
    extension: 'jpg',
    sizeBytes: size,
    category: 'image',
    sha256: sha,
    mtime: '2024-01-01T00:00:00.000Z',
    ctime: '2024-01-01T00:00:00.000Z',
    exifDate: null,
    dateSource: 'mtime',
    width: null,
    height: null,
    durationSeconds: null,
    ntfsFileId: null,
    state: 'indexed',
    scanId: 's1',
  };
}

describe('detectDuplicates', () => {
  it('returns groups of files sharing a hash', () => {
    const files = new FilesRepo(db);
    files.upsertOne(f('/a.jpg', 'h1'));
    files.upsertOne(f('/b.jpg', 'h1'));
    files.upsertOne(f('/c.jpg', 'h2'));
    files.upsertOne(f('/d.jpg', 'h3'));
    files.upsertOne(f('/e.jpg', 'h3'));
    files.upsertOne(f('/g.jpg', 'h3'));
    const groups = detectDuplicates(db, { minSizeBytes: 0 });
    expect(groups).toHaveLength(2);
    expect(groups[0]!.copies.length).toBe(3);
    expect(groups[1]!.copies.length).toBe(2);
  });

  it('orders groups by reclaimable bytes descending', () => {
    const files = new FilesRepo(db);
    files.upsertOne(f('/a.jpg', 'small1', 10));
    files.upsertOne(f('/b.jpg', 'small1', 10));
    files.upsertOne(f('/c.jpg', 'big1', 1_000_000));
    files.upsertOne(f('/d.jpg', 'big1', 1_000_000));
    const groups = detectDuplicates(db, { minSizeBytes: 0 });
    expect(groups[0]!.sha256).toBe('big1');
  });

  it('skips groups below minSizeBytes', () => {
    const files = new FilesRepo(db);
    files.upsertOne(f('/a.jpg', 'h1', 100));
    files.upsertOne(f('/b.jpg', 'h1', 100));
    expect(detectDuplicates(db, { minSizeBytes: 200 })).toHaveLength(0);
    expect(detectDuplicates(db, { minSizeBytes: 50 })).toHaveLength(1);
  });

  it('excludes zero-byte files', () => {
    const files = new FilesRepo(db);
    files.upsertOne(f('/a.jpg', 'h1', 0));
    files.upsertOne(f('/b.jpg', 'h1', 0));
    expect(detectDuplicates(db, { minSizeBytes: 0 })).toHaveLength(0);
  });
});
