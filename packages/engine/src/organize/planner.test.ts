import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RoleDefinition } from '@fileorganizer/shared';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { RulesRepo } from '../rules/repo.js';
import { RolesRepo } from '../roles/repo.js';
import { planOrganize } from './planner.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-planner-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

interface SeedFileOpts {
  driveId: string;
  path: string;
  name: string;
  extension?: string;
  category?: 'image' | 'video' | 'document';
  sizeBytes?: number;
  exifDate?: string | null;
  mtime?: string;
}

function seedFile(opts: SeedFileOpts): void {
  new FilesRepo(db).upsertOne({
    driveId: opts.driveId,
    path: opts.path,
    name: opts.name,
    extension: opts.extension ?? 'jpg',
    sizeBytes: opts.sizeBytes ?? 1000,
    category: opts.category ?? 'image',
    sha256: 'a'.repeat(64),
    mtime: opts.mtime ?? '2023-08-15T10:00:00.000Z',
    ctime: opts.mtime ?? '2023-08-15T10:00:00.000Z',
    exifDate: opts.exifDate ?? '2023-08-15T10:00:00.000Z',
    dateSource: opts.exifDate === null ? 'mtime' : 'exif',
    width: 100,
    height: 100,
    durationSeconds: null,
    ntfsFileId: null,
    state: 'indexed',
    scanId: 'scan-1',
  });
}

