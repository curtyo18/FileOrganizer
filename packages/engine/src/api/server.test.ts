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

  it('cancels a running scan via POST /api/scans/:id/cancel', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dataDir = join(dir, 'cancel-data');
    mkdirSync(dataDir, { recursive: true });
    for (let i = 0; i < 800; i += 1) {
      writeFileSync(join(dataDir, `f${String(i).padStart(4, '0')}.jpg`), `payload-${i}`.repeat(80));
    }
    const post = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: dataDir, profile: 'idle' }),
    });
    expect(post.status).toBe(201);
    const { scan } = (await post.json()) as { scan: { id: string } };
    await new Promise((r) => setTimeout(r, 50));
    const cancel = await fetch(
      `http://127.0.0.1:${handle.port}/api/scans/${scan.id}/cancel`,
      { method: 'POST' },
    );
    expect(cancel.status).toBe(200);
    for (let i = 0; i < 50; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${scan.id}`);
      const body = (await got.json()) as { scan: { status: string } };
      if (body.scan.status === 'cancelled') return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('scan never reached cancelled status');
  });

  it('returns 404 cancelling an unknown scan id', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/scans/no-such/cancel`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
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

describe('settings endpoints', () => {
  it('round-trips settings via GET and PUT', async () => {
    const base = `http://127.0.0.1:${handle.port}/api/settings`;
    const initial = await fetch(base);
    expect(initial.status).toBe(200);
    const body = (await initial.json()) as {
      settings: { throttleProfiles: { idle: { localHashWorkers: number } } };
    };
    expect(body.settings.throttleProfiles.idle.localHashWorkers).toBeGreaterThanOrEqual(1);

    const next = {
      ...body.settings,
      throttleProfiles: {
        ...body.settings.throttleProfiles,
        idle: { ...body.settings.throttleProfiles.idle, localHashWorkers: 7 },
      },
    };
    const put = await fetch(base, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: next }),
    });
    expect(put.status).toBe(200);

    const after = await fetch(base);
    const afterBody = (await after.json()) as {
      settings: { throttleProfiles: { idle: { localHashWorkers: number } } };
    };
    expect(afterBody.settings.throttleProfiles.idle.localHashWorkers).toBe(7);
  });

  it('invokes onSettingsChanged when settings are saved', async () => {
    const calls: number[] = [];
    const localDb = openCatalog(join(dir, 'cb.db'));
    migrate(localDb);
    const cbHandle = await createServer({
      db: localDb,
      port: 0,
      hostname: '127.0.0.1',
      onSettingsChanged: (s) => calls.push(s.throttleProfiles.idle.localHashWorkers),
    });
    try {
      const initial = await (
        await fetch(`http://127.0.0.1:${cbHandle.port}/api/settings`)
      ).json() as { settings: { throttleProfiles: { idle: { localHashWorkers: number } } } };
      const next = {
        ...initial.settings,
        throttleProfiles: {
          ...initial.settings.throttleProfiles,
          idle: { ...initial.settings.throttleProfiles.idle, localHashWorkers: 13 },
        },
      };
      await fetch(`http://127.0.0.1:${cbHandle.port}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      });
      expect(calls).toEqual([13]);
    } finally {
      await cbHandle.close();
      closeCatalog(localDb);
    }
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

describe('roles endpoints', () => {
  it('round-trips a role through POST/GET/PUT/DELETE and reorders priorities', async () => {
    const { DriveRepo } = await import('../drives/repo.js');
    const d1 = new DriveRepo(db).upsert({
      volumeSerial: 'A',
      label: 'A',
      currentLetter: null,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    }).id;
    const d2 = new DriveRepo(db).upsert({
      volumeSerial: 'B',
      label: 'B',
      currentLetter: null,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    }).id;
    const base = `http://127.0.0.1:${handle.port}/api/roles`;

    const create = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'media-archive',
        drivePriority: [d1, d2],
        fillThresholdPercent: 90,
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      role: { name: string; drivePriority: string[] };
    };
    expect(created.role.name).toBe('media-archive');
    expect(created.role.drivePriority).toEqual([d1, d2]);

    const list = await fetch(base);
    const listBody = (await list.json()) as {
      roles: Array<{ name: string; drivePriority: string[] }>;
    };
    expect(listBody.roles.some((r) => r.name === 'media-archive')).toBe(true);

    const reorder = await fetch(`${base}/media-archive`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drivePriority: [d2, d1] }),
    });
    expect(reorder.status).toBe(200);
    const reordered = (await reorder.json()) as {
      role: { drivePriority: string[]; fillThresholdPercent: number };
    };
    expect(reordered.role.drivePriority).toEqual([d2, d1]);
    expect(reordered.role.fillThresholdPercent).toBe(90);

    const updateThreshold = await fetch(`${base}/media-archive`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fillThresholdPercent: 80 }),
    });
    expect(updateThreshold.status).toBe(200);
    const thresholdBody = (await updateThreshold.json()) as {
      role: { fillThresholdPercent: number; drivePriority: string[] };
    };
    expect(thresholdBody.role.fillThresholdPercent).toBe(80);
    expect(thresholdBody.role.drivePriority).toEqual([d2, d1]);

    const del = await fetch(`${base}/media-archive`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const after = await fetch(base);
    const afterBody = (await after.json()) as { roles: unknown[] };
    expect(afterBody.roles).toEqual([]);
  });

  it('rejects duplicate role names with 409 and unknown drives with 400', async () => {
    const { DriveRepo } = await import('../drives/repo.js');
    const driveId = new DriveRepo(db).upsert({
      volumeSerial: 'C',
      label: 'C',
      currentLetter: null,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    }).id;
    const base = `http://127.0.0.1:${handle.port}/api/roles`;

    const first = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'dup',
        drivePriority: [driveId],
        fillThresholdPercent: 90,
      }),
    });
    expect(first.status).toBe(201);

    const dup = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'dup',
        drivePriority: [driveId],
        fillThresholdPercent: 90,
      }),
    });
    expect(dup.status).toBe(409);

    const bad = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'has-bad-drive',
        drivePriority: ['ghost-drive'],
        fillThresholdPercent: 90,
      }),
    });
    expect(bad.status).toBe(400);

    const missing = await fetch(`${base}/no-such`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fillThresholdPercent: 50 }),
    });
    expect(missing.status).toBe(404);
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

    const roleRes = await fetch(`http://127.0.0.1:${handle.port}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        drivePriority: [driveId],
        fillThresholdPercent: 99,
      }),
    });
    expect(roleRes.status).toBe(201);

    const planRes = await fetch(`http://127.0.0.1:${handle.port}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driveRoots: { [driveId]: dataDir },
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
      body: JSON.stringify({ driveRoots: {} }),
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

  it('returns 503 when a cross-drive apply hits a DriveError (disconnected drive)', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const sourceRoot = join(dir, 'src-root');
    const destRoot = join(dir, 'dst-root');
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(destRoot, { recursive: true });
    const srcFile = join(sourceRoot, 'p.jpg');
    writeFileSync(srcFile, 'payload');

    const { DriveRepo } = await import('../drives/repo.js');
    const drives = new DriveRepo(db);
    const sourceDrive = drives.upsert({
      volumeSerial: 'API-SRC',
      label: 'API-SRC',
      currentLetter: null,
      mountPath: null,
      kind: 'local',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 900_000_000,
    });
    const destDrive = drives.upsert({
      volumeSerial: 'API-NAS',
      label: 'API-NAS',
      currentLetter: null,
      mountPath: null,
      kind: 'network',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 900_000_000,
    });

    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('api-scan', sourceDrive.id, new Date().toISOString(), 'completed', 'idle');
    const { FilesRepo } = await import('../catalog/files-repo.js');
    new FilesRepo(db).upsertOne({
      driveId: sourceDrive.id,
      path: srcFile,
      name: 'p.jpg',
      extension: 'jpg',
      sizeBytes: 7,
      category: 'image',
      sha256: 'abc',
      mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z',
      exifDate: null,
      dateSource: 'mtime',
      width: null,
      height: null,
      durationSeconds: null,
      ntfsFileId: null,
      state: 'indexed',
      scanId: 'api-scan',
    });
    const fileId = (db.prepare(`SELECT id FROM files WHERE path = ?`).get(srcFile) as { id: number })
      .id;

    rmSync(srcFile);

    const applyRes = await fetch(`http://127.0.0.1:${handle.port}/api/organize/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'nas-disconnect',
        operations: [
          {
            fileId,
            ruleId: 'r-api',
            sourceDriveId: sourceDrive.id,
            sourcePath: srcFile,
            destDriveId: destDrive.id,
            destPath: join(destRoot, 'p.jpg'),
            kind: 'cross-drive-move',
            estimatedBytes: 7,
          },
        ],
        driveRoots: { [sourceDrive.id]: sourceRoot, [destDrive.id]: destRoot },
      }),
    });

    expect(applyRes.status).toBe(503);
    const body = (await applyRes.json()) as { code: string; error: string };
    expect(body.code).toBe('DRIVE_DISCONNECTED');
    expect(body.error).toMatch(/ENOENT/);
  });

  it('plan output reflects role priority changes from the catalog', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const photosDir = join(dir, 'priority-photos');
    mkdirSync(photosDir, { recursive: true });
    writeFileSync(join(photosDir, 'a.jpg'), 'image-content');

    const scanRes = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: photosDir, profile: 'idle' }),
    });
    expect(scanRes.status).toBe(201);
    const { scan } = (await scanRes.json()) as { scan: { id: string; driveId: string } };
    for (let i = 0; i < 50; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${scan.id}`);
      const body = (await got.json()) as { scan: { status: string } };
      if (body.scan.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const primaryDriveId = scan.driveId;

    const { DriveRepo } = await import('../drives/repo.js');
    const altDriveId = new DriveRepo(db).upsert({
      volumeSerial: 'ALT-VOL',
      label: 'ALT',
      currentLetter: null,
      kind: 'local',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 900_000_000,
    }).id;
    const altRoot = join(dir, 'alt-root');
    mkdirSync(altRoot, { recursive: true });

    await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos by category',
        priority: 100,
        match: { category: ['image'] },
        destinationRole: 'photos',
        destinationTemplate: 'Photos/{filename}',
        movePolicy: 'cross-drive-review',
        quarantinePolicy: 'default',
      }),
    });

    const create = await fetch(`http://127.0.0.1:${handle.port}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        drivePriority: [primaryDriveId, altDriveId],
        fillThresholdPercent: 99,
      }),
    });
    expect(create.status).toBe(201);

    const planFirst = await fetch(`http://127.0.0.1:${handle.port}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driveRoots: { [primaryDriveId]: photosDir, [altDriveId]: altRoot },
      }),
    });
    const planFirstBody = (await planFirst.json()) as {
      operations: Array<{ destDriveId: string }>;
    };
    expect(planFirstBody.operations.length).toBeGreaterThan(0);
    expect(planFirstBody.operations[0]!.destDriveId).toBe(primaryDriveId);

    const reorder = await fetch(`http://127.0.0.1:${handle.port}/api/roles/photos`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drivePriority: [altDriveId, primaryDriveId] }),
    });
    expect(reorder.status).toBe(200);

    const planSecond = await fetch(`http://127.0.0.1:${handle.port}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driveRoots: { [primaryDriveId]: photosDir, [altDriveId]: altRoot },
      }),
    });
    const planSecondBody = (await planSecond.json()) as {
      operations: Array<{ destDriveId: string }>;
    };
    expect(planSecondBody.operations.length).toBeGreaterThan(0);
    expect(planSecondBody.operations[0]!.destDriveId).toBe(altDriveId);
  });
});

describe('fs/list endpoint', () => {
  it('lists registered drives for the special path /', async () => {
    const { mkdirSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const driveRoot = join(dir, 'fs-drive');
    mkdirSync(driveRoot, { recursive: true });
    new DriveRepo(db).upsert({
      volumeSerial: 'FS',
      label: 'FS',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/fs/list?path=/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ name: string; kind: string; path: string }> };
    expect(body.entries.some((e) => e.path === driveRoot && e.kind === 'dir')).toBe(true);
  });

  it('returns 403 for paths outside any registered drive', async () => {
    const { mkdirSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const driveRoot = join(dir, 'fs-only');
    mkdirSync(driveRoot, { recursive: true });
    new DriveRepo(db).upsert({
      volumeSerial: 'OZ',
      label: 'OZ',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    const res = await fetch(
      `http://127.0.0.1:${handle.port}/api/fs/list?path=${encodeURIComponent('/etc')}`,
    );
    expect(res.status).toBe(403);
  });

  it('lists immediate children of a folder under a registered drive, dirs first', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const driveRoot = join(dir, 'fs-children');
    mkdirSync(driveRoot, { recursive: true });
    mkdirSync(join(driveRoot, 'beta'), { recursive: true });
    mkdirSync(join(driveRoot, 'alpha'), { recursive: true });
    writeFileSync(join(driveRoot, 'z.txt'), 'z');
    writeFileSync(join(driveRoot, 'a.txt'), 'a');
    new DriveRepo(db).upsert({
      volumeSerial: 'CH',
      label: 'CH',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    const res = await fetch(
      `http://127.0.0.1:${handle.port}/api/fs/list?path=${encodeURIComponent(driveRoot)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ name: string; kind: 'dir' | 'file' }>;
    };
    expect(body.entries.map((e) => e.name)).toEqual(['alpha', 'beta', 'a.txt', 'z.txt']);
  });
});

describe('cleanup empty-dirs endpoints', () => {
  it('round-trips GET → POST → batch shows up in /api/batches', async () => {
    const { mkdirSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');

    const driveRoot = join(dir, 'cleanup-drive');
    mkdirSync(driveRoot, { recursive: true });
    mkdirSync(join(driveRoot, 'a', 'b', 'c'), { recursive: true });
    mkdirSync(join(driveRoot, 'd'), { recursive: true });
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'CLN',
      label: 'CLN',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });

    const list = await fetch(
      `http://127.0.0.1:${handle.port}/api/cleanup/empty-dirs?driveId=${drive.id}`,
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      driveId: string;
      paths: string[];
      totalEmpty: number;
      truncated: boolean;
    };
    expect(listBody.totalEmpty).toBeGreaterThan(0);

    const apply = await fetch(`http://127.0.0.1:${handle.port}/api/cleanup/empty-dirs/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveId: drive.id, paths: listBody.paths }),
    });
    expect(apply.status).toBe(200);
    const applyBody = (await apply.json()) as {
      batchId: string;
      removed: number;
      failed: { path: string; reason: string }[];
    };
    expect(applyBody.removed).toBe(listBody.paths.length);

    const batchesRes = await fetch(`http://127.0.0.1:${handle.port}/api/batches`);
    const batchesBody = (await batchesRes.json()) as {
      batches: { id: string; kind: string }[];
    };
    const found = batchesBody.batches.find((b) => b.id === applyBody.batchId);
    expect(found).toBeTruthy();
    expect(found!.kind).toBe('cleanup-empty-dirs');
  });
});

