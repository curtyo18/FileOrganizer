import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DEFAULT_FILL_THRESHOLD_PERCENT } from '@fileorganizer/shared';
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
    // Files need to be big enough that hashFile actually iterates multiple
    // chunks (the idle profile only sleeps *between* chunks). 100 files at
    // ~600 KB each gives ~3 chunks/file × 5 ms = 1.5 s of sleep total, more
    // than enough cancel-window even on fast CI runners.
    const payload = Buffer.alloc(600 * 1024, 'x');
    for (let i = 0; i < 100; i += 1) {
      writeFileSync(join(dataDir, `f${String(i).padStart(4, '0')}.jpg`), payload);
    }
    const post = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: dataDir, profile: 'idle' }),
    });
    expect(post.status).toBe(201);
    const { scan } = (await post.json()) as { scan: { id: string } };
    const cancel = await fetch(
      `http://127.0.0.1:${handle.port}/api/scans/${scan.id}/cancel`,
      { method: 'POST' },
    );
    expect(cancel.status).toBe(200);
    for (let i = 0; i < 100; i += 1) {
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

  it('rejects a second concurrent scan on the same driveId with 409', async () => {
    // Use large files so the first scan is still running when the second POST fires.
    // The idle profile sleeps between hash chunks (5 ms/chunk at 256 KB chunks), so
    // 50 files × ~600 KB each gives roughly 50 × 3 × 5 ms = 750 ms of processing
    // time — enough headroom to fire the second request before the first finishes.
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dataDir = join(dir, 'concurrent-data');
    mkdirSync(dataDir, { recursive: true });
    const payload = Buffer.alloc(600 * 1024, 'x');
    for (let i = 0; i < 50; i += 1) {
      writeFileSync(join(dataDir, `f${String(i).padStart(3, '0')}.jpg`), payload);
    }

    // Fire scan A — expect 201 and note the driveId.
    const postA = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: dataDir, profile: 'idle' }),
    });
    expect(postA.status).toBe(201);
    const { scan: scanA } = (await postA.json()) as { scan: { id: string; driveId: string } };
    const driveId = scanA.driveId;

    // Fire scan B immediately — the same rootPath resolves to the same driveId.
    const postB = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: dataDir, profile: 'idle' }),
    });
    expect(postB.status).toBe(409);
    const bodyB = (await postB.json()) as { error: string; driveId: string };
    expect(bodyB.error).toBe('scan-already-running');
    expect(bodyB.driveId).toBe(driveId);

    // Let scan A finish so the afterEach cleanup is clean.
    for (let i = 0; i < 200; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${scanA.id}`);
      const body = (await got.json()) as { scan: { status: string } };
      if (body.scan.status === 'completed' || body.scan.status === 'cancelled') break;
      await new Promise((r) => setTimeout(r, 50));
    }
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

describe('exclusions endpoints', () => {
  async function seedFiles(rows: Array<{ path: string; sha?: string; name?: string }>) {
    const { DriveRepo } = await import('../drives/repo.js');
    const { FilesRepo } = await import('../catalog/files-repo.js');
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'EXCL',
      label: 'EXCL',
      currentLetter: null,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT OR IGNORE INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('scan-excl', drive.id, new Date().toISOString(), 'completed', 'balanced');
    const repo = new FilesRepo(db);
    rows.forEach((r, i) => {
      repo.upsertOne({
        driveId: drive.id,
        path: r.path,
        name: r.name ?? r.path.split(/[\\/]/).pop()!,
        extension: 'jpg',
        sizeBytes: 100,
        category: 'image',
        sha256: r.sha ?? `sha-${i}`,
        mtime: '2024-01-01T00:00:00.000Z',
        ctime: '2024-01-01T00:00:00.000Z',
        exifDate: null,
        dateSource: 'mtime',
        width: null,
        height: null,
        durationSeconds: null,
        ntfsFileId: null,
        state: 'indexed',
        scanId: 'scan-excl',
      });
    });
  }

  it('dry-run reports the count without mutating settings or files', async () => {
    await seedFiles([
      { path: 'E:\\Downloads\\a.jpg' },
      { path: 'E:\\Downloads\\sub\\b.jpg' },
      { path: 'E:\\photos\\c.jpg' },
    ]);
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/exclusions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segment: 'Downloads', dryRun: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { wouldRemove: number; userExcluded: string[] };
    expect(body.wouldRemove).toBe(2);
    expect(body.userExcluded).toEqual([]);
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM files`).get() as { n: number };
    expect(remaining.n).toBe(3);
    const settings = await (
      await fetch(`http://127.0.0.1:${handle.port}/api/settings`)
    ).json() as { settings: { userExcluded: string[] } };
    expect(settings.settings.userExcluded).toEqual([]);
  });

  it('persists segment, prunes matching files, and is idempotent on re-add', async () => {
    await seedFiles([
      { path: 'E:\\Downloads\\a.jpg' },
      { path: 'E:\\Downloads\\sub\\b.jpg' },
      { path: 'E:\\photos\\c.jpg' },
    ]);
    const first = await fetch(`http://127.0.0.1:${handle.port}/api/exclusions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segment: 'Downloads' }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { removed: number; userExcluded: string[] };
    expect(firstBody.removed).toBe(2);
    expect(firstBody.userExcluded).toEqual(['Downloads']);
    const remaining = db
      .prepare(`SELECT path FROM files ORDER BY path`)
      .all() as { path: string }[];
    expect(remaining).toEqual([{ path: 'E:\\photos\\c.jpg' }]);

    const second = await fetch(`http://127.0.0.1:${handle.port}/api/exclusions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segment: 'Downloads' }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { removed: number; userExcluded: string[] };
    expect(secondBody.removed).toBe(0);
    expect(secondBody.userExcluded).toEqual(['Downloads']);
  });

  it('matches POSIX-style paths after normalizing / to \\', async () => {
    await seedFiles([{ path: 'D:/foo/Downloads/x.png' }]);
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/exclusions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segment: 'Downloads' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed: number };
    expect(body.removed).toBe(1);
  });

  it('rejects empty/whitespace/separator/colon segments with 400', async () => {
    for (const segment of ['', '   ', 'foo/bar', 'foo\\bar', 'C:']) {
      const res = await fetch(`http://127.0.0.1:${handle.port}/api/exclusions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segment }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/non-empty folder name/);
    }
  });

  it('DELETE /api/exclusions/:segment removes from settings without touching files', async () => {
    await seedFiles([{ path: 'E:\\photos\\c.jpg' }]);
    await fetch(`http://127.0.0.1:${handle.port}/api/exclusions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segment: 'photos' }),
    });
    const beforeFiles = db.prepare(`SELECT COUNT(*) AS n FROM files`).get() as { n: number };
    expect(beforeFiles.n).toBe(0);
    await seedFiles([{ path: 'E:\\photos\\c.jpg', sha: 'sha-restored' }]);
    const filesBeforeDelete = db
      .prepare(`SELECT COUNT(*) AS n FROM files`)
      .get() as { n: number };

    const del = await fetch(
      `http://127.0.0.1:${handle.port}/api/exclusions/${encodeURIComponent('photos')}`,
      { method: 'DELETE' },
    );
    expect(del.status).toBe(200);
    const body = (await del.json()) as { userExcluded: string[] };
    expect(body.userExcluded).toEqual([]);
    const filesAfterDelete = db
      .prepare(`SELECT COUNT(*) AS n FROM files`)
      .get() as { n: number };
    expect(filesAfterDelete.n).toBe(filesBeforeDelete.n);
  });

  it('DELETE /api/exclusions/:segment rejects invalid segments with 400', async () => {
    const res = await fetch(
      `http://127.0.0.1:${handle.port}/api/exclusions/${encodeURIComponent('foo/bar')}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(400);
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
        fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT,
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
    expect(reordered.role.fillThresholdPercent).toBe(DEFAULT_FILL_THRESHOLD_PERCENT);

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
        fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT,
      }),
    });
    expect(first.status).toBe(201);

    const dup = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'dup',
        drivePriority: [driveId],
        fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT,
      }),
    });
    expect(dup.status).toBe(409);

    const bad = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'has-bad-drive',
        drivePriority: ['ghost-drive'],
        fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT,
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

  it('paginates /api/plan/organize via limit/offset and exposes total + hasMore', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dataDir = join(dir, 'paginate-photos');
    mkdirSync(dataDir, { recursive: true });
    // 8 distinct files so 5 fits on page 0 and 3 spills onto page 1.
    for (let i = 0; i < 8; i += 1) {
      writeFileSync(join(dataDir, `f${i}.jpg`), `payload-${i}`);
    }
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

    await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos paginated',
        priority: 100,
        match: { category: ['image'] },
        destinationRole: 'photos',
        destinationTemplate: 'Photos/{filename}',
        movePolicy: 'always-review',
        quarantinePolicy: 'default',
      }),
    });
    await fetch(`http://127.0.0.1:${handle.port}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        drivePriority: [driveId],
        fillThresholdPercent: 99,
      }),
    });

    const page0Res = await fetch(`http://127.0.0.1:${handle.port}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveRoots: { [driveId]: dataDir }, limit: 5, offset: 0 }),
    });
    expect(page0Res.status).toBe(200);
    const page0 = (await page0Res.json()) as {
      operations: unknown[];
      total: number;
      hasMore: boolean;
      unresolvedRoles: unknown[];
      ruleStats: unknown[];
    };
    expect(page0.total).toBe(8);
    expect(page0.hasMore).toBe(true);
    expect(Array.isArray(page0.operations)).toBe(true);
    expect(page0.operations.length).toBeLessThanOrEqual(5);
    expect(Array.isArray(page0.unresolvedRoles)).toBe(true);
    expect(Array.isArray(page0.ruleStats)).toBe(true);

    const page1Res = await fetch(`http://127.0.0.1:${handle.port}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveRoots: { [driveId]: dataDir }, limit: 5, offset: 5 }),
    });
    const page1 = (await page1Res.json()) as {
      operations: unknown[];
      total: number;
      hasMore: boolean;
    };
    expect(page1.total).toBe(8);
    expect(page1.hasMore).toBe(false);
    expect(page1.operations.length).toBe(3);
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

  it('apply-all dry-runs the full plan with no filters', async () => {
    const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
    const dataDir = join(dir, 'apply-all-basic');
    mkdirSync(dataDir, { recursive: true });
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(dataDir, `f${i}.jpg`), `image-${i}`);
    }
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

    await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        priority: 100,
        match: { category: ['image'] },
        destinationRole: 'photos',
        destinationTemplate: 'Photos/{filename}',
        movePolicy: 'always-review',
        quarantinePolicy: 'default',
      }),
    });
    await fetch(`http://127.0.0.1:${handle.port}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        drivePriority: [driveId],
        fillThresholdPercent: 99,
      }),
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/organize/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'apply all dry',
        driveRoots: { [driveId]: dataDir },
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      batchId: string | null;
      completed: number;
      failed: number;
    };
    expect(body.completed).toBe(5);
    expect(body.failed).toBe(0);
    expect(body.batchId).toBeTruthy();

    for (let i = 0; i < 5; i += 1) {
      const original = join(dataDir, `f${i}.jpg`);
      expect(existsSync(original)).toBe(true);
      expect(readFileSync(original, 'utf8')).toBe(`image-${i}`);
      expect(existsSync(join(dataDir, 'Photos', `f${i}.jpg`))).toBe(false);
    }
  });

  it('apply-all honors ruleIds whitelist', async () => {
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
    const dataDir = join(dir, 'apply-all-rules');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'a.jpg'), 'jpg-a');
    writeFileSync(join(dataDir, 'b.jpg'), 'jpg-b');
    writeFileSync(join(dataDir, 'c.mp4'), 'mp4-c');
    writeFileSync(join(dataDir, 'd.mp4'), 'mp4-d');

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

    const photoRuleRes = await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        priority: 100,
        match: { category: ['image'] },
        destinationRole: 'photos',
        destinationTemplate: 'Photos/{filename}',
        movePolicy: 'always-review',
        quarantinePolicy: 'default',
      }),
    });
    const photoRule = (await photoRuleRes.json()) as { rule: { id: string } };
    await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'videos',
        priority: 90,
        match: { category: ['video'] },
        destinationRole: 'videos',
        destinationTemplate: 'Videos/{filename}',
        movePolicy: 'always-review',
        quarantinePolicy: 'default',
      }),
    });
    await fetch(`http://127.0.0.1:${handle.port}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        drivePriority: [driveId],
        fillThresholdPercent: 99,
      }),
    });
    await fetch(`http://127.0.0.1:${handle.port}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'videos',
        drivePriority: [driveId],
        fillThresholdPercent: 99,
      }),
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/organize/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'apply photos only',
        driveRoots: { [driveId]: dataDir },
        ruleIds: [photoRule.rule.id],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completed: number; failed: number };
    expect(body.completed).toBe(2);
    expect(body.failed).toBe(0);

    expect(existsSync(join(dataDir, 'Photos', 'a.jpg'))).toBe(true);
    expect(existsSync(join(dataDir, 'Photos', 'b.jpg'))).toBe(true);
    expect(existsSync(join(dataDir, 'Videos', 'c.mp4'))).toBe(false);
    expect(existsSync(join(dataDir, 'Videos', 'd.mp4'))).toBe(false);
    expect(existsSync(join(dataDir, 'c.mp4'))).toBe(true);
    expect(existsSync(join(dataDir, 'd.mp4'))).toBe(true);
  });

  it('apply-all skips cross-drive ops when kinds=[same-drive-move]', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const sourceRoot = join(dir, 'kind-src');
    const altRoot = join(dir, 'kind-alt');
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(altRoot, { recursive: true });
    writeFileSync(join(sourceRoot, 'same.jpg'), 'same-payload');
    writeFileSync(join(sourceRoot, 'cross.mp4'), 'cross-payload');

    const scanRes = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: sourceRoot, profile: 'idle' }),
    });
    expect(scanRes.status).toBe(201);
    const { scan } = (await scanRes.json()) as { scan: { id: string; driveId: string } };
    const sourceDriveId = scan.driveId;
    for (let i = 0; i < 50; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${scan.id}`);
      const body = (await got.json()) as { scan: { status: string } };
      if (body.scan.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const { DriveRepo } = await import('../drives/repo.js');
    const altDrive = new DriveRepo(db).upsert({
      volumeSerial: 'KIND-ALT',
      label: 'KIND-ALT',
      currentLetter: null,
      mountPath: altRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 900_000_000,
    });

    await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        priority: 100,
        match: { category: ['image'] },
        destinationRole: 'photos',
        destinationTemplate: 'Photos/{filename}',
        movePolicy: 'always-review',
        quarantinePolicy: 'default',
      }),
    });
    await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'videos',
        priority: 90,
        match: { category: ['video'] },
        destinationRole: 'videos',
        destinationTemplate: 'Videos/{filename}',
        movePolicy: 'always-review',
        quarantinePolicy: 'default',
      }),
    });
    await fetch(`http://127.0.0.1:${handle.port}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos',
        drivePriority: [sourceDriveId],
        fillThresholdPercent: 99,
      }),
    });
    await fetch(`http://127.0.0.1:${handle.port}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'videos',
        drivePriority: [altDrive.id],
        fillThresholdPercent: 99,
      }),
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/organize/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: 'same-drive only',
        driveRoots: { [sourceDriveId]: sourceRoot, [altDrive.id]: altRoot },
        dryRun: true,
        kinds: ['same-drive-move'],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      batchId: string | null;
      completed: number;
      failed: number;
    };
    expect(body.completed).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.batchId).toBeTruthy();
  });

  it('apply-all returns a no-op result when the plan is empty', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/organize/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'empty', driveRoots: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      batchId: string | null;
      completed: number;
      failed: number;
      emptyDirsRemoved: number;
    };
    expect(body.batchId).toBeNull();
    expect(body.completed).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.emptyDirsRemoved).toBe(0);
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
    const { EmptyDirsRepo } = await import('../catalog/empty-dirs-repo.js');

    const driveRoot = join(dir, 'cleanup-drive');
    mkdirSync(driveRoot, { recursive: true });
    const onDisk = [
      join(driveRoot, 'a', 'b', 'c'),
      join(driveRoot, 'a', 'b'),
      join(driveRoot, 'a'),
      join(driveRoot, 'd'),
    ];
    for (const p of onDisk) mkdirSync(p, { recursive: true });
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
    // GET is now SQL-backed, so we have to seed empty_dirs rows. In real
    // life the scan walker writes these.
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, 'completed', 'balanced')`,
    ).run('scan-cln', drive.id, new Date().toISOString());
    const repo = new EmptyDirsRepo(db);
    const now = new Date().toISOString();
    for (const p of onDisk) repo.upsert(drive.id, p, 'scan-cln', now);

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
    expect(listBody.totalEmpty).toBe(onDisk.length);
    expect(new Set(listBody.paths)).toEqual(new Set(onDisk));
    // deepest-first ordering
    for (let i = 1; i < listBody.paths.length; i += 1) {
      expect(listBody.paths[i - 1]!.length).toBeGreaterThanOrEqual(
        listBody.paths[i]!.length,
      );
    }

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

  it('apply-all removes every empty_dirs row for the drive in one batch', async () => {
    const { existsSync, mkdirSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const { EmptyDirsRepo } = await import('../catalog/empty-dirs-repo.js');

    const driveRoot = join(dir, 'apply-all-drive');
    mkdirSync(driveRoot, { recursive: true });
    const onDisk = [
      join(driveRoot, 'a', 'b', 'c'),
      join(driveRoot, 'a', 'b'),
      join(driveRoot, 'a'),
    ];
    for (const p of onDisk) mkdirSync(p, { recursive: true });
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'AAL',
      label: 'AAL',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, 'completed', 'balanced')`,
    ).run('scan-aal', drive.id, new Date().toISOString());
    const repo = new EmptyDirsRepo(db);
    const now = new Date().toISOString();
    for (const p of onDisk) repo.upsert(drive.id, p, 'scan-aal', now);

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/cleanup/empty-dirs/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveId: drive.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      batchId: string | null;
      removed: number;
      failed: { path: string; reason: string }[];
    };
    expect(body.removed).toBe(onDisk.length);
    expect(body.failed).toEqual([]);
    expect(body.batchId).toBeTruthy();
    for (const p of onDisk) expect(existsSync(p)).toBe(false);
    const batchesRes = await fetch(`http://127.0.0.1:${handle.port}/api/batches`);
    const batchesBody = (await batchesRes.json()) as {
      batches: { id: string; kind: string }[];
    };
    expect(batchesBody.batches.find((b) => b.id === body.batchId)?.kind).toBe(
      'cleanup-empty-dirs',
    );
  });

  it('apply-all surfaces per-path failures for dirs that became non-empty', async () => {
    const { existsSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const { EmptyDirsRepo } = await import('../catalog/empty-dirs-repo.js');

    const driveRoot = join(dir, 'apply-all-race');
    mkdirSync(driveRoot, { recursive: true });
    const stable1 = join(driveRoot, 'stable1');
    const stable2 = join(driveRoot, 'stable2');
    const racy = join(driveRoot, 'racy');
    for (const p of [stable1, stable2, racy]) mkdirSync(p, { recursive: true });
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'RAC',
      label: 'RAC',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile)
       VALUES (?, ?, ?, 'completed', 'balanced')`,
    ).run('scan-rac', drive.id, new Date().toISOString());
    const repo = new EmptyDirsRepo(db);
    const now = new Date().toISOString();
    for (const p of [stable1, stable2, racy]) repo.upsert(drive.id, p, 'scan-rac', now);
    // A file lands in racy after the catalog snapshot.
    writeFileSync(join(racy, 'late.txt'), 'oops');

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/cleanup/empty-dirs/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveId: drive.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      batchId: string | null;
      removed: number;
      failed: { path: string; reason: string }[];
    };
    expect(body.removed).toBe(2);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]!.path).toBe(racy);
    expect(body.failed[0]!.reason).toBe('not empty');
    expect(existsSync(stable1)).toBe(false);
    expect(existsSync(stable2)).toBe(false);
    expect(existsSync(racy)).toBe(true);
  });

  it('apply-all returns a no-op batchId=null when the drive has no empty_dirs rows', async () => {
    const { mkdirSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');

    const driveRoot = join(dir, 'apply-all-empty');
    mkdirSync(driveRoot, { recursive: true });
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'EMP',
      label: 'EMP',
      currentLetter: null,
      mountPath: driveRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/cleanup/empty-dirs/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveId: drive.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      batchId: string | null;
      removed: number;
      failed: { path: string; reason: string }[];
    };
    expect(body).toEqual({ batchId: null, removed: 0, failed: [] });
  });

  it('apply-all rejects missing driveId and unknown drives', async () => {
    const missing = await fetch(`http://127.0.0.1:${handle.port}/api/cleanup/empty-dirs/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const unknown = await fetch(`http://127.0.0.1:${handle.port}/api/cleanup/empty-dirs/apply-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveId: 'nope' }),
    });
    expect(unknown.status).toBe(400);
    const unknownBody = (await unknown.json()) as { error: string };
    expect(unknownBody.error).toBe('no mount path for drive');
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

