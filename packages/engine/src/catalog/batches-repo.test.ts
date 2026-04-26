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
});