describe('duplicates pagination', () => {
  it('paginates groups by reclaimable bytes desc with total/hasMore', async () => {
    const { DriveRepo } = await import('../drives/repo.js');
    const { FilesRepo } = await import('../catalog/files-repo.js');
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'DUP',
      label: 'DUP',
      currentLetter: null,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('scan-dup', drive.id, new Date().toISOString(), 'completed', 'balanced');
    const files = new FilesRepo(db);
    for (let i = 0; i < 60; i += 1) {
      const sha = `h${String(i).padStart(3, '0')}`;
      const size = 100 + i;
      for (const tag of ['a', 'b']) {
        files.upsertOne({
          driveId: drive.id,
          path: `/p${i}-${tag}.jpg`,
          name: `p${i}-${tag}.jpg`,
          extension: 'jpg',
          sizeBytes: size,
          category: 'image',
          sha256: sha,
          mtime: '2024-01-01T00:00:00.000Z',
          ctime: '2024-01-01T00:00:00.000Z',
          exifDate: null,
          dateSource: 'mtime',
          width: null,
          height: null,
          durationSeconds: null,
          ntfsFileId: null,
          state: 'indexed',
          scanId: 'scan-dup',
        });
      }
    }

    const first = await fetch(
      `http://127.0.0.1:${handle.port}/api/duplicates?minSize=1&limit=20&offset=0`,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      groups: Array<{ sha256: string; reclaimableBytes: number }>;
      total: number;
      hasMore: boolean;
    };
    expect(firstBody.total).toBe(60);
    expect(firstBody.groups.length).toBe(20);
    expect(firstBody.hasMore).toBe(true);
    for (let i = 1; i < firstBody.groups.length; i += 1) {
      expect(firstBody.groups[i - 1]!.reclaimableBytes).toBeGreaterThanOrEqual(
        firstBody.groups[i]!.reclaimableBytes,
      );
    }

    const last = await fetch(
      `http://127.0.0.1:${handle.port}/api/duplicates?minSize=1&limit=20&offset=40`,
    );
    expect(last.status).toBe(200);
    const lastBody = (await last.json()) as {
      groups: unknown[];
      total: number;
      hasMore: boolean;
    };
    expect(lastBody.groups.length).toBe(20);
    expect(lastBody.hasMore).toBe(false);
  });
});