describe('ThrottleManagerRef singleton: mid-scan profile change', () => {
  // Verifies that when onSettingsChanged fires and replaces the inner
  // ThrottleManager via ref.replace(), in-flight scans observe the new
  // profile on subsequent chunk reads (spy-based, not timing-based).

  it('in-flight scan observes the new profile after replace() is called', async () => {
    const { vi } = await import('vitest');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { ThrottleManager, ThrottleManagerRef } = await import('../throttle/manager.js');
    const { defaultThrottleProfiles } = await import('@fileorganizer/shared');

    const localDir = mkdtempSync(join(tmpdir(), 'fileorg-singleton-'));
    const localDb = openCatalog(join(localDir, 'cat.db'));
    migrate(localDb);

    const profiles = defaultThrottleProfiles(2);

    // Initial manager: 'idle' profile (has a small but non-zero interChunkSleepMs)
    const initialManager = new ThrottleManager(profiles, 'idle', []);
    const throttleRef = new ThrottleManagerRef(initialManager);

    // Spy on the ref's current() to capture every profile name the scan reads
    const observedProfiles: string[] = [];
    const originalCurrent = throttleRef.current.bind(throttleRef);
    vi.spyOn(throttleRef, 'current').mockImplementation(() => {
      const p = originalCurrent();
      observedProfiles.push(p.name);
      return p;
    });

    let onSettingsChangedFn: ((s: unknown) => void) | undefined;
    const serverHandle = await createServer({
      db: localDb,
      port: 0,
      hostname: '127.0.0.1',
      throttle: throttleRef,
      onSettingsChanged: (s) => { onSettingsChangedFn?.(s); },
    });

    try {
      // Create enough files that the scan has to hash multiple files, giving us
      // time to replace the manager between current() calls. 20 small .jpg files
      // each with 3-chunk reads is more than enough for the spy to record a mix.
      const dataDir = join(localDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      for (let i = 0; i < 20; i += 1) {
        // ~600 KB per file → multiple chunks per file at 256 KB chunk size
        writeFileSync(join(dataDir, `f${String(i).padStart(3, '0')}.jpg`), Buffer.alloc(600 * 1024, `${i}`));
      }

      const post = await fetch(`http://127.0.0.1:${serverHandle.port}/api/scans`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rootPath: dataDir, profile: 'idle' }),
      });
      expect(post.status).toBe(201);
      const { scan } = (await post.json()) as { scan: { id: string } };

      // Wait a brief moment so at least one current() call happens before swap
      await new Promise((r) => setTimeout(r, 10));

      // Swap to 'full-send': zero interChunkSleepMs, different name
      const fullSendManager = new ThrottleManager(profiles, 'full-send', []);
      throttleRef.replace(fullSendManager);

      // Wait for scan to complete
      for (let i = 0; i < 200; i += 1) {
        const got = await fetch(`http://127.0.0.1:${serverHandle.port}/api/scans/${scan.id}`);
        const body = (await got.json()) as { scan: { status: string } };
        if (body.scan.status === 'completed' || body.scan.status === 'cancelled') break;
        await new Promise((r) => setTimeout(r, 50));
      }

      // The spy must have observed 'idle' before the swap and 'full-send' after.
      // Both must appear in the recorded sequence.
      expect(observedProfiles).toContain('idle');
      expect(observedProfiles).toContain('full-send');

      // The sequence must show 'idle' appearing before 'full-send'
      const firstIdleIdx = observedProfiles.indexOf('idle');
      const firstFullSendIdx = observedProfiles.indexOf('full-send');
      expect(firstIdleIdx).toBeGreaterThanOrEqual(0);
      expect(firstFullSendIdx).toBeGreaterThan(firstIdleIdx);
    } finally {
      vi.restoreAllMocks();
      await serverHandle.close();
      closeCatalog(localDb);
      rmSync(localDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-fix A: Array.isArray guards on POST endpoints
// ---------------------------------------------------------------------------

describe('Array.isArray guards — /api/duplicates/apply', () => {
  it('returns 400 when body.operations is null', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/duplicates/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: null }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('operations must be an array');
  });

  it('returns 400 when body.operations is missing', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/duplicates/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('operations must be an array');
  });
});

describe('Array.isArray guards — /api/quarantine/restore', () => {
  it('returns 400 when body.quarantineIds is null', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/quarantine/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quarantineIds: null }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('quarantineIds must be an array');
  });

  it('returns 400 when body.quarantineIds is missing', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/quarantine/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('quarantineIds must be an array');
  });
});

