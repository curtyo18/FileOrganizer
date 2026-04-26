import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Catalog } from '../catalog/connection.js';
import { DriveRepo } from '../drives/repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { ThrottleManager } from '../throttle/manager.js';
import { runScan } from '../scan/orchestrator.js';
import { detectVolume } from '../drives/volume.js';
import { createLogger, defaultWriter } from '../log.js';
import { EventBus } from './events.js';

export interface CreateServerOptions {
  db: Catalog;
  port: number;
  hostname: string;
}

export interface ServerHandle {
  port: number;
  events: EventBus;
  close(): Promise<void>;
}

export async function createServer(opts: CreateServerOptions): Promise<ServerHandle> {
  const app = new Hono();
  const events = new EventBus();
  const drives = new DriveRepo(opts.db);
  const scans = new ScansRepo(opts.db);

  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/api/drives', (c) => c.json({ drives: drives.list() }));
  app.get('/api/scans/:id', (c) => {
    const id = c.req.param('id');
    const s = scans.findById(id);
    if (!s) return c.json({ error: 'not-found' }, 404);
    return c.json({ scan: s });
  });
  app.post('/api/scans', async (c) => {
    const body = (await c.req.json()) as {
      driveId?: string;
      rootPath?: string;
      rootPaths?: string[];
      profile?: 'idle' | 'balanced' | 'full-send';
      mediainfoPath?: string;
    };

    // Resolve drive: either by explicit driveId, or by discovering it from rootPath.
    let drive = body.driveId ? drives.list().find((d) => d.id === body.driveId) ?? null : null;
    let roots: string[];
    if (body.rootPath) {
      const root = resolve(body.rootPath);
      if (!existsSync(root)) return c.json({ error: 'path-not-found', path: root }, 400);
      const volume = detectVolume(root);
      drive = drives.upsert({
        volumeSerial: volume.volumeSerial,
        label: volume.currentLetter ?? root,
        currentLetter: volume.currentLetter,
        kind: volume.kind,
        roles: drive?.roles ?? [],
        totalBytes: volume.totalBytes,
        freeBytes: volume.freeBytes,
      });
      roots = [root];
    } else if (drive) {
      if (!body.rootPaths || body.rootPaths.length === 0) {
        return c.json({ error: 'rootPaths required when starting from existing driveId' }, 400);
      }
      roots = body.rootPaths;
    } else {
      return c.json({ error: 'either driveId+rootPaths or rootPath is required' }, 400);
    }

    const settings = new SettingsRepo(opts.db).load();
    const throttle = new ThrottleManager(
      settings.throttleProfiles,
      body.profile ?? 'balanced',
      settings.throttleSchedule,
    );
    const log = createLogger({ level: 'info', write: defaultWriter });
    const mediainfoPath = body.mediainfoPath ?? '';
    const promise = runScan({
      db: opts.db,
      driveId: drive.id,
      roots,
      categoryMap: settings.categoryMap,
      throttle,
      log,
      mediainfoPath,
    });
    promise
      .then((r) => {
        events.publish({
          type: 'scan-progress',
          scanId: r.scanId,
          filesIndexed: r.filesIndexed,
          filesUnchanged: r.filesUnchanged,
          filesSkipped: r.filesSkipped,
          bytesProcessed: 0,
        });
      })
      .catch((err) => log.error('background-scan-failed', { err: (err as Error).message }));
    await new Promise((r) => setTimeout(r, 50));
    const recentRow = opts.db
      .prepare(`SELECT id FROM scans WHERE drive_id = ? ORDER BY started_at DESC LIMIT 1`)
      .get(drive.id) as { id: string } | undefined;
    const recent = recentRow ? scans.findById(recentRow.id) : null;
    return c.json({ scan: recent }, 201);
  });

  app.get('/api/scans', (c) => {
    const driveId = c.req.query('driveId');
    const list = driveId ? scans.list({ driveId }) : scans.list();
    return c.json({ scans: list });
  });

  app.get('/api/files', (c) => {
    const driveId = c.req.query('driveId');
    if (!driveId) return c.json({ error: 'driveId required' }, 400);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 1000);
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10), 0);
    const rows = opts.db
      .prepare(
        `SELECT id, drive_id AS driveId, path, name, extension, size_bytes AS sizeBytes,
                category, sha256, mtime, exif_date AS exifDate, date_source AS dateSource,
                state FROM files WHERE drive_id = ? ORDER BY path LIMIT ? OFFSET ?`,
      )
      .all(driveId, limit, offset);
    return c.json({ files: rows });
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const uiDist = join(__dirname, '..', '..', '..', 'ui', 'dist');
  if (existsSync(uiDist)) {
    app.get('*', serveStatic({ root: uiDist }));
  }

  return new Promise((resolveServer) => {
    const server = serve(
      {
        fetch: app.fetch,
        port: opts.port,
        hostname: opts.hostname,
      },
      (info) => {
        const handle: ServerHandle = {
          port: info.port,
          events,
          close: () =>
            new Promise<void>((resolveClose) => {
              server.close(() => resolveClose());
            }),
        };
        resolveServer(handle);
      },
    );
  });
}
