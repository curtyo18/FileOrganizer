import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { planDedupe } from './planner.js';
import { applyDedupe } from './applier.js';

let dir: string;
let db: Catalog;
let driveId: string;
let driveRoot: string;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-apply-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  driveRoot = join(dir, 'drive');
  mkdirSync(driveRoot, { recursive: true });
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
  ).run('s', driveId, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('applyDedupe', () => {
  it('quarantines all but the keeper', async () => {
    const files = new FilesRepo(db);
    const body = 'duplicate-content';
    const hash = sha(body);
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) {
      const p = join(driveRoot, name);
      writeFileSync(p, body);
      files.upsertOne({
        driveId,
        path: p,
        name,
        extension: 'jpg',
        sizeBytes: body.length,
        category: 'image',
        sha256: hash,
        mtime: '2024-01-01T00:00:00.000Z',
        ctime: '2024-01-01T00:00:00.000Z',
        exifDate: null,
        dateSource: 'mtime',
        width: null,
        height: null,
        durationSeconds: null,
        ntfsFileId: null,
        state: 'indexed',
        scanId: 's',
      });
    }
    const plan = planDedupe(db, { minSizeBytes: 1 });
    expect(plan.operations).toHaveLength(2);
    const result = await applyDedupe({
      db,
      operations: plan.operations,
      driveRoots: new Map([[driveId, driveRoot]]),
    });
    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
    const survivors = ['a.jpg', 'b.jpg', 'c.jpg'].filter((n) => existsSync(join(driveRoot, n)));
    expect(survivors).toHaveLength(1);
  });

  it('FILE_MISSING: file in catalog but deleted from disk fails with typed IntegrityError', async () => {
    const files = new FilesRepo(db);
    const body = 'duplicate-for-missing-test';
    const hash = sha(body);
    // Register two files with identical hashes so planDedupe produces an op.
    const paths = ['missing.jpg', 'keeper.jpg'].map((name) => join(driveRoot, name));
    for (const p of paths) {
      writeFileSync(p, body);
    }
    for (const p of paths) {
      files.upsertOne({
        driveId,
        path: p,
        name: p.split('/').pop()!,
        extension: 'jpg',
        sizeBytes: body.length,
        category: 'image',
        sha256: hash,
        mtime: '2024-01-01T00:00:00.000Z',
        ctime: '2024-01-01T00:00:00.000Z',
        exifDate: null,
        dateSource: 'mtime',
        width: null,
        height: null,
        durationSeconds: null,
        ntfsFileId: null,
        state: 'indexed',
        scanId: 's',
      });
    }
    const plan = planDedupe(db, { minSizeBytes: 1 });
    expect(plan.operations).toHaveLength(1);
    // Delete the non-keeper from disk after it has been catalogued.
    const opToRemove = plan.operations[0]!;
    const row = db
      .prepare(`SELECT path FROM files WHERE id = ?`)
      .get(opToRemove.removeFileId) as { path: string } | undefined;
    unlinkSync(row!.path);

    const result = await applyDedupe({
      db,
      operations: plan.operations,
      driveRoots: new Map([[driveId, driveRoot]]),
    });

    // The op must fail (not panic with raw ENOENT).
    expect(result.failed).toBe(1);
    expect(result.completed).toBe(0);

    // The recorded operation must show status='failed' with an error message
    // that comes from IntegrityError('FILE_MISSING', ...), not a raw system error.
    const ops = db
      .prepare(`SELECT status, error_message FROM operations WHERE batch_id = ?`)
      .all(result.batchId) as { status: string; error_message: string | null }[];
    const failedOp = ops.find((o) => o.status === 'failed');
    expect(failedOp).toBeDefined();
    expect(failedOp!.error_message).not.toBeNull();
    // Must NOT be a raw ENOENT — the guard throws IntegrityError first.
    expect(failedOp!.error_message).not.toMatch(/ENOENT/);
    expect(failedOp!.error_message).toMatch(/no longer exists/i);
  });

  it('aborts ops when live hash does not match catalog hash', async () => {
    const files = new FilesRepo(db);
    for (const name of ['a.jpg', 'b.jpg']) {
      const p = join(driveRoot, name);
      writeFileSync(p, 'real-content');
      files.upsertOne({
        driveId,
        path: p,
        name,
        extension: 'jpg',
        sizeBytes: 100,
        category: 'image',
        sha256: 'wronghash',
        mtime: '2024-01-01T00:00:00.000Z',
        ctime: '2024-01-01T00:00:00.000Z',
        exifDate: null,
        dateSource: 'mtime',
        width: null,
        height: null,
        durationSeconds: null,
        ntfsFileId: null,
        state: 'indexed',
        scanId: 's',
      });
    }
    const plan = planDedupe(db, { minSizeBytes: 1 });
    const result = await applyDedupe({
      db,
      operations: plan.operations,
      driveRoots: new Map([[driveId, driveRoot]]),
    });
    expect(result.failed).toBeGreaterThan(0);
    expect(existsSync(join(driveRoot, 'a.jpg'))).toBe(true);
    expect(existsSync(join(driveRoot, 'b.jpg'))).toBe(true);
  });
});
