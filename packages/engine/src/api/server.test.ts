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

describe('API server scans endpoint', () => {
  it('scans a brand-new path, auto-registering the drive (UI-friendly flow)', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dataDir = join(dir, 'fresh-scan');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'a.jpg'), 'aaa');
    const post = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: dataDir, profile: 'idle' }),
    });
    expect(post.status).toBe(201);
    const { scan } = (await post.json()) as { scan: { id: string; driveId: string } };
    expect(scan.driveId).toBeTruthy();
    for (let i = 0; i < 50; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${scan.id}`);
      const body = (await got.json()) as { scan: { status: string } };
      if (body.scan.status === 'completed') {
        const drivesRes = await fetch(`http://127.0.0.1:${handle.port}/api/drives`);
        const drivesBody = (await drivesRes.json()) as { drives: Array<{ id: string }> };
        expect(drivesBody.drives.length).toBeGreaterThan(0);
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('scan did not complete in time');
  });

  it('starts a scan via POST /api/scans and reaches completion', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'a.jpg'), 'aaa');
    const { DriveRepo } = await import('../drives/repo.js');
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'X',
      label: 'X',
      currentLetter: null,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    const post = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveId: drive.id, rootPaths: [dataDir], profile: 'idle' }),
    });
    expect(post.status).toBe(201);
    const { scan } = (await post.json()) as { scan: { id: string } };
    for (let i = 0; i < 50; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${scan.id}`);
      const body = (await got.json()) as { scan: { status: string } };
      if (body.scan.status === 'completed') return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('scan did not complete in time');
  });
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
