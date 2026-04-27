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
