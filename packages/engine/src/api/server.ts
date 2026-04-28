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
import { planDedupe, type DedupeOperation } from '../dedupe/planner.js';
import { applyDedupe } from '../dedupe/applier.js';
import { restoreFromQuarantine } from '../quarantine/quarantine.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { RulesRepo, type CreateRuleInput, type UpdateRuleInput } from '../rules/repo.js';
import { RolesRepo, type CreateRoleInput, type UpdateRoleInput } from '../roles/repo.js';
import { planOrganize, type PlannedOperation } from '../organize/planner.js';
import { applyApprovedBatch, autoApply } from '../organize/applier.js';
import { undoBatch } from '../organize/undo.js';
import { RuleError, type RoleDefinition } from '@fileorganizer/shared';
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
        mountPath: volume.mountPath,
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

  app.get('/api/duplicates', (c) => {
    const minSize = Math.max(parseInt(c.req.query('minSize') ?? '1', 10), 1);
    const plan = planDedupe(opts.db, { minSizeBytes: minSize });
    return c.json(plan);
  });

  app.post('/api/duplicates/apply', async (c) => {
    const body = (await c.req.json()) as {
      operations: DedupeOperation[];
      driveRoots?: Record<string, string>;
    };
    const merged = mergeDriveRoots(drives, body.driveRoots ?? {});
    const result = await applyDedupe({
      db: opts.db,
      operations: body.operations,
      driveRoots: merged,
    });
    events.publish({ type: 'batch-status', batchId: result.batchId, status: 'completed' });
    return c.json(result);
  });

  app.get('/api/quarantine', (c) => {
    const driveId = c.req.query('driveId');
    const rows = driveId
      ? opts.db
          .prepare(
            `SELECT id, drive_id AS driveId, original_path AS originalPath,
                    original_size AS originalSize, original_sha256 AS originalSha256,
                    original_mtime AS originalMtime, quarantine_path AS quarantinePath,
                    quarantined_at AS quarantinedAt, batch_id AS batchId
             FROM quarantine WHERE drive_id = ? ORDER BY quarantined_at DESC`,
          )
          .all(driveId)
      : opts.db
          .prepare(
            `SELECT id, drive_id AS driveId, original_path AS originalPath,
                    original_size AS originalSize, original_sha256 AS originalSha256,
                    original_mtime AS originalMtime, quarantine_path AS quarantinePath,
                    quarantined_at AS quarantinedAt, batch_id AS batchId
             FROM quarantine ORDER BY quarantined_at DESC LIMIT 1000`,
          )
          .all();
    return c.json({ entries: rows });
  });

  app.post('/api/quarantine/restore', async (c) => {
    const body = (await c.req.json()) as {
      quarantineIds: number[];
      driveRoots?: Record<string, string>;
    };
    const driveRoots = mergeDriveRoots(drives, body.driveRoots ?? {});
    const rootLookup = (driveId: string): string | undefined => driveRoots.get(driveId);
    const errors: string[] = [];
    let restored = 0;
    for (const id of body.quarantineIds) {
      const row = opts.db
        .prepare(
          `SELECT drive_id AS driveId, original_path AS originalPath FROM quarantine WHERE id = ?`,
        )
        .get(id) as { driveId: string; originalPath: string } | undefined;
      if (!row) {
        errors.push(`${id} not found`);
        continue;
      }
      const root = rootLookup(row.driveId);
      if (!root) {
        errors.push(`${id}: no driveRoot for ${row.driveId}`);
        continue;
      }
      try {
        restoreFromQuarantine({ db: opts.db, driveRoot: root, quarantineId: id });
        opts.db
          .prepare(`UPDATE files SET state = 'indexed' WHERE drive_id = ? AND path = ?`)
          .run(row.driveId, row.originalPath);
        restored += 1;
      } catch (err) {
        errors.push(`${id}: ${(err as Error).message}`);
      }
    }
    return c.json({ restored, errors });
  });

  const rules = new RulesRepo(opts.db);
  const roles = new RolesRepo(opts.db);
  const batches = new BatchesRepo(opts.db);

  app.get('/api/roles', (c) => c.json({ roles: roles.list() }));

  app.post('/api/roles', async (c) => {
    const body = (await c.req.json()) as CreateRoleInput;
    try {
      const role = roles.create(body);
      return c.json({ role }, 201);
    } catch (err) {
      if (err instanceof RuleError && err.code === 'ROLE_EXISTS') {
        return c.json({ error: err.message }, 409);
      }
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.put('/api/roles/:name', async (c) => {
    const name = c.req.param('name');
    const patch = (await c.req.json()) as UpdateRoleInput;
    try {
      const role = roles.update(name, patch);
      return c.json({ role });
    } catch (err) {
      if (err instanceof RuleError && err.code === 'ROLE_NOT_FOUND') {
        return c.json({ error: err.message }, 404);
      }
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.delete('/api/roles/:name', (c) => {
    roles.delete(c.req.param('name'));
    return c.body(null, 204);
  });

  app.get('/api/rules', (c) => c.json({ rules: rules.list() }));

  app.post('/api/rules', async (c) => {
    const body = (await c.req.json()) as CreateRuleInput;
    const rule = rules.create(body);
    return c.json({ rule }, 201);
  });

  app.put('/api/rules/:id', async (c) => {
    const id = c.req.param('id');
    const patch = (await c.req.json()) as UpdateRuleInput;
    try {
      const rule = rules.update(id, patch);
      return c.json({ rule });
    } catch {
      return c.json({ error: `rule ${id} not found` }, 404);
    }
  });

  app.delete('/api/rules/:id', (c) => {
    rules.delete(c.req.param('id'));
    return c.body(null, 204);
  });

  app.post('/api/plan/organize', async (c) => {
    const body = (await c.req.json()) as {
      driveRoots?: Record<string, string>;
      roles?: RoleDefinition[];
    };
    const plan = planOrganize({
      db: opts.db,
      driveRoots: mergeDriveRoots(drives, body.driveRoots ?? {}),
      roles: body.roles ?? [],
    });
    return c.json(plan);
  });

  app.post('/api/organize/auto-apply', async (c) => {
    const body = (await c.req.json()) as {
      operations: PlannedOperation[];
      driveRoots?: Record<string, string>;
    };
    const result = await autoApply({
      db: opts.db,
      operations: body.operations,
      driveRoots: mergeDriveRoots(drives, body.driveRoots ?? {}),
      chunkBytes: 1024 * 1024,
    });
    if (result.autoBatchId) {
      events.publish({
        type: 'batch-status',
        batchId: result.autoBatchId,
        status: 'completed',
      });
    }
    return c.json(result);
  });

  app.post('/api/organize/apply', async (c) => {
    const body = (await c.req.json()) as {
      description: string;
      operations: PlannedOperation[];
      driveRoots?: Record<string, string>;
      dryRun?: boolean;
    };
    const result = await applyApprovedBatch({
      db: opts.db,
      description: body.description,
      operations: body.operations,
      driveRoots: mergeDriveRoots(drives, body.driveRoots ?? {}),
      chunkBytes: 1024 * 1024,
      dryRun: body.dryRun === true,
    });
    events.publish({
      type: 'batch-status',
      batchId: result.batchId,
      status: result.failed === 0 ? 'completed' : 'failed',
    });
    return c.json(result);
  });

  app.post('/api/organize/undo/:batchId', async (c) => {
    const batchId = c.req.param('batchId');
    const body = (await c.req.json().catch(() => ({}))) as {
      driveRoots?: Record<string, string>;
    };
    try {
      const result = await undoBatch({
        db: opts.db,
        batchId,
        driveRoots: mergeDriveRoots(drives, body.driveRoots ?? {}),
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/api/batches', (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 1000);
    return c.json({ batches: batches.list({ limit }) });
  });

  app.get('/api/batches/:id', (c) => {
    const id = c.req.param('id');
    const batch = batches.findById(id);
    if (!batch) return c.json({ error: 'not-found' }, 404);
    const operations = batches.listOperations(id);
    return c.json({ batch, operations });
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

/**
 * Build the driveId → root path map by combining the catalog's stored
 * mount paths with anything the request explicitly provided.
 * Caller-supplied values win, so a user can override a stale stored mount.
 */
function mergeDriveRoots(
  drives: DriveRepo,
  override: Record<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of drives.list()) {
    if (d.mountPath) out.set(d.id, d.mountPath);
  }
  for (const [id, root] of Object.entries(override)) {
    out.set(id, root);
  }
  return out;
}
