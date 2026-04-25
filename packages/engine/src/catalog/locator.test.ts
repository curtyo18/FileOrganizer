import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPointer, writePointer, type CatalogPointer } from './locator.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('catalog locator', () => {
  it('returns null when pointer file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-loc-'));
    tmpDirs.push(dir);
    expect(readPointer(join(dir, 'pointer.json'))).toBeNull();
  });

  it('round-trips a pointer through write and read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-loc-'));
    tmpDirs.push(dir);
    const path = join(dir, 'pointer.json');
    const ptr: CatalogPointer = { catalogPath: '/tmp/cat.db', uiPort: 4242 };
    writePointer(path, ptr);
    expect(existsSync(path)).toBe(true);
    expect(readPointer(path)).toEqual(ptr);
  });

  it('rejects malformed pointer files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-loc-'));
    tmpDirs.push(dir);
    const path = join(dir, 'pointer.json');
    writeFileSync(path, 'not json');
    expect(() => readPointer(path)).toThrow();
  });
});
