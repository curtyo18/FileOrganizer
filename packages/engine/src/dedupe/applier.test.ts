import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
