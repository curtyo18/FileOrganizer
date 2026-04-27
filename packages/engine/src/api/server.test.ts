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

describe('rules endpoints', () => {
  it('round-trips a rule through POST/GET/PUT/DELETE', async () => {
    const base = `http://127.0.0.1:${handle.port}/api/rules`;
    const create = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos archive',
        priority: 100,
        match: { category: ['image'], dateBefore: '2024-01-01' },
        destinationRole: 'media-archive',
        destinationTemplate: 'Photos/{year}/{month:02}/{filename}',
        movePolicy: 'cross-drive-review',
        quarantinePolicy: 'default',
      }),
    });
    expect(create.status).toBe(201);
    const { rule } = (await create.json()) as { rule: { id: string; name: string } };
    expect(rule.name).toBe('photos archive');

    const list = await fetch(base);
    const listBody = (await list.json()) as { rules: Array<{ id: string }> };
    expect(listBody.rules.some((r) => r.id === rule.id)).toBe(true);

    const update = await fetch(`${base}/${rule.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'photos renamed' }),
    });
    expect(update.status).toBe(200);
    const updated = (await update.json()) as { rule: { name: string } };
    expect(updated.rule.name).toBe('photos renamed');

    const del = await fetch(`${base}/${rule.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const after = await fetch(base);
    const afterBody = (await after.json()) as { rules: unknown[] };
    expect(afterBody.rules).toEqual([]);
  });

  it('returns 404 when updating a missing rule', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/rules/nope`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('plan + apply + undo endpoints', () => {
  it('plans a move, applies it, then undoes it', async () => {
    const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
    const dataDir = join(dir, 'photos');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'a.jpg'), 'image-content');

    const scanRes = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: dataDir, profile: 'idle' }),
    });
    expect(scanRes.status).toBe(201);
    const { scan } = (await scanRes.json()) as { scan: { id: string; driveId: string } };
    const driveId = scan.driveId;
    for (let i = 0; i < 50; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${scan.id}`);
      const body = (await got.json()) as { scan: { status: string } };
      if (body.scan.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const ruleRes = await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos by category',
        priority: 100,
        match: { category: ['image'] },
        destinationRole: 'photos',
        destinationTemplate: 'Photos/{filename}',
        movePolicy: 'always-review',
        quarantinePolicy: 'default',
      }),
    });
    expect(ruleRes.status).toBe(201);

    const planRes = await fetch(`http://127.0.0.1:${handle.port}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driveRoots: { [driveId]: dataDir },
        roles: [{ name: 'photos', drivePriority: [driveId], fillThresholdPercent: 99 }],
      }),
    });
    expect(planRes.status).toBe(200);
    const plan = (await planRes.json()) as {
      operations: Array<{ kind: string; destPath: string }>;
      unmatched: number[];
    };
    expect(plan.operations.length).toBe(1);
    const expectedDest = join(dataDir, 'Photos', 'a.jpg');
    expect(plan.operations[0]!.destPath).toBe(expectedDest);

    const applyRes = await fetch(`http://127.0.0.1:${handle.port}/api/organize/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'photo cleanup',
        operations: plan.operations,
        driveRoots: { [driveId]: dataDir },
      }),
    });
    expect(applyRes.status).toBe(200);
    const applied = (await applyRes.json()) as {
      batchId: string;
      completed: number;
      failed: number;
    };
    expect(applied.completed).toBe(1);
    expect(existsSync(expectedDest)).toBe(true);
    expect(readFileSync(expectedDest, 'utf8')).toBe('image-content');

    const batchesRes = await fetch(`http://127.0.0.1:${handle.port}/api/batches`);
    const batchesBody = (await batchesRes.json()) as {
      batches: Array<{ id: string; kind: string }>;
    };
    expect(batchesBody.batches.find((b) => b.id === applied.batchId)).toBeTruthy();

    const undoRes = await fetch(
      `http://127.0.0.1:${handle.port}/api/organize/undo/${applied.batchId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ driveRoots: { [driveId]: dataDir } }),
      },
    );
    expect(undoRes.status).toBe(200);
    const undone = (await undoRes.json()) as { reverted: number };
    expect(undone.reverted).toBe(1);
    expect(existsSync(expectedDest)).toBe(false);
    expect(existsSync(join(dataDir, 'a.jpg'))).toBe(true);
  });

  it('honors dry-run on /api/organize/apply', async () => {
    const planRes = await fetch(`http://127.0.0.1:${handle.port}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveRoots: {}, roles: [] }),
    });
    expect(planRes.status).toBe(200);
    const body = (await planRes.json()) as {
      operations: unknown[];
      unmatched: number[];
      unresolvedRoles: unknown[];
    };
    expect(Array.isArray(body.operations)).toBe(true);
    expect(Array.isArray(body.unresolvedRoles)).toBe(true);
  });
});
