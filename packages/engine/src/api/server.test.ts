import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { createServer, type ServerHandle } from './server.js';

let dir: string;
let db: Catalog;
let handle: ServerHandle;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-api-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  handle = await createServer({ db, port: 0, hostname: '127.0.0.1' });
});

afterEach(async () => {
  await handle.close();
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('API server', () => {
  it('binds a port and serves /healthz', async () => {
    const url = `http://127.0.0.1:${handle.port}/healthz`;
    const res = await fetch(url);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('lists drives at /api/drives', async () => {
    const url = `http://127.0.0.1:${handle.port}/api/drives`;
    const res = await fetch(url);
    const body = (await res.json()) as { drives: unknown[] };
    expect(res.status).toBe(200);
    expect(body.drives).toEqual([]);
  });

  it('returns 404 for unknown route', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/nope`);
    expect(res.status).toBe(404);
  });
});
