import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
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
import { moveSameDrive } from './move-same-drive.js';

function shaOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

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
  db.prepare(
    `INSERT INTO batches (id, kind, started_at, status, description, summary)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('batch-1', 'move', new Date().toISOString(), 'in-progress', 't', '{}');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function seedFile(path: string, content = 'test-content'): number {
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
  const row = db.prepare(`SELECT id FROM files WHERE path = ?`).get(path) as { id: number };
  return row.id;
}

const moveOpts = (extra: Record<string, unknown>) => ({
  db,
  driveRoot: resolve(dir, 'V'),
  batchId: 'batch-1',
  chunkBytes: 64 * 1024,
  ...extra,
});

describe('moveSameDrive', () => {
  it('renames the file on disk and updates the catalog row to state=moved', async () => {
    const driveRoot = resolve(dir, 'V');
    const sourcePath = resolve(driveRoot, 'inbox', 'a.jpg');
    const destPath = resolve(driveRoot, 'Photos', '2023', 'a.jpg');
    const fileId = seedFile(sourcePath);

    const out = await moveSameDrive(moveOpts({ fileId, destPath }));

    expect(out.kind).toBe('moved');
    expect(out.finalDestPath).toBe(destPath);
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

  it('creates intermediate destination directories', async () => {
    const driveRoot = resolve(dir, 'V');
    const sourcePath = resolve(driveRoot, 'a.jpg');
    const destPath = resolve(driveRoot, 'a', 'b', 'c', 'a.jpg');
    const fileId = seedFile(sourcePath);

    await moveSameDrive(moveOpts({ fileId, destPath }));
    expect(existsSync(destPath)).toBe(true);
  });

  it('throws when the file id is not in the catalog', async () => {
    await expect(
      moveSameDrive(moveOpts({ fileId: 9999, destPath: '/x' })),
    ).rejects.toThrow(/9999/);
  });

  it('returns completed-via-existing and quarantines source when destination has identical content', async () => {
    const driveRoot = resolve(dir, 'V');
    const sourcePath = resolve(driveRoot, 'inbox', 'a.jpg');
    const destPath = resolve(driveRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourcePath, 'identical');
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    writeFileSync(destPath, 'identical');

    const out = await moveSameDrive(moveOpts({ fileId, destPath }));

    expect(out.kind).toBe('completed-via-existing');
    expect(out.finalDestPath).toBe(destPath);
    expect(existsSync(sourcePath)).toBe(false);
    expect(readFileSync(destPath, 'utf8')).toBe('identical');
    const q = db.prepare(`SELECT quarantine_path FROM quarantine`).all() as Array<{
      quarantine_path: string;
    }>;
    expect(q).toHaveLength(1);
    expect(existsSync(q[0]!.quarantine_path)).toBe(true);
    const row = db.prepare(`SELECT state FROM files WHERE id = ?`).get(fileId) as { state: string };
    expect(row.state).toBe('quarantined');
  });

  it('suffixes the source filename when destination has different content', async () => {
    const driveRoot = resolve(dir, 'V');
    const sourcePath = resolve(driveRoot, 'inbox', 'a.jpg');
    const destPath = resolve(driveRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourcePath, 'source');
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    writeFileSync(destPath, 'a different file already here');

    const out = await moveSameDrive(moveOpts({ fileId, destPath }));

    const expectedDest = resolve(driveRoot, 'Photos', 'a_1.jpg');
    expect(out.kind).toBe('moved');
    expect(out.finalDestPath).toBe(expectedDest);
    expect(existsSync(expectedDest)).toBe(true);
    expect(readFileSync(expectedDest, 'utf8')).toBe('source');
    expect(readFileSync(destPath, 'utf8')).toBe('a different file already here');
    const row = db.prepare(`SELECT path FROM files WHERE id = ?`).get(fileId) as { path: string };
    expect(row.path).toBe(expectedDest);
  });
});
