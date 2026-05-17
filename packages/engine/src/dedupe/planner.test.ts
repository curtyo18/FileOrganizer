import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { RulesRepo } from '../rules/repo.js';
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

  it('ruleRole tiebreaker: keeper prefers the copy on the role-matched drive (spec §8.1)', () => {
    const driveRepo = new DriveRepo(db);
    // roleDrive has the 'photos' role; plainDrive does not.
    const roleDrive = driveRepo.upsert({
      volumeSerial: 'R',
      label: 'RoleDrive',
      currentLetter: null,
      kind: 'local',
      roles: ['photos'],
      totalBytes: 1,
      freeBytes: 1,
    });
    const plainDrive = driveRepo.upsert({
      volumeSerial: 'P',
      label: 'PlainDrive',
      currentLetter: null,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run('sr', roleDrive.id, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run('sp', plainDrive.id, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');

    // Rule: images should go to the 'photos' role.
    new RulesRepo(db).create({
      name: 'photos-rule',
      priority: 10,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });

    const files = new FilesRepo(db);
    const seedFile = (driveId2: string, scanId2: string) => {
      files.upsertOne({
        driveId: driveId2,
        path: '/photo.jpg',
        name: 'photo.jpg',
        extension: 'jpg',
        sizeBytes: 500,
        category: 'image',
        sha256: 'dupe-hash',
        mtime: '2024-01-01T00:00:00.000Z',
        ctime: '2024-01-01T00:00:00.000Z',
        exifDate: null,
        dateSource: 'mtime',
        width: null,
        height: null,
        durationSeconds: null,
        ntfsFileId: null,
        state: 'indexed',
        scanId: scanId2,
      });
      return (db.prepare(`SELECT id FROM files WHERE drive_id = ? AND path = ?`).get(driveId2, '/photo.jpg') as { id: number }).id;
    };
    // Place one copy on the plain drive first (lower fileId) so that without
    // ruleRole wired it would win the lexicographic tiebreaker, and one copy
    // on the role-matched drive.
    const plainFileId = seedFile(plainDrive.id, 'sp');
    const roleFileId = seedFile(roleDrive.id, 'sr');

    const plan = planDedupe(db, { minSizeBytes: 1 });
    expect(plan.operations).toHaveLength(1);
    const op = plan.operations[0]!;
    // The copy on the role-matched drive must be the keeper.
    expect(op.keeperFileId).toBe(roleFileId);
    // The copy on the plain drive must be the one to remove.
    expect(op.removeFileId).toBe(plainFileId);
    // The reason should mention the role tiebreaker.
    expect(op.reasons.some((r) => r.includes('role'))).toBe(true);
  });
});
