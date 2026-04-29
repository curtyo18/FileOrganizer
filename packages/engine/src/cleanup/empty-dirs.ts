import { readdirSync, rmdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { BatchesRepo } from '../catalog/batches-repo.js';
import type { Catalog } from '../catalog/connection.js';
import { DEFAULT_EXCLUDED_NAMES, isPathExcluded } from '../scan/exclusions.js';

const DEFAULT_CAP = 5000;

export interface FindEmptyDirsResult {
  paths: string[];
  totalEmpty: number;
  truncated: boolean;
}

export interface FindEmptyDirsOptions {
  cap?: number;
  excluded?: ReadonlySet<string>;
  extraExcluded?: readonly string[];
}

/**
 * Returns absolute paths of directories that are *recursively* empty,
 * meaning they contain no files anywhere in their subtree.
 * Skips anything matched by isPathExcluded so we don't descend into
 * (or report) node_modules / .git / quarantine.
 *
 * Sorted deepest-first so callers can rmdir children before parents.
 */
export function findEmptyDirs(
  driveRoot: string,
  options: FindEmptyDirsOptions = {},
): FindEmptyDirsResult {
  const cap = options.cap ?? DEFAULT_CAP;
  const excluded = options.excluded ?? DEFAULT_EXCLUDED_NAMES;
  const extras = options.extraExcluded ?? [];
  const root = resolve(driveRoot);
  const collected: string[] = [];
  let truncated = false;

  const visit = (dir: string): boolean => {
    if (collected.length >= cap) {
      truncated = true;
      return false;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let containsFiles = false;
    let allEmpty = true;
    for (const e of entries) {
      if (e.isFile()) {
        containsFiles = true;
        allEmpty = false;
        continue;
      }
      if (e.isDirectory()) {
        if (isPathExcluded(e.name, excluded, extras)) {
          allEmpty = false;
          continue;
        }
        const child = join(dir, e.name);
        const childEmpty = visit(child);
        if (!childEmpty) allEmpty = false;
      } else {
        allEmpty = false;
      }
    }
    if (containsFiles) return false;
    if (!allEmpty) return false;
    if (dir !== root && collected.length < cap) {
      collected.push(dir);
    }
    return true;
  };

  visit(root);
  // Deepest first.
  collected.sort((a, b) => b.length - a.length);
  return {
    paths: collected,
    totalEmpty: collected.length,
    truncated,
  };
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
