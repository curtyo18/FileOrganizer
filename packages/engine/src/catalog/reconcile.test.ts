import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { reconcileOnStartup } from './reconcile.js';
import { QUARANTINE_DIR_NAME } from '../quarantine/quarantine.js';

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
