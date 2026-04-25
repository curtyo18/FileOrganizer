import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo, type UpsertFileInput } from './files-repo.js';

let dir: string;
let db: Catalog;
let driveId: string;
let scanId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-files-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  const drive = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  });
  driveId = drive.id;
  scanId = 'test-scan-1';
  db.prepare(
    `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
  ).run(scanId, driveId, new Date().toISOString(), 'running', 'balanced');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function input(path: string, sha: string, mtime: string): UpsertFileInput {
  return {
    driveId,
    path,
    name: path.split('/').pop()!,
    extension: 'jpg',
    sizeBytes: 100,
    category: 'image',
    sha256: sha,
    mtime,
    ctime: mtime,
    exifDate: null,
    dateSource: 'mtime',
    width: null,
    height: null,
    durationSeconds: null,
    ntfsFileId: null,
    state: 'indexed',
    scanId,
  };
}

describe('FilesRepo', () => {
  it('upsertOne inserts a new file', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const row = repo.findByPath(driveId, '/a.jpg');
    expect(row).not.toBeNull();
    expect(row!.sha256).toBe('h1');
  });

  it('upsertOne replaces on (drive,path) collision', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    repo.upsertOne(input('/a.jpg', 'h2', '2024-02-01T00:00:00.000Z'));
    const row = repo.findByPath(driveId, '/a.jpg');
    expect(row!.sha256).toBe('h2');
  });

  it('quickCheck returns "skip" for unchanged file', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const r = repo.quickCheck(driveId, '/a.jpg', 100, '2024-01-01T00:00:00.000Z');
    expect(r.kind).toBe('skip');
  });

  it('quickCheck returns "rehash" when size or mtime differs', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    expect(repo.quickCheck(driveId, '/a.jpg', 200, '2024-01-01T00:00:00.000Z').kind).toBe('rehash');
    expect(repo.quickCheck(driveId, '/a.jpg', 100, '2024-02-01T00:00:00.000Z').kind).toBe('rehash');
  });

  it('quickCheck returns "new" for unknown path', () => {
    const repo = new FilesRepo(db);
    expect(repo.quickCheck(driveId, '/x.jpg', 1, '2024-01-01T00:00:00.000Z').kind).toBe('new');
  });

  it('markMissing flips state for files not seen in current scan', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');
    repo.markMissing(driveId, newScanId);
    const row = repo.findByPath(driveId, '/a.jpg');
    expect(row!.state).toBe('missing');
  });
});
