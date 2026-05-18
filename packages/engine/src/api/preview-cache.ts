import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface PreviewCacheOptions {
  catalogDir: string;
  sha256: string;
  sourcePath: string;
  sourceMtimeMs: number;
  max: number;
  resize: (sourcePath: string, max: number) => Promise<Buffer>;
}

const MAX_CACHE_BYTES = 500 * 1024 * 1024;
const EVICT_INTERVAL = 100;
const EVICT_FRACTION = 0.2;

export function previewCacheRoot(catalogDir: string): string {
  return join(catalogDir, 'preview-cache');
}

export function previewCachePath(catalogDir: string, sha256: string, max: number): string {
  const prefix = sha256.slice(0, 2);
  return join(previewCacheRoot(catalogDir), prefix, `${sha256}-${max}.jpg`);
}

export function ensurePreviewCacheDir(catalogDir: string): void {
  mkdirSync(previewCacheRoot(catalogDir), { recursive: true });
}

const inflight = new Map<string, Promise<string>>();
let requestCount = 0;

export async function getOrCreatePreview(opts: PreviewCacheOptions): Promise<string> {
  const cachePath = previewCachePath(opts.catalogDir, opts.sha256, opts.max);
  if (cacheHit(cachePath, opts.sourceMtimeMs)) {
    return cachePath;
  }
  const existing = inflight.get(cachePath);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const buf = await opts.resize(opts.sourcePath, opts.max);
      mkdirSync(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, buf);
      maybeEvict(opts.catalogDir);
      return cachePath;
    } finally {
      inflight.delete(cachePath);
    }
  })();
  inflight.set(cachePath, promise);
  return promise;
}

function cacheHit(cachePath: string, sourceMtimeMs: number): boolean {
  if (!existsSync(cachePath)) return false;
  try {
    const st = statSync(cachePath);
    return st.mtimeMs >= sourceMtimeMs;
  } catch {
    return false;
  }
}

function maybeEvict(catalogDir: string): void {
  requestCount += 1;
  if (requestCount % EVICT_INTERVAL !== 0) return;
  evictIfTooBig(catalogDir);
}

export function evictIfTooBig(catalogDir: string, maxBytes = MAX_CACHE_BYTES): void {
  const root = previewCacheRoot(catalogDir);
  if (!existsSync(root)) return;
  const entries: { path: string; size: number; mtimeMs: number }[] = [];
  let total = 0;
  let prefixDirs: string[] = [];
  try {
    // eslint-disable-next-line no-restricted-syntax -- TODO #11: LRU eviction walks the cache tree synchronously; should use async fs.promises.readdir.
    prefixDirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name));
  } catch {
    return;
  }
  for (const dir of prefixDirs) {
    let files;
    try {
      // eslint-disable-next-line no-restricted-syntax -- TODO #11: same LRU eviction walk; should use async fs.promises.readdir.
      files = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.isFile()) continue;
      const p = join(dir, f.name);
      try {
        const st = statSync(p);
        entries.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
        total += st.size;
      } catch {
        /* ignore */
      }
    }
  }
  if (total <= maxBytes) return;
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const target = Math.max(1, Math.floor(entries.length * EVICT_FRACTION));
  for (let i = 0; i < target; i += 1) {
    try {
      unlinkSync(entries[i]!.path);
    } catch {
      /* ignore */
    }
  }
}
