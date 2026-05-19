import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { reconcileOnStartup } from './reconcile.js';
import { QUARANTINE_DIR_NAME } from '../quarantine/quarantine.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from './files-repo.js';
import { RulesRepo } from '../rules/repo.js';
import { applyApprovedBatch } from '../organize/applier.js';
import type { PlannedOperation } from '../organize/planner.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-rec-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

interface OpInsert {
  batch_id: string;
  kind: string;
  source_path: string | null;
  dest_path: string | null;
  pre_hash: string | null;
  post_hash: string | null;
  status: string;
}

function insertOp(values: OpInsert): number {
  const result = db
    .prepare(
      `INSERT INTO operations (batch_id, kind, source_path, dest_path, pre_hash, post_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.batch_id,
      values.kind,
      values.source_path,
      values.dest_path,
      values.pre_hash,
      values.post_hash,
      values.status,
    );
  return Number(result.lastInsertRowid);
}

describe('reconcileOnStartup', () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO batches (id, kind, started_at, status, description, summary) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('b1', 'move', '2024-01-01T00:00:00Z', 'in-progress', 't', '{}');
  });

  it('marks an op completed when destination has the recorded post_hash', async () => {
    const dest = join(dir, 'a.jpg');
    writeFileSync(dest, 'content');
    const opId = insertOp({
      batch_id: 'b1',
      kind: 'move',
      source_path: join(dir, 'never'),
      dest_path: dest,
      pre_hash: sha('content'),
      post_hash: sha('content'),
      status: 'in-progress',
    });
    const result = await reconcileOnStartup(db);
    const op = db.prepare(`SELECT status FROM operations WHERE id = ?`).get(opId) as {
      status: string;
    };
    expect(op.status).toBe('completed');
    expect(result.fixed).toBeGreaterThanOrEqual(1);
  });

  it('marks an op failed when destination is missing and source still exists', async () => {
    const src = join(dir, 'a.jpg');
    writeFileSync(src, 'content');
    const opId = insertOp({
      batch_id: 'b1',
      kind: 'move',
      source_path: src,
      dest_path: join(dir, 'gone'),
      pre_hash: sha('content'),
      post_hash: null,
      status: 'in-progress',
    });
    await reconcileOnStartup(db);
    const op = db.prepare(`SELECT status, error_message FROM operations WHERE id = ?`).get(opId) as {
      status: string;
      error_message: string;
    };
    expect(op.status).toBe('failed');
    expect(op.error_message).toMatch(/never finished/);
  });

  it('marks ambiguous ops failed with explanatory message', async () => {
    const opId = insertOp({
      batch_id: 'b1',
      kind: 'move',
      source_path: join(dir, 'gone'),
      dest_path: join(dir, 'also-gone'),
      pre_hash: 'x',
      post_hash: 'y',
      status: 'in-progress',
    });
    const result = await reconcileOnStartup(db);
    const op = db.prepare(`SELECT status, error_message FROM operations WHERE id = ?`).get(opId) as {
      status: string;
      error_message: string;
    };
    expect(op.status).toBe('failed');
    expect(op.error_message).toMatch(/ambiguous/);
    expect(result.ambiguous).toBeGreaterThanOrEqual(1);
  });

  it('finalizes batches whose ops are now all terminal', async () => {
    insertOp({
      batch_id: 'b1',
      kind: 'move',
      source_path: join(dir, 'gone'),
      dest_path: join(dir, 'gone2'),
      pre_hash: 'x',
      post_hash: 'y',
      status: 'in-progress',
    });
    await reconcileOnStartup(db);
    const batch = db.prepare(`SELECT status FROM batches WHERE id = 'b1'`).get() as {
      status: string;
    };
    expect(batch.status).toBe('failed');
  });

  it('returns scanned=0 when there are no in-progress ops', async () => {
    const result = await reconcileOnStartup(db);
    expect(result).toEqual({ scanned: 0, fixed: 0, ambiguous: 0, quarantineOrphans: [] });
  });
});

describe('reconcileOnStartup – atomicity', () => {
  it('rolls back all op updates when a DB error occurs mid-loop', async () => {
    // Insert a batch
    db.prepare(
      `INSERT INTO batches (id, kind, started_at, status, description, summary) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('b-atomic', 'move', '2024-01-01T00:00:00Z', 'in-progress', 't', '{}');

    // Insert 3 in-progress ops; none have matching filesystem files so all will resolve to 'failed'
    const ids = [1, 2, 3].map((i) =>
      insertOp({
        batch_id: 'b-atomic',
        kind: 'move',
        source_path: join(dir, `gone${String(i)}`),
        dest_path: join(dir, `also-gone${String(i)}`),
        pre_hash: 'x',
        post_hash: 'y',
        status: 'in-progress',
      }),
    );

    // Patch db.prepare so the 3rd UPDATE operations call throws — simulating a mid-loop crash.
    // We wrap the real prepare and count UPDATE operations calls.
    let updateOpsCallCount = 0;
    const originalPrepare = db.prepare.bind(db);
    const prepareStub = (sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.startsWith('UPDATE operations SET status')) {
        updateOpsCallCount += 1;
        if (updateOpsCallCount === 3) {
          // Return a fake statement whose run() throws
          return {
            run: (..._args: unknown[]) => {
              throw new Error('simulated DB crash on 3rd UPDATE');
            },
          } as unknown as ReturnType<typeof db.prepare>;
        }
      }
      return stmt;
    };
    db.prepare = prepareStub as typeof db.prepare;

    await expect(reconcileOnStartup(db)).rejects.toThrow('simulated DB crash');

    // Restore real prepare
    db.prepare = originalPrepare;

    // All 3 ops must still be 'in-progress' — the transaction rolled back
    for (const id of ids) {
      const op = db.prepare(`SELECT status FROM operations WHERE id = ?`).get(id) as {
        status: string;
      };
      expect(op.status).toBe('in-progress');
    }
  });
});

