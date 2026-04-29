import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evictIfTooBig,
  getOrCreatePreview,
  previewCachePath,
  previewCacheRoot,
} from './preview-cache.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-prev-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('preview-cache', () => {
  it('only invokes resize on the first call; second call hits the cache', async () => {
    const sourcePath = join(dir, 'src.png');
    writeFileSync(sourcePath, 'pretend');
    const sourceMtimeMs = statSync(sourcePath).mtimeMs;
    let calls = 0;
    const resize = async (): Promise<Buffer> => {
      calls += 1;
      return Buffer.from('jpeg-bytes');
    };

    const first = await getOrCreatePreview({
      catalogDir: dir,
      sha256: 'a'.repeat(64),
      sourcePath,
      sourceMtimeMs,
      max: 64,
      resize,
    });
    const expected = previewCachePath(dir, 'a'.repeat(64), 64);
    expect(first).toBe(expected);
    expect(calls).toBe(1);

    const second = await getOrCreatePreview({
      catalogDir: dir,
      sha256: 'a'.repeat(64),
      sourcePath,
      sourceMtimeMs,
      max: 64,
      resize,
    });
    expect(second).toBe(expected);
    expect(calls).toBe(1);
  });

  it('regenerates if the source mtime is newer than the cached file', async () => {
    const sourcePath = join(dir, 'src.png');
    writeFileSync(sourcePath, 'pretend');
    let calls = 0;
    const resize = async (): Promise<Buffer> => {
      calls += 1;
      return Buffer.from('jpeg-bytes');
    };

    await getOrCreatePreview({
      catalogDir: dir,
      sha256: 'b'.repeat(64),
      sourcePath,
      sourceMtimeMs: 1,
      max: 64,
      resize,
    });
    expect(calls).toBe(1);

    await getOrCreatePreview({
      catalogDir: dir,
      sha256: 'b'.repeat(64),
      sourcePath,
      sourceMtimeMs: Date.now() + 60_000,
      max: 64,
      resize,
    });
    expect(calls).toBe(2);
  });

  it('coalesces concurrent requests for the same key into one resize call', async () => {
    const sourcePath = join(dir, 'src.png');
    writeFileSync(sourcePath, 'pretend');
    const sourceMtimeMs = statSync(sourcePath).mtimeMs;
    let calls = 0;
    const resize = async (): Promise<Buffer> => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 25));
      return Buffer.from('jpeg-bytes');
    };

    const sha = 'c'.repeat(64);
    const [a, b, c] = await Promise.all([
      getOrCreatePreview({
        catalogDir: dir,
        sha256: sha,
        sourcePath,
        sourceMtimeMs,
        max: 64,
        resize,
      }),
      getOrCreatePreview({
        catalogDir: dir,
        sha256: sha,
        sourcePath,
        sourceMtimeMs,
        max: 64,
        resize,
      }),
      getOrCreatePreview({
        catalogDir: dir,
        sha256: sha,
        sourcePath,
        sourceMtimeMs,
        max: 64,
        resize,
      }),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('evicts the oldest 20% of entries when total size exceeds the limit', () => {
    const root = previewCacheRoot(dir);
    mkdirSync(join(root, 'aa'), { recursive: true });
    const paths: string[] = [];
    const now = Date.now() / 1000;
    for (let i = 0; i < 10; i += 1) {
      const p = join(root, 'aa', `${i}.jpg`);
      writeFileSync(p, Buffer.alloc(2_000_000));
      const utime = now - (10 - i);
      utimesSync(p, utime, utime);
      paths.push(p);
    }
    evictIfTooBig(dir, 1_000_000);
    const remaining = paths.filter((p) => existsSync(p));
    expect(remaining.length).toBe(8);
    expect(existsSync(paths[0]!)).toBe(false);
    expect(existsSync(paths[1]!)).toBe(false);
  });
});