function seedDrive(label: string, freeBytes = 800_000_000_000): string {
  const id = new DriveRepo(db).upsert({
    volumeSerial: `serial-${label}`,
    label,
    currentLetter: null,
    mountPath: null,
    kind: 'local',
    roles: [],
    totalBytes: 1_000_000_000_000,
    freeBytes,
  }).id;
  db.prepare(
    `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('scan-1', id, new Date().toISOString(), 'completed', 'balanced');
  return id;
}

function role(name: string, drivePriority: string[], fillThresholdPercent = 90): RoleDefinition {
  return { name, drivePriority, fillThresholdPercent };
}

describe('planOrganize', () => {
  it('emits same-drive-move operations for files matched on the same drive', () => {
    const driveId = seedDrive('PRIMARY');
    new RulesRepo(db).create({
      name: 'photos by year',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{year}/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });
    const root = resolve(dir, 'PRIMARY');
    seedFile({ driveId, path: resolve(root, 'inbox', 'a.jpg'), name: 'a.jpg' });
    seedFile({ driveId, path: resolve(root, 'inbox', 'b.jpg'), name: 'b.jpg' });

    const plan = planOrganize({
      db,
      driveRoots: new Map([[driveId, root]]),
      roles: [role('photos', [driveId])],
    });

    expect(plan.operations).toHaveLength(2);
    expect(plan.operations.every((op) => op.kind === 'same-drive-move')).toBe(true);
    expect(plan.operations[0]!.destPath).toBe(resolve(root, 'Photos', '2023', 'a.jpg'));
    expect(plan.unmatched).toHaveLength(0);
  });

  it('emits cross-drive-move when the resolved role lives on a different drive', () => {
    const sourceDriveId = seedDrive('PRIMARY');
    const archiveDriveId = seedDrive('ARCHIVE');
    new RulesRepo(db).create({
      name: 'archive old photos',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'archive',
      destinationTemplate: 'Archive/{year}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    });
    const sourceRoot = resolve(dir, 'PRIMARY');
    const archiveRoot = resolve(dir, 'ARCHIVE');
    seedFile({ driveId: sourceDriveId, path: resolve(sourceRoot, 'a.jpg'), name: 'a.jpg' });

    const plan = planOrganize({
      db,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [archiveDriveId, archiveRoot],
      ]),
      roles: [role('archive', [archiveDriveId])],
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.kind).toBe('cross-drive-move');
    expect(plan.operations[0]!.destDriveId).toBe(archiveDriveId);
    expect(plan.operations[0]!.destPath).toBe(resolve(archiveRoot, 'Archive', '2023', 'a.jpg'));
  });

  it('marks operations as noop when source path equals rendered destination', () => {
    const driveId = seedDrive('PRIMARY');
    new RulesRepo(db).create({
      name: 'photos by year',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{year}/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });
    const root = resolve(dir, 'PRIMARY');
    const alreadyOrganized = resolve(root, 'Photos', '2023', 'a.jpg');
    seedFile({ driveId, path: alreadyOrganized, name: 'a.jpg' });

    const plan = planOrganize({
      db,
      driveRoots: new Map([[driveId, root]]),
      roles: [role('photos', [driveId])],
    });

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.kind).toBe('noop');
  });

  it('lists files that match no rule under unmatched', () => {
    const driveId = seedDrive('PRIMARY');
    new RulesRepo(db).create({
      name: 'images only',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });
    const root = resolve(dir, 'PRIMARY');
    seedFile({
      driveId,
      path: resolve(root, 'doc.pdf'),
      name: 'doc.pdf',
      extension: 'pdf',
      category: 'document',
    });

    const plan = planOrganize({
      db,
      driveRoots: new Map([[driveId, root]]),
      roles: [role('photos', [driveId])],
    });

    expect(plan.operations).toHaveLength(0);
    expect(plan.unmatched).toHaveLength(1);
  });

  it('reports unresolvedRoles when no drive in role is connected', () => {
    const sourceDriveId = seedDrive('PRIMARY');
    const archiveDriveId = seedDrive('ARCHIVE');
    new RulesRepo(db).create({
      name: 'archive',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'archive',
      destinationTemplate: 'Archive/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    });
    const sourceRoot = resolve(dir, 'PRIMARY');
    seedFile({ driveId: sourceDriveId, path: resolve(sourceRoot, 'a.jpg'), name: 'a.jpg' });

    const plan = planOrganize({
      db,
      driveRoots: new Map([[sourceDriveId, sourceRoot]]),
      roles: [role('archive', [archiveDriveId])],
    });

    expect(plan.operations).toHaveLength(0);
    expect(plan.unresolvedRoles).toHaveLength(1);
    expect(plan.unresolvedRoles[0]!.reason).toContain('archive');
  });

  it('aggregates many files matching the same unresolved rule into a single entry with fileCount', () => {
    const sourceDriveId = seedDrive('PRIMARY');
    const archiveDriveId = seedDrive('ARCHIVE');
    new RulesRepo(db).create({
      name: 'archive',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'archive',
      destinationTemplate: 'Archive/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    });
    const sourceRoot = resolve(dir, 'PRIMARY');
    for (let i = 0; i < 50; i++) {
      seedFile({
        driveId: sourceDriveId,
        path: resolve(sourceRoot, `f${i}.jpg`),
        name: `f${i}.jpg`,
      });
    }

    const plan = planOrganize({
      db,
      driveRoots: new Map([[sourceDriveId, sourceRoot]]),
      roles: [role('archive', [archiveDriveId])],
    });

    expect(plan.operations).toHaveLength(0);
    expect(plan.unresolvedRoles).toHaveLength(1);
    expect(plan.unresolvedRoles[0]!.fileCount).toBe(50);
    expect(plan.unresolvedRoles[0]!.reason).toContain('archive');
  });

  it('reports per-rule wouldMatch vs actualMatch so the UI can flag shadowed rules', () => {
    const driveId = seedDrive('PRIMARY');
    const broadId = new RulesRepo(db).create({
      name: 'all images',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    }).id;
    const strictId = new RulesRepo(db).create({
      name: 'old images only',
      priority: 200,
      match: { category: ['image'], dateBefore: '2024-01-01' },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/old/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    }).id;
    const root = resolve(dir, 'PRIMARY');
    seedFile({ driveId, path: resolve(root, 'recent.jpg'), name: 'recent.jpg', exifDate: '2025-01-01T00:00:00.000Z' });
    seedFile({ driveId, path: resolve(root, 'old.jpg'), name: 'old.jpg', exifDate: '2023-01-01T00:00:00.000Z' });

    const plan = planOrganize({
      db,
      driveRoots: new Map([[driveId, root]]),
      roles: [role('photos', [driveId])],
    });

    const broad = plan.ruleStats.find((s) => s.ruleId === broadId)!;
    const strict = plan.ruleStats.find((s) => s.ruleId === strictId)!;
    expect(broad.wouldMatch).toBe(2);
    expect(broad.actualMatch).toBe(2);
    expect(strict.wouldMatch).toBe(1);
    expect(strict.actualMatch).toBe(0);
  });

  it('falls back to RolesRepo when the input does not specify roles', () => {
    const sourceDriveId = seedDrive('PRIMARY');
    const archiveDriveId = seedDrive('ARCHIVE');
    new RulesRepo(db).create({
      name: 'archive old photos',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'archive',
      destinationTemplate: 'Archive/{year}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    });
    const sourceRoot = resolve(dir, 'PRIMARY');
    const archiveRoot = resolve(dir, 'ARCHIVE');
    seedFile({ driveId: sourceDriveId, path: resolve(sourceRoot, 'a.jpg'), name: 'a.jpg' });

    new RolesRepo(db).create({
      name: 'archive',
      drivePriority: [archiveDriveId],
      fillThresholdPercent: 90,
    });

    const plan = planOrganize({
      db,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [archiveDriveId, archiveRoot],
      ]),
    });
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.destDriveId).toBe(archiveDriveId);
  });

  it('lets a caller override the catalog roles via the optional roles input', () => {
    const sourceDriveId = seedDrive('PRIMARY');
    const archiveDriveId = seedDrive('ARCHIVE');
    new RulesRepo(db).create({
      name: 'photos',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{year}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    });
    const sourceRoot = resolve(dir, 'PRIMARY');
    const archiveRoot = resolve(dir, 'ARCHIVE');
    seedFile({ driveId: sourceDriveId, path: resolve(sourceRoot, 'a.jpg'), name: 'a.jpg' });

    new RolesRepo(db).create({
      name: 'photos',
      drivePriority: [sourceDriveId],
      fillThresholdPercent: 90,
    });

    const plan = planOrganize({
      db,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [archiveDriveId, archiveRoot],
      ]),
      roles: [role('photos', [archiveDriveId])],
    });
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]!.destDriveId).toBe(archiveDriveId);
  });

  it('paginates operations by estimatedBytes desc with stable tie-break', () => {
    const driveId = seedDrive('PRIMARY');
    new RulesRepo(db).create({
      name: 'photos',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });
    const root = resolve(dir, 'PRIMARY');
    // 12 files, sizes deliberately interleaved so a stable sort by bytes
    // desc + tie-break on (ruleId, fileId) is observable.
    const sizes = [10, 50, 30, 50, 20, 50, 40, 10, 30, 60, 70, 80];
    sizes.forEach((sz, i) => {
      seedFile({
        driveId,
        path: resolve(root, `f${i}.jpg`),
        name: `f${i}.jpg`,
        sizeBytes: sz,
      });
    });

    const driveRoots = new Map([[driveId, root]]);
    const roles = [role('photos', [driveId])];

    const page0 = planOrganize({ db, driveRoots, roles, limit: 5, offset: 0 });
    expect(page0.total).toBe(12);
    expect(page0.hasMore).toBe(true);
    expect(page0.operations).toHaveLength(5);
    // Sorted by estimatedBytes desc.
    const bytes0 = page0.operations.map((o) => o.estimatedBytes);
    expect(bytes0).toEqual([...bytes0].sort((a, b) => b - a));
    // First op is the largest (80).
    expect(page0.operations[0]!.estimatedBytes).toBe(80);

    const page1 = planOrganize({ db, driveRoots, roles, limit: 5, offset: 5 });
    expect(page1.total).toBe(12);
    expect(page1.hasMore).toBe(true);
    expect(page1.operations).toHaveLength(5);

    const page2 = planOrganize({ db, driveRoots, roles, limit: 5, offset: 10 });
    expect(page2.total).toBe(12);
    expect(page2.hasMore).toBe(false);
    expect(page2.operations).toHaveLength(2);

    // No overlap and no gaps between pages.
    const ids = [
      ...page0.operations.map((o) => o.fileId),
      ...page1.operations.map((o) => o.fileId),
      ...page2.operations.map((o) => o.fileId),
    ];
    expect(new Set(ids).size).toBe(12);

    // Aggregates are not paginated — they describe the full plan.
    expect(page0.unresolvedRoles).toEqual(page2.unresolvedRoles);
    expect(page0.ruleStats).toEqual(page2.ruleStats);
    expect(page0.unmatched).toEqual(page2.unmatched);
  });

  it('returns full operations array and total/hasMore when no pagination is supplied', () => {
    const driveId = seedDrive('PRIMARY');
    new RulesRepo(db).create({
      name: 'photos',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });
    const root = resolve(dir, 'PRIMARY');
    seedFile({ driveId, path: resolve(root, 'a.jpg'), name: 'a.jpg' });

    const plan = planOrganize({
      db,
      driveRoots: new Map([[driveId, root]]),
      roles: [role('photos', [driveId])],
    });
    expect(plan.operations).toHaveLength(1);
    expect(plan.total).toBe(1);
    expect(plan.hasMore).toBe(false);
  });

  it('reports unresolvedRoles when the rule references a role that is not defined', () => {
    const driveId = seedDrive('PRIMARY');
    new RulesRepo(db).create({
      name: 'orphan rule',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'no-such-role',
      destinationTemplate: 'X/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });
    const root = resolve(dir, 'PRIMARY');
    seedFile({ driveId, path: resolve(root, 'a.jpg'), name: 'a.jpg' });

    const plan = planOrganize({
      db,
      driveRoots: new Map([[driveId, root]]),
      roles: [],
    });

    expect(plan.operations).toHaveLength(0);
    expect(plan.unresolvedRoles[0]!.reason).toContain('no-such-role');
  });
});
