import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { isPathExcluded } from './exclusions.js';

export interface WalkOptions {
  roots: string[];
  extensions: ReadonlySet<string>;
  excluded: ReadonlySet<string>;
  extraExcluded: readonly string[];
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
    yield* walkOne(root, opts);
  }
}

async function* walkOne(dir: string, opts: WalkOptions): AsyncIterable<WalkEntry> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childName = entry.name;
    if (isPathExcluded(childName, opts.excluded, opts.extraExcluded)) {
      continue;
    }
    const childPath = join(dir, childName);
    if (entry.isDirectory()) {
      yield* walkOne(childPath, opts);
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
    }
  }
}
