import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { planDedupe } from './planner.js';

let dir: string;
let db: Catalog;
let driveId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-plan-'));
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
  ).run('s', driveId, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('planDedupe', () => {
  it('produces one removal op per non-keeper copy', () => {
    const repo = new FilesRepo(db);
    for (const p of ['/a.jpg', '/b.jpg', '/c.jpg']) {
      repo.upsertOne({
        driveId,
        path: p,
        name: p.slice(1),
        extension: 'jpg',
        sizeBytes: 100,
        category: 'image',
        sha256: 'h',
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
    const keeperIds = new Set(plan.operations.map((o) => o.keeperFileId));
    expect(keeperIds.size).toBe(1);
  });
});
