import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { reconcileOnStartup } from './reconcile.js';

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
    expect(result).toEqual({ scanned: 0, fixed: 0, ambiguous: 0 });
  });
});