describe('preview endpoint', () => {
  it('serves a resized JPEG for an indexed image', async () => {
    const sharp = (await import('sharp')).default;
    const { mkdirSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const { FilesRepo } = await import('../catalog/files-repo.js');

    const driveRoot = join(dir, 'drive');
    mkdirSync(driveRoot, { recursive: true });
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'PV',
      label: 'PV',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('scan-pv', drive.id, new Date().toISOString(), 'completed', 'balanced');

    const imgPath = join(driveRoot, 'tiny.png');
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 50, b: 50 } },
    })
      .png()
      .toFile(imgPath);

    new FilesRepo(db).upsertOne({
      driveId: drive.id,
      path: imgPath,
      name: 'tiny.png',
      extension: 'png',
      sizeBytes: 256,
      category: 'image',
      sha256: 'abc',
      mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z',
      exifDate: null,
      dateSource: 'mtime',
      width: 16,
      height: 16,
      durationSeconds: null,
      ntfsFileId: null,
      state: 'indexed',
      scanId: 'scan-pv',
    });
    const fileId = (
      db.prepare(`SELECT id FROM files WHERE path = ?`).get(imgPath) as { id: number }
    ).id;

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/preview/${fileId}?max=64`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('returns 404 for a non-existent file id', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/preview/999999`);
    expect(res.status).toBe(404);
  });

  it('serves the second request from disk cache (cache mtime unchanged)', async () => {
    const sharp = (await import('sharp')).default;
    const { mkdirSync, statSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const { FilesRepo } = await import('../catalog/files-repo.js');

    const driveRoot = join(dir, 'cache-drive');
    mkdirSync(driveRoot, { recursive: true });
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'CACHE',
      label: 'CACHE',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('scan-cache', drive.id, new Date().toISOString(), 'completed', 'balanced');

    const imgPath = join(driveRoot, 'cached.png');
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 200, b: 80 } },
    })
      .png()
      .toFile(imgPath);

    const sha = 'cafef00d'.repeat(8);
    new FilesRepo(db).upsertOne({
      driveId: drive.id,
      path: imgPath,
      name: 'cached.png',
      extension: 'png',
      sizeBytes: 256,
      category: 'image',
      sha256: sha,
      mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z',
      exifDate: null,
      dateSource: 'mtime',
      width: 16,
      height: 16,
      durationSeconds: null,
      ntfsFileId: null,
      state: 'indexed',
      scanId: 'scan-cache',
    });
    const fileId = (
      db.prepare(`SELECT id FROM files WHERE path = ?`).get(imgPath) as { id: number }
    ).id;

    const url = `http://127.0.0.1:${handle.port}/api/preview/${fileId}?max=64`;
    const first = await fetch(url);
    expect(first.status).toBe(200);
    await first.arrayBuffer();

    const cachePath = join(dir, 'preview-cache', sha.slice(0, 2), `${sha}-64.jpg`);
    const firstMtime = statSync(cachePath).mtimeMs;

    await new Promise((r) => setTimeout(r, 30));

    const second = await fetch(url);
    expect(second.status).toBe(200);
    await second.arrayBuffer();

    const secondMtime = statSync(cachePath).mtimeMs;
    expect(secondMtime).toBe(firstMtime);
  });

  it('returns 400 when the file is not an image', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const { FilesRepo } = await import('../catalog/files-repo.js');

    const driveRoot = join(dir, 'docs-drive');
    mkdirSync(driveRoot, { recursive: true });
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'DOC',
      label: 'DOC',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('scan-doc', drive.id, new Date().toISOString(), 'completed', 'balanced');

    const docPath = join(driveRoot, 'a.pdf');
    writeFileSync(docPath, 'pretend pdf');
    new FilesRepo(db).upsertOne({
      driveId: drive.id,
      path: docPath,
      name: 'a.pdf',
      extension: 'pdf',
      sizeBytes: 11,
      category: 'document',
      sha256: 'def',
      mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z',
      exifDate: null,
      dateSource: 'mtime',
      width: null,
      height: null,
      durationSeconds: null,
      ntfsFileId: null,
      state: 'indexed',
      scanId: 'scan-doc',
    });
    const fileId = (
      db.prepare(`SELECT id FROM files WHERE path = ?`).get(docPath) as { id: number }
    ).id;
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/preview/${fileId}`);
    expect(res.status).toBe(400);
  });

  it('returns 403 if the file path is not under any registered drive', async () => {
    const { DriveRepo } = await import('../drives/repo.js');
    const { FilesRepo } = await import('../catalog/files-repo.js');

    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'NX',
      label: 'NX',
      currentLetter: null,
      mountPath: join(dir, 'somewhere-else'),
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('scan-nx', drive.id, new Date().toISOString(), 'completed', 'balanced');

    new FilesRepo(db).upsertOne({
      driveId: drive.id,
      path: '/etc/passwd',
      name: 'passwd',
      extension: '',
      sizeBytes: 1,
      category: 'image',
      sha256: 'evil',
      mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z',
      exifDate: null,
      dateSource: 'mtime',
      width: null,
      height: null,
      durationSeconds: null,
      ntfsFileId: null,
      state: 'indexed',
      scanId: 'scan-nx',
    });
    const fileId = (
      db.prepare(`SELECT id FROM files WHERE path = ?`).get('/etc/passwd') as { id: number }
    ).id;
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/preview/${fileId}`);
    expect(res.status).toBe(403);
  });
});