describe('reconcileOnStartup – quarantine orphan detection', () => {
  beforeEach(() => {
    // Insert a drive with a real mount_path pointing into our temp dir
    db.prepare(
      `INSERT INTO drives (id, volume_serial, label, current_letter, kind, last_seen_at, mount_path)
       VALUES ('d1', 'VOL1', 'TestDrive', 'T', 'local', '2026-01-01T00:00:00Z', ?)`,
    ).run(dir);
    // Insert a batch so the quarantine FK can reference it
    db.prepare(
      `INSERT INTO batches (id, kind, started_at, status, description, summary)
       VALUES ('batchA', 'quarantine', '2026-01-01T00:00:00Z', 'completed', 't', '{}')`,
    ).run();
  });

  it('detects a quarantine orphan – file on disk with no quarantine row', async () => {
    // Simulate a crash after renameSync but before INSERT INTO quarantine:
    // create the file under the quarantine folder without a DB row
    const orphanPath = join(dir, QUARANTINE_DIR_NAME, 'batchA', 'photos', 'img.jpg');
    mkdirSync(join(dir, QUARANTINE_DIR_NAME, 'batchA', 'photos'), { recursive: true });
    writeFileSync(orphanPath, 'orphan-content');

    // No quarantine row inserted — DB has no record of this file

    const result = await reconcileOnStartup(db);

    // The orphan must appear in the result
    expect(result.quarantineOrphans).toBeDefined();
    expect(result.quarantineOrphans).toHaveLength(1);
    expect(result.quarantineOrphans[0]).toBe(orphanPath);
  });

  it('does NOT classify a legitimately-present quarantine file as an orphan', async () => {
    // Create the file under the quarantine folder
    const quarantinePath = join(dir, QUARANTINE_DIR_NAME, 'batchA', 'docs', 'report.pdf');
    mkdirSync(join(dir, QUARANTINE_DIR_NAME, 'batchA', 'docs'), { recursive: true });
    writeFileSync(quarantinePath, 'legit-content');

    // Insert a matching quarantine row
    db.prepare(
      `INSERT INTO quarantine (drive_id, original_path, original_size, original_sha256,
       original_mtime, quarantine_path, quarantined_at, batch_id)
       VALUES ('d1', ?, 13, 'abc123', '2026-01-01T00:00:00Z', ?, '2026-01-01T00:00:00Z', 'batchA')`,
    ).run(join(dir, 'docs', 'report.pdf'), quarantinePath);

    const result = await reconcileOnStartup(db);

    expect(result.quarantineOrphans).toBeDefined();
    expect(result.quarantineOrphans).toHaveLength(0);
  });
});

