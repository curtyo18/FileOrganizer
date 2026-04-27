import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createHash,
} from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { IntegrityError } from '@fileorganizer/shared';
import { moveCrossDrive } from './move-cross-drive.js';

let dir: string;
let db: Catalog;
let sourceDriveId: string;
let destDriveId: string;
let batchId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-mv-cross-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  const drives = new DriveRepo(db);
  sourceDriveId = drives.upsert({
    volumeSerial: 'SRC',
    label: 'SRC',
    currentLetter: null,
    mountPath: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  }).id;
  destDriveId = drives.upsert({
    volumeSerial: 'DST',
    label: 'DST',
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
  ).run('scan-1', sourceDriveId, new Date().toISOString(), 'completed', 'balanced');
  batchId = 'batch-1';
  db.prepare(
    `INSERT INTO batches (id, kind, started_at, status, description, summary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(batchId, 'move', new Date().toISOString(), 'in-progress', 't', '{}');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function shaOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function seedFile(path: string, content: string, driveId: string): number {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
  new FilesRepo(db).upsertOne({
    driveId,
    path,
    name: path.split(/[\\/]/).pop()!,
    extension: 'jpg',
    sizeBytes: Buffer.byteLength(content),
    category: 'image',
    sha256: shaOf(content),
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
  return (db.prepare(`SELECT id FROM files WHERE path = ?`).get(path) as { id: number }).id;
}

describe('moveCrossDrive', () => {
  it('copies file to destination, verifies hash, quarantines source, updates row', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'a.jpg');
    const destPath = resolve(destRoot, 'Photos', '2023', 'a.jpg');
    const fileId = seedFile(sourcePath, 'hello world', sourceDriveId);

    const out = await moveCrossDrive({
      db,
      fileId,
      destPath,
      destDriveId,
      sourceDriveRoot: sourceRoot,
      batchId,
      chunkBytes: 64 * 1024,
    });

    expect(out.kind).toBe('moved');
    expect(out.finalDestPath).toBe(destPath);
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, 'utf8')).toBe('hello world');
    expect(existsSync(sourcePath)).toBe(false);

    const row = db
      .prepare(`SELECT path, drive_id AS driveId, state FROM files WHERE id = ?`)
      .get(fileId) as { path: string; driveId: string; state: string };
    expect(row.path).toBe(destPath);
    expect(row.driveId).toBe(destDriveId);
    expect(row.state).toBe('moved');

    const q = db
      .prepare(`SELECT quarantine_path FROM quarantine WHERE batch_id = ?`)
      .get(batchId) as { quarantine_path: string };
    expect(q.quarantine_path).toContain('_FileOrganizer_quarantine');
    expect(existsSync(q.quarantine_path)).toBe(true);
  });

  it('throws IntegrityError when the destination hash does not match the catalog', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'a.jpg');
    const destPath = resolve(destRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourcePath, 'real content', sourceDriveId);
    db.prepare(`UPDATE files SET sha256 = ? WHERE id = ?`).run('z'.repeat(64), fileId);

    await expect(
      moveCrossDrive({
        db,
        fileId,
        destPath,
        destDriveId,
        sourceDriveRoot: sourceRoot,
        batchId,
        chunkBytes: 64 * 1024,
      }),
    ).rejects.toBeInstanceOf(IntegrityError);
  });

  it('returns completed-via-existing without copying when destination has identical content', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'a.jpg');
    const destPath = resolve(destRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourcePath, 'identical', sourceDriveId);
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    writeFileSync(destPath, 'identical');

    const out = await moveCrossDrive({
      db,
      fileId,
      destPath,
      destDriveId,
      sourceDriveRoot: sourceRoot,
      batchId,
      chunkBytes: 64 * 1024,
    });

    expect(out.kind).toBe('completed-via-existing');
    expect(out.finalDestPath).toBe(destPath);
    expect(existsSync(sourcePath)).toBe(false);
    const q = db
      .prepare(`SELECT quarantine_path FROM quarantine WHERE batch_id = ?`)
      .get(batchId) as { quarantine_path: string };
    expect(existsSync(q.quarantine_path)).toBe(true);
    const row = db
      .prepare(`SELECT state FROM files WHERE id = ?`)
      .get(fileId) as { state: string };
    expect(row.state).toBe('quarantined');
  });

  it('writes to a suffixed destination when the original destination has different content', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'a.jpg');
    const destPath = resolve(destRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourcePath, 'source content', sourceDriveId);
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    writeFileSync(destPath, 'a different file already here');

    const out = await moveCrossDrive({
      db,
      fileId,
      destPath,
      destDriveId,
      sourceDriveRoot: sourceRoot,
      batchId,
      chunkBytes: 64 * 1024,
    });

    const expectedDest = resolve(destRoot, 'Photos', 'a_1.jpg');
    expect(out.kind).toBe('moved');
    expect(out.finalDestPath).toBe(expectedDest);
    expect(readFileSync(expectedDest, 'utf8')).toBe('source content');
    expect(readFileSync(destPath, 'utf8')).toBe('a different file already here');
    const row = db.prepare(`SELECT path FROM files WHERE id = ?`).get(fileId) as { path: string };
    expect(row.path).toBe(expectedDest);
  });
});
