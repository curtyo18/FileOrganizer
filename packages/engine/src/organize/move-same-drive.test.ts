import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { moveSameDrive } from './move-same-drive.js';

let dir: string;
let db: Catalog;
let driveId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-mv-same-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  driveId = new DriveRepo(db).upsert({
    volumeSerial: 'V',
    label: 'V',
    currentLetter: null,
    mountPath: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  }).id;
  db.prepare(
    `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('scan-1', driveId, new Date().toISOString(), 'completed', 'balanced');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function seedFile(path: string, sha = 'a'.repeat(64)): number {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, 'test-content');
  new FilesRepo(db).upsertOne({
    driveId,
    path,
    name: path.split(/[\\/]/).pop()!,
    extension: 'jpg',
    sizeBytes: 12,
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
    scanId: 'scan-1',
  });
  const row = db.prepare(`SELECT id FROM files WHERE path = ?`).get(path) as { id: number };
  return row.id;
}

describe('moveSameDrive', () => {
  it('renames the file on disk and updates the catalog row to state=moved', () => {
    const driveRoot = resolve(dir, 'V');
    const sourcePath = resolve(driveRoot, 'inbox', 'a.jpg');
    const destPath = resolve(driveRoot, 'Photos', '2023', 'a.jpg');
    const fileId = seedFile(sourcePath);

    moveSameDrive({ db, fileId, destPath });

    expect(existsSync(sourcePath)).toBe(false);
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, 'utf8')).toBe('test-content');
    const row = db.prepare(`SELECT path, state FROM files WHERE id = ?`).get(fileId) as {
      path: string;
      state: string;
    };
    expect(row.path).toBe(destPath);
    expect(row.state).toBe('moved');
  });

  it('creates intermediate destination directories', () => {
    const driveRoot = resolve(dir, 'V');
    const sourcePath = resolve(driveRoot, 'a.jpg');
    const destPath = resolve(driveRoot, 'a', 'b', 'c', 'a.jpg');
    const fileId = seedFile(sourcePath);

    moveSameDrive({ db, fileId, destPath });
    expect(existsSync(destPath)).toBe(true);
  });

  it('throws when the file id is not in the catalog', () => {
    expect(() => moveSameDrive({ db, fileId: 9999, destPath: '/x' })).toThrow(/9999/);
  });
});
