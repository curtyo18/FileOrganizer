import { readdir, stat, realpath } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { isPathExcluded } from './exclusions.js';
import type { Logger } from '../log.js';

export const MAX_DEPTH = 64;

export interface WalkOptions {
  roots: string[];
  extensions: ReadonlySet<string>;
  excluded: ReadonlySet<string>;
  extraExcluded: readonly string[];
  signal?: AbortSignal;
  onEmptyDir?: (path: string) => void;
  log?: Logger;
}

export interface WalkEntry {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  mtime: string;
  ctime: string;
}

export async function* walk(opts: WalkOptions): AsyncIterable<WalkEntry> {
  const visited = new Set<string>();
  for (const root of opts.roots) {
    if (opts.signal?.aborted) return;
    // Resolve the root's real path once so the visited set starts with a
    // canonical baseline (important when /tmp itself is a symlink, e.g. macOS).
    let rootReal: string;
    try {
      rootReal = await realpath(root);
    } catch {
      opts.log?.warn('walker-realpath-error', { path: root });
      continue;
    }
    visited.add(rootReal);
    yield* walkOne(root, opts, true, 0, visited);
  }
}

async function* walkOne(
  dir: string,
  opts: WalkOptions,
  isRoot: boolean,
  depth: number,
  visited: Set<string>,
): AsyncGenerator<WalkEntry, number, void> {
  if (opts.signal?.aborted) return 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable subtree: treat as non-empty so the parent isn't classified
    // empty just because we couldn't see this child's contents.
    return 1;
  }
  let yieldedCount = 0;
  for (const entry of entries) {
    if (opts.signal?.aborted) return yieldedCount;
    const childName = entry.name;
    if (isPathExcluded(childName, opts.excluded, opts.extraExcluded)) {
      continue;
    }
    const childPath = join(dir, childName);
    // isDirectory() covers real dirs and NTFS junctions (Windows).
    // isSymbolicLink() covers POSIX symlinks; we stat the target to determine
    // if it resolves to a directory (and therefore needs cycle checking).
    const isDir = entry.isDirectory();
    const isSym = entry.isSymbolicLink();

    if (isDir || isSym) {
      // For symlinks, verify the target is a directory before descending.
      if (isSym && !isDir) {
        let targetStat: Awaited<ReturnType<typeof stat>>;
        try {
          targetStat = await stat(childPath); // stat follows symlinks
        } catch {
          // Broken symlink or permission error — skip safely.
          continue;
        }
        if (!targetStat.isDirectory()) {
          // Symlink to a file — treat as a regular file candidate below.
          const ext = extname(childName).slice(1).toLowerCase();
          if (opts.extensions.has(ext)) {
            yield {
              path: childPath,
              name: basename(childPath),
              extension: ext,
              sizeBytes: targetStat.size,
              mtime: targetStat.mtime.toISOString(),
              ctime: targetStat.ctime.toISOString(),
            };
            yieldedCount += 1;
          }
          continue;
        }
        // Symlink to a dir — fall through to cycle/depth checks below.
      }

      // Depth check — bail before resolving realpath for performance.
      const childDepth = depth + 1;
      if (childDepth > MAX_DEPTH) {
        opts.log?.warn('walker-depth-limit', { path: childPath, depth: childDepth });
        yieldedCount += 1; // treat as non-empty so ancestors don't misfire onEmptyDir
        continue;
      }
      // Cycle detection via real path resolution (resolves NTFS junctions on
      // Windows and POSIX symlinks alike).
      let childReal: string;
      try {
        childReal = await realpath(childPath);
      } catch {
        // Permission denied or broken junction/symlink — skip safely.
        opts.log?.warn('walker-realpath-error', { path: childPath });
        yieldedCount += 1; // treat as non-empty
        continue;
      }
      if (visited.has(childReal)) {
        opts.log?.warn('walker-cycle-detected', { path: childPath, realpath: childReal });
        yieldedCount += 1; // treat as non-empty
        continue;
      }
      visited.add(childReal);
      const childYielded = yield* walkOne(childPath, opts, false, childDepth, visited);
      // Remove after recursion so sibling subtrees at the same real path are
      // still visited (only ancestor cycles are suppressed).
      visited.delete(childReal);
      yieldedCount += childYielded;
    } else if (entry.isFile()) {
      const ext = extname(childName).slice(1).toLowerCase();
      if (!opts.extensions.has(ext)) continue;
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(childPath);
      } catch {
        continue;
      }
      yield {
        path: childPath,
        name: basename(childPath),
        extension: ext,
        sizeBytes: fileStat.size,
        mtime: fileStat.mtime.toISOString(),
        ctime: fileStat.ctime.toISOString(),
      };
      yieldedCount += 1;
    }
  }
  if (!isRoot && yieldedCount === 0 && !opts.signal?.aborted) {
    opts.onEmptyDir?.(dir);
  }
  return yieldedCount;
}
