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
import { DriveError } from '@fileorganizer/shared';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { RulesRepo } from '../rules/repo.js';
import type { PlannedOperation } from './planner.js';
import { applyApprovedBatch, autoApply } from './applier.js';

let dir: string;
let db: Catalog;

function shaOf(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-applier-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

interface SetupResult {
  driveId: string;
  ruleId: string;
}

function seedDrive(label: string): string {
  return new DriveRepo(db).upsert({
    volumeSerial: `serial-${label}`,
    label,
    currentLetter: null,
    mountPath: null,
    kind: 'local',
    roles: [],
    totalBytes: 1_000,
    freeBytes: 800,
  }).id;
}

function seedScan(driveId: string, scanId = 'scan-1'): void {
  db.prepare(
    `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(scanId, driveId, new Date().toISOString(), 'completed', 'balanced');
}

function seedRule(
  movePolicy: 'same-drive-auto' | 'cross-drive-review' | 'always-review' = 'same-drive-auto',
): string {
  return new RulesRepo(db).create({
    name: 'photos',
    priority: 100,
    match: { category: ['image'] },
    destinationRole: 'photos',
    destinationTemplate: 'Photos/{filename}',
    movePolicy,
    quarantinePolicy: 'default',
  }).id;
}

function seedFile(
  driveId: string,
  path: string,
  content = 'data',
  scanId = 'scan-1',
): number {
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
    scanId,
  });
  return (db.prepare(`SELECT id FROM files WHERE path = ?`).get(path) as { id: number }).id;
}

function plannedOp(
  fileId: number,
  ruleId: string,
  kind: PlannedOperation['kind'],
  sourceDriveId: string,
  sourcePath: string,
  destDriveId: string,
  destPath: string,
): PlannedOperation {
  return {
    fileId,
    ruleId,
    sourceDriveId,
    sourcePath,
    destDriveId,
    destPath,
    kind,
    estimatedBytes: 100,
  };
}

describe('autoApply', () => {
  it('executes same-drive-auto operations and returns the rest as reviewQueue', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const autoRuleId = seedRule('same-drive-auto');
    const reviewRuleId = new RulesRepo(db).create({
      name: 'cross',
      priority: 200,
      match: { category: ['image'] },
      destinationRole: 'archive',
      destinationTemplate: 'Archive/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    }).id;
    const root = resolve(dir, 'V');
    const sourceA = resolve(root, 'inbox', 'a.jpg');
    const sourceB = resolve(root, 'inbox', 'b.jpg');
    const fileA = seedFile(driveId, sourceA, 'A');
    const fileB = seedFile(driveId, sourceB, 'B');

    const ops: PlannedOperation[] = [
      plannedOp(fileA, autoRuleId, 'same-drive-move', driveId, sourceA, driveId, resolve(root, 'Photos', 'a.jpg')),
      plannedOp(fileB, reviewRuleId, 'cross-drive-move', driveId, sourceB, 'other', resolve(dir, 'OTHER', 'b.jpg')),
    ];

    const result = await autoApply({
      db,
      operations: ops,
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });

    expect(result.autoApplied).toBe(1);
    expect(result.reviewQueue).toHaveLength(1);
    expect(result.reviewQueue[0]!.fileId).toBe(fileB);
    expect(existsSync(resolve(root, 'Photos', 'a.jpg'))).toBe(true);
    expect(existsSync(sourceA)).toBe(false);
    expect(existsSync(sourceB)).toBe(true);

    const ledgerOps = db
      .prepare(`SELECT status FROM operations WHERE batch_id = ?`)
      .all(result.autoBatchId!) as { status: string }[];
    expect(ledgerOps).toHaveLength(1);
    expect(ledgerOps[0]!.status).toBe('completed');
  });

  it('returns autoBatchId=null when nothing is auto-applicable', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule('always-review');
    const root = resolve(dir, 'V');
    const sourcePath = resolve(root, 'a.jpg');
    const fileId = seedFile(driveId, sourcePath);

    const ops = [
      plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, resolve(root, 'Photos', 'a.jpg')),
    ];
    const result = await autoApply({
      db,
      operations: ops,
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });
    expect(result.autoBatchId).toBeNull();
    expect(result.autoApplied).toBe(0);
    expect(result.reviewQueue).toHaveLength(1);
  });
});

describe('applyApprovedBatch', () => {
  it('runs same-drive moves and records each operation under the new batch', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule('always-review');
    const root = resolve(dir, 'V');
    const sourcePath = resolve(root, 'a.jpg');
    const fileId = seedFile(driveId, sourcePath, 'data');

    const ops = [
      plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, resolve(root, 'Photos', 'a.jpg')),
    ];

    const result = await applyApprovedBatch({
      db,
      description: 'photo cleanup',
      operations: ops,
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(existsSync(resolve(root, 'Photos', 'a.jpg'))).toBe(true);

    const batch = db
      .prepare(`SELECT status, kind, description FROM batches WHERE id = ?`)
      .get(result.batchId) as { status: string; kind: string; description: string };
    expect(batch.status).toBe('completed');
    expect(batch.kind).toBe('move');
    expect(batch.description).toBe('photo cleanup');
  });

  it('runs cross-drive moves and ends with a copy operation in the ledger', async () => {
    const sourceDriveId = seedDrive('SRC');
    const destDriveId = seedDrive('DST');
    seedScan(sourceDriveId);
    const ruleId = seedRule('cross-drive-review');
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'a.jpg');
    const destPath = resolve(destRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourceDriveId, sourcePath, 'data');

    const ops = [
      plannedOp(fileId, ruleId, 'cross-drive-move', sourceDriveId, sourcePath, destDriveId, destPath),
    ];

    const result = await applyApprovedBatch({
      db,
      description: 'archive run',
      operations: ops,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [destDriveId, destRoot],
      ]),
      chunkBytes: 64 * 1024,
    });

    expect(result.completed).toBe(1);
    expect(readFileSync(destPath, 'utf8')).toBe('data');
    expect(existsSync(sourcePath)).toBe(false);

    const op = db
      .prepare(`SELECT kind, status FROM operations WHERE batch_id = ?`)
      .get(result.batchId) as { kind: string; status: string };
    expect(op.kind).toBe('copy');
    expect(op.status).toBe('completed');
  });

  it('records failed ops with errorMessage and finishes the batch as failed when any op throws', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule('always-review');
    const root = resolve(dir, 'V');
    const goneSourcePath = resolve(root, 'gone.jpg');
    const realPath = resolve(root, 'real.jpg');
    const goneFileId = seedFile(driveId, goneSourcePath, 'gone-content');
    const realFileId = seedFile(driveId, realPath, 'real-content');
    rmSync(goneSourcePath);

    const goneOp = plannedOp(
      goneFileId,
      ruleId,
      'same-drive-move',
      driveId,
      goneSourcePath,
      driveId,
      resolve(root, 'Photos', 'gone.jpg'),
    );
    const realOp = plannedOp(
      realFileId,
      ruleId,
      'same-drive-move',
      driveId,
      realPath,
      driveId,
      resolve(root, 'Photos', 'real.jpg'),
    );

    const result = await applyApprovedBatch({
      db,
      description: 'mixed',
      operations: [goneOp, realOp],
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);

    const rows = db
      .prepare(`SELECT status, error_message FROM operations WHERE batch_id = ? ORDER BY id`)
      .all(result.batchId) as { status: string; error_message: string | null }[];
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.error_message).toBeTruthy();
    expect(rows[1]!.status).toBe('completed');

    const batch = db
      .prepare(`SELECT status FROM batches WHERE id = ?`)
      .get(result.batchId) as { status: string };
    expect(batch.status).toBe('failed');
  });

  it('in dry-run mode: records ops as dry-run, skips fs writes, but verifies source hash', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule('always-review');
    const root = resolve(dir, 'V');
    const sourcePath = resolve(root, 'a.jpg');
    const destPath = resolve(root, 'Photos', 'a.jpg');
    const fileId = seedFile(driveId, sourcePath, 'data');

    const ops = [
      plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, destPath),
    ];

    const result = await applyApprovedBatch({
      db,
      description: 'preview',
      operations: ops,
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
      dryRun: true,
    });

    expect(result.completed).toBe(1);
    expect(existsSync(destPath)).toBe(false);
    expect(existsSync(sourcePath)).toBe(true);

    const op = db
      .prepare(`SELECT status FROM operations WHERE batch_id = ?`)
      .get(result.batchId) as { status: string };
    expect(op.status).toBe('dry-run');
    const row = db.prepare(`SELECT state FROM files WHERE id = ?`).get(fileId) as { state: string };
    expect(row.state).toBe('indexed');
  });

  it('in dry-run mode: marks ops failed when source hash has drifted from the catalog', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule('always-review');
    const root = resolve(dir, 'V');
    const sourcePath = resolve(root, 'a.jpg');
    const destPath = resolve(root, 'Photos', 'a.jpg');
    const fileId = seedFile(driveId, sourcePath, 'original');
    writeFileSync(sourcePath, 'mutated since scan');

    const ops = [
      plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, destPath),
    ];

    const result = await applyApprovedBatch({
      db,
      description: 'preview',
      operations: ops,
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
      dryRun: true,
    });

    expect(result.failed).toBe(1);
    const op = db
      .prepare(`SELECT status, error_message FROM operations WHERE batch_id = ?`)
      .get(result.batchId) as { status: string; error_message: string | null };
    expect(op.status).toBe('failed');
    expect(op.error_message).toMatch(/hash/i);
  });

  it('updates the operation row with the actual final destPath when collision triggers a suffix rename', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule('always-review');
    const root = resolve(dir, 'V');
    const sourcePath = resolve(root, 'a.jpg');
    const destPath = resolve(root, 'Photos', 'a.jpg');
    const fileId = seedFile(driveId, sourcePath, 'source content');
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    writeFileSync(destPath, 'occupant');

    const ops = [
      plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, destPath),
    ];

    const result = await applyApprovedBatch({
      db,
      description: 'collision suffix',
      operations: ops,
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });

    expect(result.completed).toBe(1);
    const expectedFinal = resolve(root, 'Photos', 'a_1.jpg');
    const op = db
      .prepare(`SELECT dest_path AS destPath FROM operations WHERE batch_id = ?`)
      .get(result.batchId) as { destPath: string };
    expect(op.destPath).toBe(expectedFinal);
  });

  it('aborts batch when destination drives lack free space (5% safety margin)', async () => {
    const drives = new DriveRepo(db);
    const d1Root = join(dir, 'd1');
    const d2Root = join(dir, 'd2');
    mkdirSync(d1Root, { recursive: true });
    mkdirSync(d2Root, { recursive: true });
    const d1 = drives.upsert({
      volumeSerial: 'V1',
      label: 'D1',
      currentLetter: null,
      mountPath: null,
      kind: 'local',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 1_000_000_000,
    }).id;
    const d2 = drives.upsert({
      volumeSerial: 'V2',
      label: 'D2',
      currentLetter: null,
      mountPath: null,
      kind: 'local',
      roles: [],
      totalBytes: 200_000_000,
      freeBytes: 100_000_000,
    }).id;
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run('s-tight', d1, new Date().toISOString(), 'completed', 'balanced');

    const srcPath = join(d1Root, 'a.bin');
    writeFileSync(srcPath, 'x');
    new FilesRepo(db).upsertOne({
      driveId: d1,
      path: srcPath,
      name: 'a.bin',
      extension: 'bin',
      sizeBytes: 1,
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
      scanId: 's-tight',
    });
    const fileId = (db.prepare(`SELECT id FROM files WHERE path = ?`).get(srcPath) as { id: number }).id;

    const planned: PlannedOperation[] = [
      {
        fileId,
        ruleId: 'r',
        sourceDriveId: d1,
        sourcePath: srcPath,
        destDriveId: d2,
        destPath: join(d2Root, 'a.bin'),
        kind: 'cross-drive-move',
        estimatedBytes: 500_000_000,
      },
    ];

    await expect(
      applyApprovedBatch({
        db,
        description: 'over capacity',
        operations: planned,
        driveRoots: new Map([
          [d1, d1Root],
          [d2, d2Root],
        ]),
        chunkBytes: 1024,
      }),
    ).rejects.toThrow(/insufficient free space on D2/);

    expect(existsSync(srcPath)).toBe(true);
    expect(existsSync(join(d2Root, 'a.bin'))).toBe(false);

    const batches = db
      .prepare(`SELECT status, summary FROM batches WHERE description = ?`)
      .all('over capacity') as { status: string; summary: string }[];
    expect(batches).toHaveLength(1);
    expect(batches[0]!.status).toBe('failed');
    expect(JSON.parse(batches[0]!.summary).reason).toBe('insufficient free space');

    const ops = db
      .prepare(`SELECT id FROM operations WHERE batch_id = (SELECT id FROM batches WHERE description = ?)`)
      .all('over capacity');
    expect(ops).toHaveLength(0);
  });

  it('aborts the batch as DriveError when a cross-drive copy hits a disconnect-class errno', async () => {
    const sourceDriveId = seedDrive('SRC');
    const destDriveId = seedDrive('NAS');
    seedScan(sourceDriveId);
    const ruleId = seedRule('cross-drive-review');
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'NAS');
    const goneSource = resolve(sourceRoot, 'gone.jpg');
    const realSource = resolve(sourceRoot, 'still-here.jpg');
    const goneFileId = seedFile(sourceDriveId, goneSource, 'gone-bytes');
    const realFileId = seedFile(sourceDriveId, realSource, 'real-bytes');
    rmSync(goneSource);

    const ops: PlannedOperation[] = [
      plannedOp(
        goneFileId,
        ruleId,
        'cross-drive-move',
        sourceDriveId,
        goneSource,
        destDriveId,
        resolve(destRoot, 'gone.jpg'),
      ),
      plannedOp(
        realFileId,
        ruleId,
        'cross-drive-move',
        sourceDriveId,
        realSource,
        destDriveId,
        resolve(destRoot, 'still-here.jpg'),
      ),
    ];

    let caught: unknown;
    try {
      await applyApprovedBatch({
        db,
        description: 'nas-flap',
        operations: ops,
        driveRoots: new Map([
          [sourceDriveId, sourceRoot],
          [destDriveId, destRoot],
        ]),
        chunkBytes: 64 * 1024,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DriveError);
    expect((caught as DriveError).code).toBe('DRIVE_DISCONNECTED');

    const batch = db
      .prepare(`SELECT id, status, summary FROM batches WHERE description = ?`)
      .get('nas-flap') as { id: string; status: string; summary: string };
    expect(batch.status).toBe('failed');
    const summary = JSON.parse(batch.summary) as Record<string, unknown>;
    expect(summary['disconnectedDrive']).toBe('NAS');
    expect(summary['errorCode']).toBe('DRIVE_DISCONNECTED');

    const ledgerOps = db
      .prepare(`SELECT status FROM operations WHERE batch_id = ? ORDER BY id`)
      .all(batch.id) as { status: string }[];
    expect(ledgerOps).toHaveLength(1);
    expect(ledgerOps[0]!.status).toBe('failed');

    expect(existsSync(realSource)).toBe(true);
    expect(existsSync(resolve(destRoot, 'still-here.jpg'))).toBe(false);
  });

  it('records completed-via-existing when destination already has identical content', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule('always-review');
    const root = resolve(dir, 'V');
    const sourcePath = resolve(root, 'a.jpg');
    const destPath = resolve(root, 'Photos', 'a.jpg');
    const fileId = seedFile(driveId, sourcePath, 'identical');
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    writeFileSync(destPath, 'identical');

    const ops = [
      plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, destPath),
    ];

    const result = await applyApprovedBatch({
      db,
      description: 'collision check',
      operations: ops,
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });

    expect(result.completed).toBe(1);
    const op = db
      .prepare(`SELECT status FROM operations WHERE batch_id = ?`)
      .get(result.batchId) as { status: string };
    expect(op.status).toBe('completed-via-existing');
  });
});