// Helpers shared by the pipeline test below
function seedDriveRec(db: Catalog, label: string, mountPath: string): string {
  return new DriveRepo(db).upsert({
    volumeSerial: `serial-rec-${label}`,
    label,
    currentLetter: null,
    mountPath,
    kind: 'local',
    roles: [],
    totalBytes: 1_000_000,
    freeBytes: 800_000,
  }).id;
}

function seedScanRec(db: Catalog, driveId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('scan-rec-1', driveId, new Date().toISOString(), 'completed', 'balanced');
}

function seedFileRec(db: Catalog, driveId: string, path: string, content: string): number {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
  new FilesRepo(db).upsertOne({
    driveId,
    path,
    name: path.split(/[\\/]/).pop()!,
    extension: 'jpg',
    sizeBytes: Buffer.byteLength(content),
    category: 'image',
    sha256: createHash('sha256').update(content).digest('hex'),
    mtime: '2024-01-01T00:00:00.000Z',
    ctime: '2024-01-01T00:00:00.000Z',
    exifDate: null,
    dateSource: 'mtime',
    width: null,
    height: null,
    durationSeconds: null,
    ntfsFileId: null,
    state: 'indexed',
    scanId: 'scan-rec-1',
  });
  return (db.prepare(`SELECT id FROM files WHERE path = ?`).get(path) as { id: number }).id;
}

describe('reconcileOnStartup – post_hash written by production applier', () => {
  it('reconcile marks a crashed cross-drive copy completed when post_hash is set and dest matches', async () => {
    // Set up two drives in the same temp dir
    const srcRoot = join(dir, 'SRC');
    const dstRoot = join(dir, 'DST');
    mkdirSync(srcRoot, { recursive: true });
    mkdirSync(dstRoot, { recursive: true });

    const srcDriveId = seedDriveRec(db, 'SRC', srcRoot);
    const dstDriveId = seedDriveRec(db, 'DST', dstRoot);
    seedScanRec(db, srcDriveId);

    const ruleId = new RulesRepo(db).create({
      name: 'r-rec',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{filename}',
      movePolicy: 'always-review',
      quarantinePolicy: 'default',
    }).id;

    const srcPath = join(srcRoot, 'photo.jpg');
    const dstPath = join(dstRoot, 'Photos', 'photo.jpg');
    const fileId = seedFileRec(db, srcDriveId, srcPath, 'test-content');

    const applyOp: PlannedOperation = {
      fileId,
      ruleId,
      sourceDriveId: srcDriveId,
      sourcePath: srcPath,
      destDriveId: dstDriveId,
      destPath: dstPath,
      kind: 'cross-drive-move',
      estimatedBytes: 12,
    };

    const applyResult = await applyApprovedBatch({
      db,
      description: 'test forward move',
      operations: [applyOp],
      driveRoots: new Map([
        [srcDriveId, srcRoot],
        [dstDriveId, dstRoot],
      ]),
      chunkBytes: 64 * 1024,
    });

    // Verify the applier wrote post_hash on the operation row
    const opRow = db
      .prepare(
        `SELECT post_hash, quarantine_path FROM operations
         WHERE batch_id = ? AND kind = 'copy' ORDER BY id DESC LIMIT 1`,
      )
      .get(applyResult.batchId) as { post_hash: string | null; quarantine_path: string | null };

    // post_hash must be written (this is what B3 fixes)
    expect(opRow.post_hash).toBe(createHash('sha256').update('test-content').digest('hex'));
    // quarantine_path must be recorded so reconcile can walk it
    expect(opRow.quarantine_path).toBeTruthy();

    // Simulate a crash: force the op back to in-progress
    db.prepare(`UPDATE operations SET status = 'in-progress' WHERE batch_id = ?`).run(
      applyResult.batchId,
    );

    // Now reconcile — dest is present and matches post_hash → should mark completed
    const reconcileResult = await reconcileOnStartup(db);

    const reconciledOp = db
      .prepare(`SELECT status FROM operations WHERE batch_id = ? AND kind = 'copy'`)
      .get(applyResult.batchId) as { status: string };

    expect(reconciledOp.status).toBe('completed');
    expect(reconcileResult.fixed).toBeGreaterThanOrEqual(1);
  });
});
