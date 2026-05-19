import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { Writable } from 'node:stream';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual };
});

import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { DriveError, IntegrityError } from '@fileorganizer/shared';
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

  it('re-throws as DriveError(DRIVE_DISCONNECTED) when source vanishes mid-pipeline (ENOENT)', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'a.jpg');
    const destPath = resolve(destRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourcePath, 'payload', sourceDriveId);
    rmSync(sourcePath);

    let caught: unknown;
    try {
      await moveCrossDrive({
        db,
        fileId,
        destPath,
        destDriveId,
        sourceDriveRoot: sourceRoot,
        batchId,
        chunkBytes: 64 * 1024,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DriveError);
    expect((caught as DriveError).code).toBe('DRIVE_DISCONNECTED');
    expect((caught as DriveError).message).toContain('ENOENT');
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

  it('unlinks the corrupt partial dest before throwing on hash mismatch', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'b.jpg');
    const destPath = resolve(destRoot, 'Photos', 'b.jpg');
    // Seed file with real content but corrupt the catalog hash so the
    // post-copy re-hash will never match.
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

    // The partially-written destination must have been removed.
    expect(existsSync(destPath)).toBe(false);
  });

  it('propagates the original IntegrityError when the cleanup unlink also fails', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'c.jpg');
    const destPath = resolve(destRoot, 'Photos', 'c.jpg');
    const fileId = seedFile(sourcePath, 'real content 2', sourceDriveId);
    db.prepare(`UPDATE files SET sha256 = ? WHERE id = ?`).run('z'.repeat(64), fileId);

    // Make unlink fail with a secondary error (e.g. permission denied).
    const unlinkSpy = vi
      .spyOn(fsp, 'unlink')
      .mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }));

    let caught: unknown;
    try {
      await moveCrossDrive({
        db,
        fileId,
        destPath,
        destDriveId,
        sourceDriveRoot: sourceRoot,
        batchId,
        chunkBytes: 64 * 1024,
      });
    } catch (err) {
      caught = err;
    }

    unlinkSpy.mockRestore();

    // The caller must see IntegrityError, not the EPERM from unlink.
    expect(caught).toBeInstanceOf(IntegrityError);
    expect((caught as IntegrityError).code).toBe('CROSS_DRIVE_HASH_MISMATCH');
  });

  it('calls handle.sync() on dest before quarantineFile runs', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'd.jpg');
    const destPath = resolve(destRoot, 'Photos', 'd.jpg');
    const fileId = seedFile(sourcePath, 'sync test content', sourceDriveId);

    const callOrder: string[] = [];

    // Wrap fsp.open to intercept the dest handle and spy on sync/close order.
    const realOpen = fsp.open.bind(fsp);
    const openSpy = vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args);
      // Only wrap handles opened for writing (the dest copy path).
      const flags = args[1];
      if (flags === 'w') {
        const realSync = handle.sync.bind(handle);
        const realClose = handle.close.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          callOrder.push('handle.sync');
          return realSync();
        });
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          callOrder.push('handle.close');
          return realClose();
        });
      }
      return handle;
    });

    await moveCrossDrive({
      db,
      fileId,
      destPath,
      destDriveId,
      sourceDriveRoot: sourceRoot,
      batchId,
      chunkBytes: 64 * 1024,
    });

    openSpy.mockRestore();

    // handle.sync must come before handle.close, both before the copy is
    // considered complete (quarantine of source confirms success path ran).
    const syncIdx = callOrder.indexOf('handle.sync');
    const closeIdx = callOrder.indexOf('handle.close');
    expect(syncIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(syncIdx);

    // The source was quarantined, proving we reached the success path after sync.
    const q = db
      .prepare(`SELECT quarantine_path FROM quarantine WHERE batch_id = ?`)
      .get(batchId) as { quarantine_path: string } | undefined;
    expect(q).toBeDefined();
    expect(existsSync(q!.quarantine_path)).toBe(true);
  });

  it('mid-stream EIO unlinks the partial destination', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'e.jpg');
    const destPath = resolve(destRoot, 'Photos', 'e.jpg');
    const fileId = seedFile(sourcePath, 'eio test content', sourceDriveId);

    // Wrap fsp.open so the dest write-handle's createWriteStream returns a Writable
    // that fails immediately on the first write() call — no timing ambiguity.
    const realOpen = fsp.open.bind(fsp);
    const openSpy = vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args);
      if (args[1] === 'w') {
        vi.spyOn(handle, 'createWriteStream').mockImplementation(() => {
          return new Writable({
            write(_chunk, _enc, cb) {
              cb(Object.assign(new Error('EIO'), { code: 'EIO' }));
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any;
        });
      }
      return handle;
    });

    let caught: unknown;
    try {
      await moveCrossDrive({
        db,
        fileId,
        destPath,
        destDriveId,
        sourceDriveRoot: sourceRoot,
        batchId,
        chunkBytes: 64 * 1024,
      });
    } catch (err) {
      caught = err;
    }

    openSpy.mockRestore();

    // Should have thrown (EIO is not in DISCONNECT_CODES, so raw error propagates).
    expect(caught).toBeDefined();
    expect((caught as NodeJS.ErrnoException).code).toBe('EIO');

    // The partial destination must have been removed.
    expect(existsSync(destPath)).toBe(false);
  });

  it('ENOSPC on write unlinks the partial destination', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'f.jpg');
    const destPath = resolve(destRoot, 'Photos', 'f.jpg');
    const fileId = seedFile(sourcePath, 'enospc test content', sourceDriveId);

    const realOpen = fsp.open.bind(fsp);
    const openSpy = vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args);
      if (args[1] === 'w') {
        vi.spyOn(handle, 'createWriteStream').mockImplementation(() => {
          return new Writable({
            write(_chunk, _enc, cb) {
              cb(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any;
        });
      }
      return handle;
    });

    let caught: unknown;
    try {
      await moveCrossDrive({
        db,
        fileId,
        destPath,
        destDriveId,
        sourceDriveRoot: sourceRoot,
        batchId,
        chunkBytes: 64 * 1024,
      });
    } catch (err) {
      caught = err;
    }

    openSpy.mockRestore();

    expect(caught).toBeDefined();
    expect((caught as NodeJS.ErrnoException).code).toBe('ENOSPC');
    expect(existsSync(destPath)).toBe(false);
  });

  it('DRIVE_DISCONNECTED attempts unlink and swallows secondary unlink failure', async () => {
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'g.jpg');
    const destPath = resolve(destRoot, 'Photos', 'g.jpg');
    const fileId = seedFile(sourcePath, 'disconnect content', sourceDriveId);

    // Make the pipeline throw ECONNRESET (a DISCONNECT_CODE).
    const realOpen = fsp.open.bind(fsp);
    const openSpy = vi.spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
      const handle = await realOpen(...args);
      if (args[1] === 'w') {
        vi.spyOn(handle, 'createWriteStream').mockImplementation(() => {
          return new Writable({
            write(_chunk, _enc, cb) {
              cb(Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }));
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any;
        });
      }
      return handle;
    });

    // Also make unlink throw ENOENT (secondary failure — drive is gone).
    const unlinkSpy = vi
      .spyOn(fsp, 'unlink')
      .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    let caught: unknown;
    try {
      await moveCrossDrive({
        db,
        fileId,
        destPath,
        destDriveId,
        sourceDriveRoot: sourceRoot,
        batchId,
        chunkBytes: 64 * 1024,
      });
    } catch (err) {
      caught = err;
    }

    openSpy.mockRestore();
    unlinkSpy.mockRestore();

    // Must surface DriveError, not the secondary ENOENT from unlink.
    expect(caught).toBeInstanceOf(DriveError);
    expect((caught as DriveError).code).toBe('DRIVE_DISCONNECTED');
    expect((caught as DriveError).message).toContain('ECONNRESET');
  });
});
