import { readdirSync, rmdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { EmptyDirsRepo } from '../catalog/empty-dirs-repo.js';
import type { Catalog } from '../catalog/connection.js';

export interface FindEmptyDirsResult {
  paths: string[];
  totalEmpty: number;
  truncated: boolean;
}

export interface FindEmptyDirsOptions {
  cap?: number;
}

/**
 * Returns absolute paths of directories that are recursively empty for
 * `driveId`. Backed by `empty_dirs` rows the scan walker populates, so
 * this is a constant-time SQL read — no on-demand filesystem walk.
 *
 * Sorted deepest-first so callers can rmdir children before parents.
 */
export function findEmptyDirs(
  db: Catalog,
  driveId: string,
  options: FindEmptyDirsOptions = {},
): FindEmptyDirsResult {
  const repo = new EmptyDirsRepo(db);
  return repo.listForDrive(driveId, options.cap);
}

export interface RemoveEmptyDirsResult {
  batchId: string;
  removed: number;
  failed: { path: string; reason: string }[];
}

export interface RemoveEmptyDirsOptions {
  driveRoot: string;
  paths: string[];
  description?: string;
}

/**
 * Validates each path is under driveRoot, double-checks emptiness, and
 * rmdirSync's the survivors deepest-first. Wraps the whole pass in a
 * cleanup-empty-dirs batch with one operation row per path attempted.
 */
export function removeEmptyDirs(
  db: Catalog,
  options: RemoveEmptyDirsOptions,
): RemoveEmptyDirsResult {
  const batches = new BatchesRepo(db);
  const batch = batches.start({
    kind: 'cleanup-empty-dirs',
    description: options.description ?? 'cleanup empty directories',
  });
  const root = resolve(options.driveRoot);
  const failed: { path: string; reason: string }[] = [];
  let removed = 0;

  // Deepest first so children come out before parents.
  const ordered = [...options.paths].sort((a, b) => b.length - a.length);

  for (const raw of ordered) {
    const abs = resolve(raw);
    const op = batches.recordOperation(batch.id, {
      kind: 'delete',
      sourcePath: abs,
      status: 'in-progress',
    });
    if (!isUnder(root, abs)) {
      const reason = 'path escapes drive root';
      batches.updateOperationStatus(op.id, 'failed', { errorMessage: reason });
      failed.push({ path: abs, reason });
      continue;
    }
    let stat;
    try {
      stat = statSync(abs);
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      batches.updateOperationStatus(op.id, 'failed', { errorMessage: reason });
      failed.push({ path: abs, reason });
      continue;
    }
    if (!stat.isDirectory()) {
      const reason = 'not a directory';
      batches.updateOperationStatus(op.id, 'failed', { errorMessage: reason });
      failed.push({ path: abs, reason });
      continue;
    }
    let entries;
    try {
      // eslint-disable-next-line no-restricted-syntax -- bounded per-path re-check before rmdir; safe sync. One readdir per known-empty path (not a recursive walk), and the catalog can lag behind disk so we must verify before deleting.
      entries = readdirSync(abs);
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      batches.updateOperationStatus(op.id, 'failed', { errorMessage: reason });
      failed.push({ path: abs, reason });
      continue;
    }
    if (entries.length > 0) {
      const reason = 'not empty';
      batches.updateOperationStatus(op.id, 'failed', { errorMessage: reason });
      failed.push({ path: abs, reason });
      continue;
    }
    try {
      rmdirSync(abs);
      batches.updateOperationStatus(op.id, 'completed');
      removed += 1;
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      batches.updateOperationStatus(op.id, 'failed', { errorMessage: reason });
      failed.push({ path: abs, reason });
    }
  }

  batches.finish(batch.id, failed.length === 0 ? 'completed' : 'failed', {
    removed,
    failed: failed.length,
  });

  return { batchId: batch.id, removed, failed };
}

function isUnder(root: string, path: string): boolean {
  if (path === root) return false;
  const withSep = root.endsWith(sep) ? root : root + sep;
  return path.startsWith(withSep);
}
