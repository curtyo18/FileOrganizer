import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Catalog } from '../catalog/connection.js';
import { DriveRepo } from '../drives/repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { ThrottleManager } from '../throttle/manager.js';
import { runScan } from '../scan/orchestrator.js';
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
      driveId: string;
      rootPaths: string[];
      profile?: 'idle' | 'balanced' | 'full-send';
      mediainfoPath?: string;
    };
    const drive = drives.list().find((d) => d.id === body.driveId);
    if (!drive) return c.json({ error: 'drive-not-found' }, 404);
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
      roots: body.rootPaths,
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
    let rows;
    if (driveId) {
      rows = opts.db
        .prepare(`SELECT * FROM scans WHERE drive_id = ? ORDER BY started_at DESC LIMIT 100`)
        .all(driveId);
    } else {
      rows = opts.db.prepare(`SELECT * FROM scans ORDER BY started_at DESC LIMIT 100`).all();
    }
    return c.json({ scans: rows });
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