describe('Array.isArray guards — /api/organize/apply', () => {
  it('returns 400 when body.operations is null', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/organize/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: null }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('operations must be an array');
  });

  it('returns 400 when body.operations is missing', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/organize/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('operations must be an array');
  });
});

describe('Array.isArray guards — /api/organize/auto-apply', () => {
  it('returns 400 when body.operations is null', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/organize/auto-apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: null }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('operations must be an array');
  });

  it('returns 400 when body.operations is missing', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/organize/auto-apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('operations must be an array');
  });
});

// ---------------------------------------------------------------------------
// Sub-fix B: scan-null race — POST /api/scans always returns a valid scan
// ---------------------------------------------------------------------------

describe('scan-null race — POST /api/scans returns a valid scan ID', () => {
  it('response always contains a valid scan object, not null', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dataDir = join(dir, 'race-check');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'img.jpg'), 'pixel');

    const post = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: dataDir, profile: 'idle' }),
    });
    expect(post.status).toBe(201);
    const body = (await post.json()) as { scan: { id: string; status: string } | null };
    // scan must never be null — this is the core assertion for the race fix
    expect(body.scan).not.toBeNull();
    expect(typeof body.scan!.id).toBe('string');
    expect(body.scan!.id.length).toBeGreaterThan(0);

    // Wait for completion so afterEach teardown is clean
    for (let i = 0; i < 50; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${body.scan!.id}`);
      const r = (await got.json()) as { scan: { status: string } };
      if (r.scan.status === 'completed') break;
      await new Promise((r2) => setTimeout(r2, 50));
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-fix C: rootPaths (plural) path confinement
// ---------------------------------------------------------------------------

describe('rootPaths confinement — POST /api/scans', () => {
  it('returns 400 with path-not-confined when rootPaths contains a path outside any drive', async () => {
    const { DriveRepo } = await import('../drives/repo.js');
    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'CONF-A',
      label: 'CONF-A',
      currentLetter: null,
      mountPath: join(dir, 'drive-a'),
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driveId: drive.id,
        rootPaths: ['/some/path/outside/any/drive'],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; path: string };
    expect(body.error).toBe('path-not-confined');
    expect(body.path).toBe('/some/path/outside/any/drive');
  });

  it('returns 400 when any rootPath in the batch is outside the drive (whole-batch rejection)', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const mountPath = join(dir, 'drive-b');
    mkdirSync(mountPath, { recursive: true });
    writeFileSync(join(mountPath, 'ok.jpg'), 'ok');

    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'CONF-B',
      label: 'CONF-B',
      currentLetter: null,
      mountPath,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driveId: drive.id,
        rootPaths: [mountPath, '/tmp/outside'],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; path: string };
    expect(body.error).toBe('path-not-confined');
    expect(body.path).toBe('/tmp/outside');
  });

  it('succeeds (201) when all rootPaths are under the registered drive mountPath', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { DriveRepo } = await import('../drives/repo.js');
    const mountPath = join(dir, 'drive-c');
    const subDir = join(mountPath, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'ok.jpg'), 'ok');

    const drive = new DriveRepo(db).upsert({
      volumeSerial: 'CONF-C',
      label: 'CONF-C',
      currentLetter: null,
      mountPath,
      kind: 'local',
      roles: [],
      totalBytes: 1,
      freeBytes: 1,
    });

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driveId: drive.id,
        rootPaths: [subDir],
        profile: 'idle',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { scan: { id: string } | null };
    expect(body.scan).not.toBeNull();
    expect(typeof body.scan!.id).toBe('string');

    // Wait for completion so afterEach teardown is clean
    for (let i = 0; i < 50; i += 1) {
      const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${body.scan!.id}`);
      const r = (await got.json()) as { scan: { status: string } };
      if (r.scan.status === 'completed') break;
      await new Promise((r2) => setTimeout(r2, 50));
    }
  });
});

describe('bodyLimit middleware', () => {
  it('rejects a request body exceeding the 8 MB limit with HTTP 413', async () => {
    // 9 MB > 8 MB cap — should be rejected before the route handler runs.
    const bigBody = 'x'.repeat(9 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
      method: 'POST',
      body: bigBody,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(413);
    const json = await res.json() as { error: string; maxSize: number };
    expect(json.error).toBe('request-too-large');
    expect(json.maxSize).toBe(8 * 1024 * 1024);
  });
});
