import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual };
});

import * as fs from 'node:fs';
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
import { RulesRepo } from '../rules/repo.js';
import { applyApprovedBatch } from './applier.js';
import type { PlannedOperation } from './planner.js';
import { undoBatch } from './undo.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-undo-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

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

function seedScan(driveId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('scan-1', driveId, new Date().toISOString(), 'completed', 'balanced');
}

function seedRule(): string {
  return new RulesRepo(db).create({
    name: 'r',
    priority: 100,
    match: { category: ['image'] },
    destinationRole: 'photos',
    destinationTemplate: 'Photos/{filename}',
    movePolicy: 'always-review',
    quarantinePolicy: 'default',
  }).id;
}

function seedFile(driveId: string, path: string, content: string): number {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
  new FilesRepo(db).upsertOne({
    driveId,
    path,
    name: path.split(/[\\/]/).pop()!,
    extension: 'jpg',
    sizeBytes: Buffer.byteLength(content),
    category: 'image',
    sha256: sha(content),
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

describe('undoBatch', () => {
  it('reverses a same-drive move, putting the file back at its source', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule();
    const root = resolve(dir, 'V');
    const sourcePath = resolve(root, 'a.jpg');
    const destPath = resolve(root, 'Photos', 'a.jpg');
    const fileId = seedFile(driveId, sourcePath, 'content');

    const apply = await applyApprovedBatch({
      db,
      description: 'forward',
      operations: [
        plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, destPath),
      ],
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });
    expect(existsSync(destPath)).toBe(true);

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([[driveId, root]]),
    });

    expect(undo.reverted).toBe(1);
    expect(undo.skipped).toBe(0);
    expect(existsSync(sourcePath)).toBe(true);
    expect(existsSync(destPath)).toBe(false);
    expect(readFileSync(sourcePath, 'utf8')).toBe('content');
    const file = db.prepare(`SELECT path, state FROM files WHERE id = ?`).get(fileId) as {
      path: string;
      state: string;
    };
    expect(file.path).toBe(sourcePath);
    expect(file.state).toBe('indexed');
  });

  it('reverses a cross-drive move via quarantine restore', async () => {
    const sourceDriveId = seedDrive('SRC');
    const destDriveId = seedDrive('DST');
    seedScan(sourceDriveId);
    const ruleId = seedRule();
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'a.jpg');
    const destPath = resolve(destRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourceDriveId, sourcePath, 'content');

    const apply = await applyApprovedBatch({
      db,
      description: 'forward',
      operations: [
        plannedOp(
          fileId,
          ruleId,
          'cross-drive-move',
          sourceDriveId,
          sourcePath,
          destDriveId,
          destPath,
        ),
      ],
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [destDriveId, destRoot],
      ]),
      chunkBytes: 64 * 1024,
    });
    expect(existsSync(destPath)).toBe(true);
    expect(existsSync(sourcePath)).toBe(false);

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [destDriveId, destRoot],
      ]),
    });

    expect(undo.reverted).toBe(1);
    expect(existsSync(sourcePath)).toBe(true);
    expect(existsSync(destPath)).toBe(false);
    const file = db
      .prepare(`SELECT path, drive_id AS driveId, state FROM files WHERE id = ?`)
      .get(fileId) as { path: string; driveId: string; state: string };
    expect(file.path).toBe(sourcePath);
    expect(file.driveId).toBe(sourceDriveId);
    expect(file.state).toBe('indexed');
  });

  it('skips ops where the destination hash has drifted since the move', async () => {
    const driveId = seedDrive('V');
    seedScan(driveId);
    const ruleId = seedRule();
    const root = resolve(dir, 'V');
    const sourcePath = resolve(root, 'a.jpg');
    const destPath = resolve(root, 'Photos', 'a.jpg');
    const fileId = seedFile(driveId, sourcePath, 'content');

    const apply = await applyApprovedBatch({
      db,
      description: 'forward',
      operations: [
        plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, destPath),
      ],
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });
    writeFileSync(destPath, 'tampered after move');

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([[driveId, root]]),
    });

    expect(undo.reverted).toBe(0);
    expect(undo.skipped).toBe(1);
    expect(existsSync(destPath)).toBe(true);
    expect(existsSync(sourcePath)).toBe(false);
  });

  it('throws when the batch id is unknown', async () => {
    await expect(
      undoBatch({ db, batchId: 'nope', driveRoots: new Map() }),
    ).rejects.toThrow(/nope/);
  });

  it('rolls back source restore when dest unlink fails on cross-drive undo', async () => {
    const sourceDriveId = seedDrive('SRC');
    const destDriveId = seedDrive('DST');
    seedScan(sourceDriveId);
    const ruleId = seedRule();
    const sourceRoot = resolve(dir, 'SRC');
    const destRoot = resolve(dir, 'DST');
    const sourcePath = resolve(sourceRoot, 'a.jpg');
    const destPath = resolve(destRoot, 'Photos', 'a.jpg');
    const fileId = seedFile(sourceDriveId, sourcePath, 'content');

    const apply = await applyApprovedBatch({
      db,
      description: 'forward',
      operations: [
        plannedOp(
          fileId,
          ruleId,
          'cross-drive-move',
          sourceDriveId,
          sourcePath,
          destDriveId,
          destPath,
        ),
      ],
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [destDriveId, destRoot],
      ]),
      chunkBytes: 64 * 1024,
    });
    expect(existsSync(destPath)).toBe(true);
    expect(existsSync(sourcePath)).toBe(false);

    const spy = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      const err = Object.assign(new Error('ENOENT: no such file or directory, unlink'), {
        code: 'ENOENT',
      });
      throw err;
    });

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [destDriveId, destRoot],
      ]),
    });

    spy.mockRestore();

    expect(undo.reverted).toBe(0);
    expect(undo.skipped).toBe(1);
    expect(undo.errors).toHaveLength(1);
    expect(undo.errors[0]!.reason).toMatch(/could not remove dest/);

    // Source should NOT be back at its original location — it must be re-quarantined.
    expect(existsSync(sourcePath)).toBe(false);

    // A fresh quarantine row exists for the original_path under this batch.
    const qRow = db
      .prepare(
        `SELECT quarantine_path AS quarantinePath FROM quarantine
         WHERE original_path = ? AND batch_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(sourcePath, apply.batchId) as { quarantinePath: string } | undefined;
    expect(qRow).toBeDefined();
    expect(existsSync(qRow!.quarantinePath)).toBe(true);

    // Catalog still points at dest (unchanged from the original move).
    const file = db
      .prepare(`SELECT path, drive_id AS driveId, state FROM files WHERE id = ?`)
      .get(fileId) as { path: string; driveId: string; state: string };
    expect(file.path).toBe(destPath);
    expect(file.driveId).toBe(destDriveId);

    // The failed undo op carries a descriptive error message.
    const failedOp = db
      .prepare(
        `SELECT error_message AS errorMessage FROM operations
         WHERE batch_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1`,
      )
      .get(undo.undoBatchId) as { errorMessage: string | null } | undefined;
    expect(failedOp).toBeDefined();
    expect(failedOp!.errorMessage).toMatch(/could not remove dest/);
  });
});
