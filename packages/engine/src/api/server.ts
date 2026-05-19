import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Context } from 'hono';
import sharp from 'sharp';
import { ensurePreviewCacheDir, getOrCreatePreview } from './preview-cache.js';
import { SettingsSchema, CreateRoleInputSchema, UpdateRoleInputSchema } from './validators.js';
import type { Catalog } from '../catalog/connection.js';
import { DriveRepo } from '../drives/repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { ThrottleManager, ThrottleManagerRef } from '../throttle/manager.js';
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
import { findEmptyDirs, removeEmptyDirs } from '../cleanup/empty-dirs.js';
import { isPathUnderRoot } from '../drives/paths.js';
import {
  defaultThrottleProfiles,
  CatalogError,
  DriveError,
  IntegrityError,
  QuarantineError,
  RuleError,
  ScanError,
  type Settings,
} from '@fileorganizer/shared';
import { EventBus } from './events.js';

export interface CreateServerOptions {
  db: Catalog;
  port: number;
  hostname: string;
  catalogPath?: string;
  onSettingsChanged?: (settings: Settings) => void;
  /** Process-singleton throttle ref shared with the scheduler in cli/serve.ts.
   * When omitted the server creates a local ThrottleManager for each scan
   * (legacy behaviour, used in tests that don't need scheduler integration). */
  throttle?: ThrottleManagerRef;
}

export interface ServerHandle {
  port: number;
  events: EventBus;
  close(): Promise<void>;
}

const COPY_CHUNK_BYTES = 1024 * 1024;
const CACHE_CONTROL_MAX_AGE = 'max-age=300';

async function parseJsonBody<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

