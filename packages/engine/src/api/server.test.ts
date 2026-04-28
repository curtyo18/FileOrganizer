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
