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

  it('refuses to undo a cross-drive move when the destination hash has drifted (post_hash mismatch)', async () => {
    const sourceDriveId = seedDrive('SRC-T');
    const destDriveId = seedDrive('DST-T');
    seedScan(sourceDriveId);
    const ruleId = seedRule();
    const sourceRoot = resolve(dir, 'SRC-T');
    const destRoot = resolve(dir, 'DST-T');
    const sourcePath = resolve(sourceRoot, 'tamper.jpg');
    const destPath = resolve(destRoot, 'Photos', 'tamper.jpg');
    const fileId = seedFile(sourceDriveId, sourcePath, 'original-content');

    const apply = await applyApprovedBatch({
      db,
      description: 'forward cross-drive',
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

    // Verify post_hash was recorded on the completed op
    const opRow = db
      .prepare(
        `SELECT post_hash FROM operations WHERE batch_id = ? AND kind = 'copy' ORDER BY id DESC LIMIT 1`,
      )
      .get(apply.batchId) as { post_hash: string | null };
    expect(opRow.post_hash).toBe(sha('original-content'));

    // Tamper with the destination to trigger mismatch
    writeFileSync(destPath, 'tampered-content-different');

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [destDriveId, destRoot],
      ]),
    });

    // The undo must be refused: skipped=1, reverted=0, errors contains the mismatch reason
    expect(undo.reverted).toBe(0);
    expect(undo.skipped).toBe(1);
    expect(undo.errors).toHaveLength(1);
    expect(undo.errors[0]!.reason).toMatch(/post_hash/);
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

    // After re-quarantine, catalog must reflect reality: state='quarantined',
    // path pointing at the new quarantine location — NOT the stale destPath.
    const file = db
      .prepare(`SELECT path, drive_id AS driveId, state FROM files WHERE id = ?`)
      .get(fileId) as { path: string; driveId: string; state: string };
    expect(file.state).toBe('quarantined');
    // The path must be the new quarantine path (under sourceRoot), not destPath.
    expect(file.path).not.toBe(destPath);
    expect(file.path).toContain('_FileOrganizer_quarantine');

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

  it('reverseCompletedViaExisting: restores source from quarantine, dest stays intact', async () => {
    // When the dest already had identical content, moveCrossDrive produces
    // completed-via-existing: source is quarantined, dest untouched.
    // undoBatch must restore the source file and mark files.state='indexed'.
    const sourceDriveId = seedDrive('SRC2');
    const destDriveId = seedDrive('DST2');
    seedScan(sourceDriveId);
    const ruleId = seedRule();
    const sourceRoot = resolve(dir, 'SRC2');
    const destRoot = resolve(dir, 'DST2');
    const sourcePath = resolve(sourceRoot, 'b.jpg');
    const destPath = resolve(destRoot, 'Photos', 'b.jpg');
    const content = 'identical-content';
    const fileId = seedFile(sourceDriveId, sourcePath, content);

    // Pre-create dest with the same content so resolveCollision picks same-content.
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    writeFileSync(destPath, content);

    const apply = await applyApprovedBatch({
      db,
      description: 'forward-via-existing',
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

    // After apply: source was quarantined (not at original path), dest still present.
    expect(existsSync(sourcePath)).toBe(false);
    expect(existsSync(destPath)).toBe(true);
    const preUndoFile = db
      .prepare(`SELECT state FROM files WHERE id = ?`)
      .get(fileId) as { state: string };
    expect(preUndoFile.state).toBe('quarantined');

    // Verify a quarantine row exists.
    const qBefore = db
      .prepare(
        `SELECT id FROM quarantine WHERE original_path = ? AND batch_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(sourcePath, apply.batchId) as { id: number } | undefined;
    expect(qBefore).toBeDefined();

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [destDriveId, destRoot],
      ]),
    });

    expect(undo.reverted).toBe(1);
    expect(undo.skipped).toBe(0);
    expect(undo.errors).toHaveLength(0);

    // Source file is back at its original path with correct content.
    expect(existsSync(sourcePath)).toBe(true);
    expect(readFileSync(sourcePath, 'utf8')).toBe(content);

    // Dest file is still present (it was never the source's copy).
    expect(existsSync(destPath)).toBe(true);

    // Catalog: state='indexed', path unchanged.
    const file = db
      .prepare(`SELECT path, drive_id AS driveId, state FROM files WHERE id = ?`)
      .get(fileId) as { path: string; driveId: string; state: string };
    expect(file.state).toBe('indexed');
    expect(file.path).toBe(sourcePath);
    expect(file.driveId).toBe(sourceDriveId);

    // Quarantine row deleted after restore.
    const qAfter = db
      .prepare(
        `SELECT id FROM quarantine WHERE original_path = ? AND batch_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(sourcePath, apply.batchId) as { id: number } | undefined;
    expect(qAfter).toBeUndefined();
  });

  it('failed undo of a cross-drive completed op records the undo op with kind="restore", not "copy"', async () => {
    const sourceDriveId = seedDrive('SRC-FK');
    const destDriveId = seedDrive('DST-FK');
    seedScan(sourceDriveId);
    const ruleId = seedRule();
    const sourceRoot = resolve(dir, 'SRC-FK');
    const destRoot = resolve(dir, 'DST-FK');
    const sourcePath = resolve(sourceRoot, 'fk.jpg');
    const destPath = resolve(destRoot, 'Photos', 'fk.jpg');
    const fileId = seedFile(sourceDriveId, sourcePath, 'content-fk');

    const apply = await applyApprovedBatch({
      db,
      description: 'forward cross-drive fk',
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

    // Tamper dest so hash verification fails, triggering the failure path.
    writeFileSync(destPath, 'tampered-fk');

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([
        [sourceDriveId, sourceRoot],
        [destDriveId, destRoot],
      ]),
    });

    expect(undo.reverted).toBe(0);
    expect(undo.skipped).toBe(1);
    expect(undo.errors).toHaveLength(1);

    // The failed undo op must use kind='restore' (inverse of cross-drive 'copy'),
    // NOT 'copy' (the original op.kind).
    const failedOp = db
      .prepare(
        `SELECT kind, status FROM operations WHERE batch_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1`,
      )
      .get(undo.undoBatchId) as { kind: string; status: string } | undefined;
    expect(failedOp).toBeDefined();
    expect(failedOp!.kind).toBe('restore');
    expect(failedOp!.kind).not.toBe('copy');
  });

  it('failed undo of a same-drive completed op records the undo op with kind="move"', async () => {
    const driveId = seedDrive('V-FK');
    seedScan(driveId);
    const ruleId = seedRule();
    const root = resolve(dir, 'V-FK');
    const sourcePath = resolve(root, 'sd.jpg');
    const destPath = resolve(root, 'Photos', 'sd.jpg');
    const fileId = seedFile(driveId, sourcePath, 'content-sd');

    const apply = await applyApprovedBatch({
      db,
      description: 'forward same-drive fk',
      operations: [
        plannedOp(fileId, ruleId, 'same-drive-move', driveId, sourcePath, driveId, destPath),
      ],
      driveRoots: new Map([[driveId, root]]),
      chunkBytes: 64 * 1024,
    });
    expect(existsSync(destPath)).toBe(true);

    // Tamper dest so hash verification fails.
    writeFileSync(destPath, 'tampered-sd');

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([[driveId, root]]),
    });

    expect(undo.reverted).toBe(0);
    expect(undo.skipped).toBe(1);
    expect(undo.errors).toHaveLength(1);

    const failedOp = db
      .prepare(
        `SELECT kind, status FROM operations WHERE batch_id = ? AND status = 'failed' ORDER BY id DESC LIMIT 1`,
      )
      .get(undo.undoBatchId) as { kind: string; status: string } | undefined;
    expect(failedOp).toBeDefined();
    expect(failedOp!.kind).toBe('move');
  });

  it('kind counts for a mixed-result undo batch are consistent', async () => {
    // Two ops in the forward batch: one same-drive (succeeds undo), one cross-drive (fails undo).
    const driveA = seedDrive('MIX-A');
    const driveB = seedDrive('MIX-B');
    seedScan(driveA);
    const ruleId = seedRule();
    const rootA = resolve(dir, 'MIX-A');
    const rootB = resolve(dir, 'MIX-B');

    // Same-drive op (will succeed undo).
    const pathA1 = resolve(rootA, 'mix1.jpg');
    const pathA2 = resolve(rootA, 'Photos', 'mix1.jpg');
    const fileA = seedFile(driveA, pathA1, 'content-a');

    // Cross-drive op (will fail undo due to hash tamper).
    const pathB1 = resolve(rootA, 'mix2.jpg');
    const pathB2 = resolve(rootB, 'Photos', 'mix2.jpg');
    const fileB = seedFile(driveA, pathB1, 'content-b');

    const apply = await applyApprovedBatch({
      db,
      description: 'forward mixed',
      operations: [
        plannedOp(fileA, ruleId, 'same-drive-move', driveA, pathA1, driveA, pathA2),
        plannedOp(fileB, ruleId, 'cross-drive-move', driveA, pathB1, driveB, pathB2),
      ],
      driveRoots: new Map([
        [driveA, rootA],
        [driveB, rootB],
      ]),
      chunkBytes: 64 * 1024,
    });

    // Tamper cross-drive dest to trigger failure in undo.
    writeFileSync(pathB2, 'tampered-b');

    const undo = await undoBatch({
      db,
      batchId: apply.batchId,
      driveRoots: new Map([
        [driveA, rootA],
        [driveB, rootB],
      ]),
    });

    // One succeeds, one fails (skipped counts the error).
    expect(undo.reverted).toBe(1);
    expect(undo.errors).toHaveLength(1);

    // Query kind counts on the undo batch.
    const counts = db
      .prepare(
        `SELECT kind, COUNT(*) AS cnt FROM operations WHERE batch_id = ? GROUP BY kind ORDER BY kind`,
      )
      .all(undo.undoBatchId) as { kind: string; cnt: number }[];

    // All undo ops should use inverse-undo kinds: 'move' for same-drive, 'restore' for cross-drive.
    // There must be NO 'copy' rows (that would mean the bug is present).
    const copyRow = counts.find((r) => r.kind === 'copy');
    expect(copyRow).toBeUndefined();

    const moveRow = counts.find((r) => r.kind === 'move');
    expect(moveRow).toBeDefined();
    expect(moveRow!.cnt).toBe(1);

    const restoreRow = counts.find((r) => r.kind === 'restore');
    expect(restoreRow).toBeDefined();
    expect(restoreRow!.cnt).toBe(1);
  });
});