export async function createServer(opts: CreateServerOptions): Promise<ServerHandle> {
  const app = new Hono();
  const events = new EventBus();

  // Centralised error handler. Maps typed domain errors to structured responses.
  // Unknown errors are logged and returned as a generic 500 to avoid leaking
  // internal details (stack traces, DB messages, file paths) to callers.
  app.onError((err, c) => {
    if (err instanceof RuleError) return c.json({ error: err.message, code: err.code }, 400);
    if (err instanceof DriveError) return c.json({ error: err.message, code: err.code }, 503);
    if (err instanceof QuarantineError) return c.json({ error: err.message, code: err.code }, 400);
    if (err instanceof IntegrityError) return c.json({ error: err.message, code: err.code }, 400);
    if (err instanceof CatalogError) return c.json({ error: err.message, code: err.code }, 500);
    if (err instanceof ScanError) {
      const status =
        err.code === 'VOLUME_SERIAL_MISMATCH' ? 409
        : err.code === 'DRIVE_NOT_FOUND' ? 404
        : err.code === 'DRIVE_DISCONNECTED' ? 503
        : 500;
      return c.json({ error: err.message, code: err.code }, status);
    }
    console.error('api-internal-error', { url: c.req.url, err: (err as Error).message });
    return c.json({ error: 'internal' }, 500);
  });

  // 8 MB cap on all routes. GETs don't send bodies so this is a no-op for
  // them. The largest expected mutation payload is a JSON operation list
  // (hundreds of KB at most), so 8 MB gives a very wide safety margin while
  // still blocking request-flooding and memory-exhaustion attacks.
  const BODY_LIMIT = 8 * 1024 * 1024;
  app.use(
    '*',
    bodyLimit({
      maxSize: BODY_LIMIT,
      onError: (c) => c.json({ error: 'request-too-large', maxSize: BODY_LIMIT }, 413),
    }),
  );

  const drives = new DriveRepo(opts.db);
  const scans = new ScansRepo(opts.db);
  const activeScans = new Map<string, AbortController>();

  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/api/drives', (c) => c.json({ drives: drives.list() }));
  app.get('/api/scans/:id', (c) => {
    const id = c.req.param('id');
    const s = scans.findById(id);
    if (!s) return c.json({ error: 'not-found' }, 404);
    return c.json({ scan: s });
  });
  app.post('/api/scans', async (c) => {
    const body = await parseJsonBody<{
      driveId?: string;
      rootPath?: string;
      rootPaths?: string[];
      profile?: 'idle' | 'balanced' | 'full-send';
      mediainfoPath?: string;
    }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);

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
      // Sub-fix C: resolve each path and verify it is under the drive's mountPath.
      // If mountPath is not recorded for the drive, skip the confinement check.
      if (drive.mountPath) {
        const mountPath = resolve(drive.mountPath);
        for (const p of body.rootPaths) {
          const resolved = resolve(p);
          if (resolved !== mountPath && !resolved.startsWith(mountPath + '/')) {
            return c.json({ error: 'path-not-confined', path: p }, 400);
          }
        }
      }
      roots = body.rootPaths;
    } else {
      return c.json({ error: 'either driveId+rootPaths or rootPath is required' }, 400);
    }

    // Guard against concurrent scans on the same drive. If a scan is already
    // running for this driveId, markMissing (orchestrator.ts) would flag the
    // second scan's in-flight files as missing when the first scan finishes.
    if (scans.hasRunning(drive.id)) {
      return c.json({ error: 'scan-already-running', driveId: drive.id }, 409);
    }

    const settings = new SettingsRepo(opts.db).load();
    // Use the process-singleton ref when provided (normal serve path), so the
    // scheduler's profile transitions reach in-flight scans.  When no ref was
    // injected (tests, CLI scan command) fall back to a local manager.
    const throttle: ThrottleManager | ThrottleManagerRef = opts.throttle
      ? opts.throttle
      : new ThrottleManager(
          settings.throttleProfiles,
          body.profile ?? 'balanced',
          settings.throttleSchedule,
        );
    const log = createLogger({ level: 'info', write: defaultWriter });
    const mediainfoPath = body.mediainfoPath ?? '';
    const controller = new AbortController();
    let registeredId: string | null = null;
    // Sub-fix B: resolve a promise the moment onStart fires so we capture
    // registeredId without relying on a hardcoded sleep.
    let onStartResolve: () => void;
    const onStartFired = new Promise<void>((res) => { onStartResolve = res; });
    const promise = runScan({
      db: opts.db,
      driveId: drive.id,
      roots,
      categoryMap: settings.categoryMap,
      throttle,
      log,
      mediainfoPath,
      extraExcluded: settings.userExcluded,
      signal: controller.signal,
      onStart: (scanId) => {
        registeredId = scanId;
        activeScans.set(scanId, controller);
        onStartResolve();
      },
    });
    // Attach background completion handlers.  The .catch here only fires for
    // errors thrown AFTER onStart (i.e., mid-scan failures).  Pre-start errors
    // (VOLUME_SERIAL_MISMATCH, DRIVE_NOT_FOUND) are detected via the race below
    // and returned as synchronous HTTP responses before reaching this .catch.
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
      .catch((err) => log.error('background-scan-failed', { err: (err as Error).message }))
      .finally(() => {
        if (registeredId) activeScans.delete(registeredId);
      });
    // Race: either onStart fires (normal scan started) or runScan rejects
    // before inserting a scans row (pre-start failure such as VOLUME_SERIAL_MISMATCH).
    try {
      await Promise.race([onStartFired, promise]);
    } catch (err) {
      // ScanError and DriveError are typed — let onError map them to the right
      // status codes. Any other error also propagates to onError to avoid leaking
      // internal messages verbatim.
      throw err;
    }
    const scan = scans.findById(registeredId!);
    return c.json({ scan }, 201);
  });

  app.get('/api/scans', (c) => {
    const driveId = c.req.query('driveId');
    const list = driveId ? scans.list({ driveId }) : scans.list();
    return c.json({ scans: list });
  });

  app.post('/api/scans/:id/cancel', (c) => {
    const id = c.req.param('id');
    const ctrl = activeScans.get(id);
    if (!ctrl) return c.json({ error: 'no active scan with that id' }, 404);
    ctrl.abort();
    const scan = scans.findById(id);
    return c.json({ scan });
  });

  app.get('/api/files', (c) => {
    const driveId = c.req.query('driveId');
    if (!driveId) return c.json({ error: 'driveId required' }, 400);
    const rawLimit = Number(c.req.query('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 100;
    const rawOffset = Number(c.req.query('offset'));
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;
    const rows = opts.db
      .prepare(
        `SELECT id, drive_id AS driveId, path, name, extension, size_bytes AS sizeBytes,
                category, sha256, mtime, exif_date AS exifDate, date_source AS dateSource,
                state FROM files WHERE drive_id = ? ORDER BY path LIMIT ? OFFSET ?`,
      )
      .all(driveId, limit, offset);
    return c.json({ files: rows });
  });

  app.get('/api/fs/list', (c) => {
    const requested = c.req.query('path') ?? '';
    if (!requested) return c.json({ error: 'path required' }, 400);
    const allowedRoots = drives
      .list()
      .map((d) => d.mountPath)
      .filter((p): p is string => !!p);
    if (requested === '/') {
      const seen = new Set<string>();
      const entries = allowedRoots
        .filter((p) => {
          if (seen.has(p)) return false;
          seen.add(p);
          return true;
        })
        .map((p) => ({ name: p, kind: 'dir' as const, path: p }));
      return c.json({ entries });
    }
    const abs = resolve(requested);
    if (!isPathUnderAny(abs, allowedRoots)) {
      return c.json({ error: 'path is not under a registered drive' }, 403);
    }
    if (!existsSync(abs)) return c.json({ error: 'path not found' }, 404);
    let dirents;
    try {
      // eslint-disable-next-line no-restricted-syntax -- TODO #11: per-call readdir for the folder picker; bounded to one directory's children, but should still move to async fs.promises.readdir.
      dirents = readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    const entries = dirents
      .map((d) => {
        const childPath = join(abs, d.name);
        const kind: 'dir' | 'file' | null = d.isDirectory()
          ? 'dir'
          : d.isFile()
            ? 'file'
            : null;
        return kind ? { name: d.name, kind, path: childPath } : null;
      })
      .filter((e): e is { name: string; kind: 'dir' | 'file'; path: string } => e !== null)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 1000);
    return c.json({ entries });
  });

  const catalogDir = opts.catalogPath
    ? dirname(opts.catalogPath)
    : (() => {
        const name = (opts.db as unknown as { name?: string }).name;
        return name ? dirname(name) : process.cwd();
      })();
  ensurePreviewCacheDir(catalogDir);

  app.get('/api/preview/:fileId', async (c) => {
    const fileId = parseInt(c.req.param('fileId'), 10);
    if (Number.isNaN(fileId)) return c.json({ error: 'invalid file id' }, 400);
    const requested = parseInt(c.req.query('max') ?? '256', 10);
    const max = Math.min(Math.max(Number.isFinite(requested) ? requested : 256, 16), 2048);
    const row = opts.db
      .prepare(`SELECT path, category, sha256 FROM files WHERE id = ?`)
      .get(fileId) as { path: string; category: string; sha256: string } | undefined;
    if (!row) return c.json({ error: 'file not found' }, 404);
    if (row.category !== 'image') return c.json({ error: 'not an image' }, 400);
    const allowedRoots = drives
      .list()
      .map((d) => d.mountPath)
      .filter((p): p is string => !!p);
    if (!isPathUnderAny(row.path, allowedRoots)) {
      return c.json({ error: 'path is not under a registered drive' }, 403);
    }
    if (!existsSync(row.path)) return c.json({ error: 'file missing on disk' }, 404);
    let sourceMtimeMs: number;
    try {
      sourceMtimeMs = statSync(row.path).mtimeMs;
    } catch {
      sourceMtimeMs = 0;
    }
    try {
      const cachePath = await getOrCreatePreview({
        catalogDir,
        sha256: row.sha256,
        sourcePath: row.path,
        sourceMtimeMs,
        max,
        resize: async (src, m) =>
          sharp(src)
            .rotate()
            .resize(m, m, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer(),
      });
      const stream = createReadStream(cachePath);
      const webStream = Readable.toWeb(stream) as ReadableStream;
      return new Response(webStream, {
        headers: {
          'content-type': 'image/jpeg',
          'cache-control': CACHE_CONTROL_MAX_AGE,
        },
      });
    } catch (err) {
      return c.json({ error: `preview failed: ${(err as Error).message}` }, 500);
    }
  });

  app.get('/api/duplicates', (c) => {
    const minSize = Math.max(parseInt(c.req.query('minSize') ?? '1', 10), 1);
    const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 500);
    const rawOffset = parseInt(c.req.query('offset') ?? '0', 10);
    const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);
    const plan = planDedupe(opts.db, { minSizeBytes: minSize, limit, offset });
    return c.json(plan);
  });

  app.post('/api/duplicates/apply', async (c) => {
    const body = await parseJsonBody<{
      operations: DedupeOperation[];
      driveRoots?: Record<string, string>;
    }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    if (!Array.isArray(body.operations)) {
      return c.json({ error: 'operations must be an array' }, 400);
    }
    const merged = mergeDriveRoots(drives, body.driveRoots ?? {});
    const dedupeProfile = opts.throttle
      ? opts.throttle.current()
      : defaultThrottleProfiles(1).balanced;
    const result = await applyDedupe({
      db: opts.db,
      operations: body.operations,
      driveRoots: merged,
      chunkBytes: dedupeProfile.readChunkBytes,
      sleepMs: dedupeProfile.interChunkSleepMs,
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
    const body = await parseJsonBody<{
      quarantineIds: number[];
      driveRoots?: Record<string, string>;
    }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    if (!Array.isArray(body.quarantineIds)) {
      return c.json({ error: 'quarantineIds must be an array' }, 400);
    }
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
  const settingsRepo = new SettingsRepo(opts.db);

  app.get('/api/settings', (c) => c.json({ settings: settingsRepo.load() }));

  app.put('/api/settings', async (c) => {
    const body = await parseJsonBody<{ settings: unknown }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    const parsed = SettingsSchema.safeParse(body.settings);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return c.json(
        { error: 'validation', path: first?.path.join('.'), message: first?.message },
        400,
      );
    }
    const settings = parsed.data as Settings;
    settingsRepo.save(settings);
    opts.onSettingsChanged?.(settings);
    return c.json({ settings });
  });

  // Whole-name exclusion match. Wraps the path in `\…\`, normalizes `/`
  // to `\` so POSIX-stored paths still match, and lowercases both sides
  // (NTFS is case-insensitive; POSIX is not, but a user-facing whole-name
  // exclusion that flipped case-sensitive on POSIX would surprise users).
  const EXCLUSION_MATCH_SQL = `INSTR(LOWER('\\' || REPLACE(path, '/', '\\') || '\\'),
                                     LOWER('\\' || ? || '\\')) > 0`;
  const validateExclusionSegment = (raw: unknown): string | null => {
    const seg = typeof raw === 'string' ? raw.trim() : '';
    if (!seg || seg.includes('\\') || seg.includes('/') || seg.includes(':')) {
      return null;
    }
    return seg;
  };
  const exclusionValidationError =
    'segment must be a non-empty folder name with no separators or colons';

  app.post('/api/exclusions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      segment?: string;
      dryRun?: boolean;
    };
    const seg = validateExclusionSegment(body.segment);
    if (!seg) return c.json({ error: exclusionValidationError }, 400);
    const countRow = opts.db
      .prepare(`SELECT COUNT(*) AS n FROM files WHERE ${EXCLUSION_MATCH_SQL}`)
      .get(seg) as { n: number };
    const wouldRemove = countRow.n;
    if (body.dryRun === true) {
      return c.json({ wouldRemove, userExcluded: settingsRepo.load().userExcluded });
    }
    const current = settingsRepo.load();
    if (!current.userExcluded.some((x) => x.toLowerCase() === seg.toLowerCase())) {
      current.userExcluded.push(seg);
    }
    const result = opts.db
      .prepare(`DELETE FROM files WHERE ${EXCLUSION_MATCH_SQL}`)
      .run(seg);
    settingsRepo.save(current);
    opts.onSettingsChanged?.(current);
    return c.json({ removed: result.changes, userExcluded: current.userExcluded });
  });

  app.delete('/api/exclusions/:segment', (c) => {
    const seg = validateExclusionSegment(c.req.param('segment'));
    if (!seg) return c.json({ error: exclusionValidationError }, 400);
    const current = settingsRepo.load();
    current.userExcluded = current.userExcluded.filter(
      (x) => x.toLowerCase() !== seg.toLowerCase(),
    );
    settingsRepo.save(current);
    opts.onSettingsChanged?.(current);
    return c.json({ userExcluded: current.userExcluded });
  });

  app.get('/api/roles', (c) => c.json({ roles: roles.list() }));

  app.post('/api/roles', async (c) => {
    const body = await parseJsonBody<unknown>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    const parsed = CreateRoleInputSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return c.json(
        { error: 'validation', path: first?.path.join('.'), message: first?.message },
        400,
      );
    }
    const input = parsed.data as CreateRoleInput;
    try {
      const role = roles.create(input);
      return c.json({ role }, 201);
    } catch (err) {
      if (err instanceof RuleError && err.code === 'ROLE_EXISTS') {
        return c.json({ error: err.message }, 409);
      }
      // Other RuleErrors (UNKNOWN_DRIVE_IN_ROLE etc.) propagate to onError → 400 with code.
      throw err;
    }
  });

  app.put('/api/roles/:name', async (c) => {
    const name = c.req.param('name');
    const body = await parseJsonBody<unknown>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    const parsed = UpdateRoleInputSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return c.json(
        { error: 'validation', path: first?.path.join('.'), message: first?.message },
        400,
      );
    }
    const patch = parsed.data as UpdateRoleInput;
    try {
      const role = roles.update(name, patch);
      return c.json({ role });
    } catch (err) {
      if (err instanceof RuleError && err.code === 'ROLE_NOT_FOUND') {
        return c.json({ error: err.message }, 404);
      }
      // Other RuleErrors (UNKNOWN_DRIVE_IN_ROLE etc.) propagate to onError → 400 with code.
      throw err;
    }
  });

  app.delete('/api/roles/:name', (c) => {
    roles.delete(c.req.param('name'));
    return c.body(null, 204);
  });

  app.get('/api/rules', (c) => c.json({ rules: rules.list() }));

  app.post('/api/rules', async (c) => {
    const body = await parseJsonBody<CreateRuleInput>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    // rules.create() may throw RuleError — let it propagate to onError → 400 with code.
    const rule = rules.create(body);
    return c.json({ rule }, 201);
  });

  app.put('/api/rules/:id', async (c) => {
    const id = c.req.param('id');
    const patch = await parseJsonBody<UpdateRuleInput>(c);
    if (!patch) return c.json({ error: 'invalid-json' }, 400);
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
    const body = await parseJsonBody<{
      driveRoots?: Record<string, string>;
      limit?: number;
      offset?: number;
    }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    const rawLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : 200;
    const limit = Math.min(Math.max(rawLimit, 1), 1000);
    const rawOffset = typeof body.offset === 'number' && Number.isFinite(body.offset) ? body.offset : 0;
    const offset = Math.max(rawOffset, 0);
    const plan = planOrganize({
      db: opts.db,
      driveRoots: mergeDriveRoots(drives, body.driveRoots ?? {}),
      limit,
      offset,
    });
    return c.json(plan);
  });

  app.post('/api/organize/auto-apply', async (c) => {
    const body = await parseJsonBody<{
      operations: PlannedOperation[];
      driveRoots?: Record<string, string>;
    }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    if (!Array.isArray(body.operations)) {
      return c.json({ error: 'operations must be an array' }, 400);
    }
    try {
      const result = await autoApply({
        db: opts.db,
        operations: body.operations,
        driveRoots: mergeDriveRoots(drives, body.driveRoots ?? {}),
        chunkBytes: COPY_CHUNK_BYTES,
      });
      if (result.autoBatchId) {
        events.publish({
          type: 'batch-status',
          batchId: result.autoBatchId,
          status: 'completed',
        });
      }
      return c.json(result);
    } catch (err) {
      if (err instanceof DriveError) {
        return c.json({ error: err.message, code: err.code }, 503);
      }
      throw err;
    }
  });

  app.post('/api/organize/apply', async (c) => {
    const body = await parseJsonBody<{
      description: string;
      operations: PlannedOperation[];
      driveRoots?: Record<string, string>;
      dryRun?: boolean;
      removeEmptySourceDirs?: boolean;
    }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    if (!Array.isArray(body.operations)) {
      return c.json({ error: 'operations must be an array' }, 400);
    }
    try {
      const result = await applyApprovedBatch({
        db: opts.db,
        description: body.description,
        operations: body.operations,
        driveRoots: mergeDriveRoots(drives, body.driveRoots ?? {}),
        chunkBytes: COPY_CHUNK_BYTES,
        dryRun: body.dryRun === true,
        removeEmptySourceDirs: body.removeEmptySourceDirs === true,
      });
      events.publish({
        type: 'batch-status',
        batchId: result.batchId,
        status: result.failed === 0 ? 'completed' : 'failed',
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof DriveError) {
        return c.json({ error: err.message, code: err.code }, 503);
      }
      throw err;
    }
  });

  app.post('/api/organize/apply-all', async (c) => {
    const body = await parseJsonBody<{
      description: string;
      driveRoots?: Record<string, string>;
      dryRun?: boolean;
      removeEmptySourceDirs?: boolean;
      ruleIds?: string[];
      kinds?: ('same-drive-move' | 'cross-drive-move')[];
    }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    const driveRoots = mergeDriveRoots(drives, body.driveRoots ?? {});
    const plan = planOrganize({ db: opts.db, driveRoots });
    const ruleFilter = Array.isArray(body.ruleIds) ? new Set(body.ruleIds) : null;
    const kindFilter = Array.isArray(body.kinds) ? new Set(body.kinds) : null;
    const operations = plan.operations.filter((op) => {
      if (op.kind === 'noop') return false;
      if (ruleFilter && !ruleFilter.has(op.ruleId)) return false;
      if (kindFilter && !kindFilter.has(op.kind)) return false;
      return true;
    });
    if (operations.length === 0) {
      return c.json({ batchId: null, completed: 0, failed: 0, emptyDirsRemoved: 0 });
    }
    try {
      const result = await applyApprovedBatch({
        db: opts.db,
        description: body.description,
        operations,
        driveRoots,
        chunkBytes: COPY_CHUNK_BYTES,
        dryRun: body.dryRun === true,
        removeEmptySourceDirs: body.removeEmptySourceDirs === true,
      });
      events.publish({
        type: 'batch-status',
        batchId: result.batchId,
        status: result.failed === 0 ? 'completed' : 'failed',
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof DriveError) {
        return c.json({ error: err.message, code: err.code }, 503);
      }
      throw err;
    }
  });

  app.post('/api/organize/undo/:batchId', async (c) => {
    const batchId = c.req.param('batchId');
    const body = (await parseJsonBody<{ driveRoots?: Record<string, string> }>(c)) ?? {};
    // undoBatch throws typed errors — they propagate to onError for structured responses.
    const result = await undoBatch({
      db: opts.db,
      batchId,
      driveRoots: mergeDriveRoots(drives, body.driveRoots ?? {}),
    });
    return c.json(result);
  });

  app.get('/api/cleanup/empty-dirs', (c) => {
    const driveId = c.req.query('driveId');
    if (!driveId) return c.json({ error: 'driveId required' }, 400);
    const result = findEmptyDirs(opts.db, driveId);
    return c.json({ driveId, ...result });
  });

  app.post('/api/cleanup/empty-dirs/apply', async (c) => {
    const body = await parseJsonBody<{ driveId: string; paths: string[] }>(c);
    if (!body) return c.json({ error: 'invalid-json' }, 400);
    if (!body.driveId) return c.json({ error: 'driveId required' }, 400);
    if (!Array.isArray(body.paths)) return c.json({ error: 'paths must be an array' }, 400);
    const merged = mergeDriveRoots(drives, {});
    const root = merged.get(body.driveId);
    if (!root) return c.json({ error: 'no mount path for drive' }, 400);
    const result = removeEmptyDirs(opts.db, { driveRoot: root, paths: body.paths });
    events.publish({
      type: 'batch-status',
      batchId: result.batchId,
      status: result.failed.length === 0 ? 'completed' : 'failed',
    });
    return c.json(result);
  });

  app.post('/api/cleanup/empty-dirs/apply-all', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { driveId?: string };
    if (!body.driveId) return c.json({ error: 'driveId required' }, 400);
    const merged = mergeDriveRoots(drives, {});
    const root = merged.get(body.driveId);
    if (!root) return c.json({ error: 'no mount path for drive' }, 400);
    const { paths } = findEmptyDirs(opts.db, body.driveId, { unbounded: true });
    if (paths.length === 0) {
      return c.json({ batchId: null, removed: 0, failed: [] });
    }
    const result = removeEmptyDirs(opts.db, { driveRoot: root, paths });
    events.publish({
      type: 'batch-status',
      batchId: result.batchId,
      status: result.failed.length === 0 ? 'completed' : 'failed',
    });
    return c.json(result);
  });

  app.get('/api/batches', (c) => {
    const rawLimit = Number(c.req.query('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 100;
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
function isPathUnderAny(path: string, roots: readonly string[]): boolean {
  for (const r of roots) {
    const trimmed = r.replace(/[/\\]+$/, '');
    if (!trimmed) continue;
    // path equal to the root itself is also allowed (not just strictly under it)
    if (path === trimmed) return true;
    if (isPathUnderRoot(trimmed, path)) return true;
  }
  return false;
}

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
