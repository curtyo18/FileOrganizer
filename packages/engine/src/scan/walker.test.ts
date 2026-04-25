import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walk, type WalkOptions } from './walker.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fileorg-walk-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string, body = ''): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

const opts: Omit<WalkOptions, 'roots'> = {
  extensions: new Set(['jpg', 'pdf']),
  excluded: new Set(['Windows', 'node_modules']),
  extraExcluded: [],
};

describe('walk', () => {
  it('emits files matching extension allowlist', async () => {
    touch('a.jpg');
    touch('b.pdf');
    touch('c.exe');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, '').replace(/\\/g, '/'));
    }
    expect(seen.sort()).toEqual(['/a.jpg', '/b.pdf']);
  });

  it('skips excluded directories', async () => {
    touch('keep/a.jpg');
    touch('Windows/skip.jpg');
    touch('node_modules/skip.jpg');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, '').replace(/\\/g, '/'));
    }
    expect(seen).toEqual(['/keep/a.jpg']);
  });

  it('skips dot-prefixed directories', async () => {
    touch('.git/skip.jpg');
    touch('keep.jpg');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, '').replace(/\\/g, '/'));
    }
    expect(seen).toEqual(['/keep.jpg']);
  });

  it('reports size and mtime for emitted files', async () => {
    touch('a.jpg', 'hello');
    for await (const entry of walk({ ...opts, roots: [root] })) {
      expect(entry.sizeBytes).toBe(5);
      expect(typeof entry.mtime).toBe('string');
      expect(entry.extension).toBe('jpg');
    }
  });
});
