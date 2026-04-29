import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { isPathExcluded } from './exclusions.js';

export interface WalkOptions {
  roots: string[];
  extensions: ReadonlySet<string>;
  excluded: ReadonlySet<string>;
  extraExcluded: readonly string[];
  signal?: AbortSignal;
  onEmptyDir?: (path: string) => void;
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
  for (const root of opts.roots) {
    if (opts.signal?.aborted) return;
    yield* walkOne(root, opts, true);
  }
}

async function* walkOne(
  dir: string,
  opts: WalkOptions,
  isRoot: boolean,
): AsyncGenerator<WalkEntry, number, void> {
  if (opts.signal?.aborted) return 0;
  let entries;
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
    if (entry.isDirectory()) {
      const childYielded = yield* walkOne(childPath, opts, false);
      yieldedCount += childYielded;
    } else if (entry.isFile()) {
      const ext = extname(childName).slice(1).toLowerCase();
      if (!opts.extensions.has(ext)) continue;
      let s;
      try {
        s = await stat(childPath);
      } catch {
        continue;
      }
      yield {
        path: childPath,
        name: basename(childPath),
        extension: ext,
        sizeBytes: s.size,
        mtime: s.mtime.toISOString(),
        ctime: s.ctime.toISOString(),
      };
      yieldedCount += 1;
    }
  }
  if (!isRoot && yieldedCount === 0 && !opts.signal?.aborted) {
    opts.onEmptyDir?.(dir);
  }
  return yieldedCount;
}
