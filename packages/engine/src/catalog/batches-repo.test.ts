import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { BatchesRepo } from './batches-repo.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-batches-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('BatchesRepo', () => {
  it('starts a batch and assigns a uuid', () => {
    const repo = new BatchesRepo(db);
    const b = repo.start({ kind: 'dedupe', description: 'test' });
    expect(b.id).toBeTruthy();
    expect(b.kind).toBe('dedupe');
    expect(b.status).toBe('in-progress');
  });

  it('records operations under a batch', () => {
    const repo = new BatchesRepo(db);
    const b = repo.start({ kind: 'dedupe', description: 't' });
    const op = repo.recordOperation(b.id, {
      kind: 'quarantine',
      sourceDriveId: 'd1',
      sourcePath: '/x/y.jpg',
      preHash: 'h',
      status: 'pending',
    });
    expect(op.id).toBeGreaterThan(0);
    repo.updateOperationStatus(op.id, 'completed', { quarantinePath: '/q/y.jpg' });
    const ops = repo.listOperations(b.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('completed');
    expect(ops[0]!.quarantinePath).toBe('/q/y.jpg');
  });

  it('finishes a batch and lists most-recent first', () => {
    const repo = new BatchesRepo(db);
    const b1 = repo.start({ kind: 'dedupe', description: 'a' });
    repo.finish(b1.id, 'completed', {});
    const b2 = repo.start({ kind: 'move', description: 'b' });
    repo.finish(b2.id, 'completed', {});
    const list = repo.list({ limit: 10 });
    expect(list[0]!.id).toBe(b2.id);
    expect(list[1]!.id).toBe(b1.id);
  });

  it('updateOperationStatus persists postHash, errorMessage, and destPath to correct columns', () => {
    // This test guards against SQL column-name typos in the dynamic UPDATE
    // built by updateOperationStatus. Each optional field maps to a specific
    // DB column; a rename in one but not the other would be a silent no-op.
    const repo = new BatchesRepo(db);
    const batch = repo.start({ kind: 'move', description: 'field-write-test' });
    const op = repo.recordOperation(batch.id, {
      kind: 'move',
      sourceDriveId: 'd1',
      sourcePath: '/src/file.jpg',
      status: 'in-progress',
    });

    repo.updateOperationStatus(op.id, 'completed', {
      postHash: 'abc123postHash',
      errorMessage: 'boom: something went wrong',
      destPath: '/dest/file.jpg',
    });

    // Query the raw DB row to confirm each field landed in the right column.
    const row = db
      .prepare(`SELECT post_hash, error_message, dest_path, status FROM operations WHERE id = ?`)
      .get(op.id) as {
        post_hash: string | null;
        error_message: string | null;
        dest_path: string | null;
        status: string;
      } | undefined;

    expect(row).toBeDefined();
    expect(row!.status).toBe('completed');
    expect(row!.post_hash).toBe('abc123postHash');
    expect(row!.error_message).toBe('boom: something went wrong');
    expect(row!.dest_path).toBe('/dest/file.jpg');

    // Confirm the OperationRecord returned by findOperation also maps them correctly.
    const record = repo.findOperation(op.id);
    expect(record).toBeDefined();
    expect(record!.postHash).toBe('abc123postHash');
    expect(record!.errorMessage).toBe('boom: something went wrong');
    expect(record!.destPath).toBe('/dest/file.jpg');
  });
});
