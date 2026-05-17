import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPointer, writePointer, defaultPointerPath, defaultCatalogPath, type CatalogPointer } from './locator.js';

const tmpDirs: string[] = [];

// Track original env values so we can restore them after each test.
let savedAppData: string | undefined;
let savedHome: string | undefined;

beforeEach(() => {
  savedAppData = process.env['APPDATA'];
  savedHome = process.env['HOME'];
});

afterEach(() => {
  // Restore env vars unconditionally to avoid cross-test pollution.
  if (savedAppData === undefined) {
    delete process.env['APPDATA'];
  } else {
    process.env['APPDATA'] = savedAppData;
  }
  if (savedHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = savedHome;
  }
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

describe('defaultPointerPath / defaultCatalogPath', () => {
  it('uses APPDATA when set', () => {
    const fakeAppData = mkdtempSync(join(tmpdir(), 'fileorg-appdata-'));
    tmpDirs.push(fakeAppData);
    process.env['APPDATA'] = fakeAppData;
    delete process.env['HOME']; // ensure POSIX branch is not taken

    const ptr = defaultPointerPath();
    const cat = defaultCatalogPath();

    expect(ptr.startsWith(fakeAppData)).toBe(true);
    expect(ptr).toContain('FileOrganizer');
    expect(cat.startsWith(fakeAppData)).toBe(true);
    expect(cat).toContain('FileOrganizer');
  });

  it('falls back to HOME/.fileorganizer when APPDATA is unset', () => {
    delete process.env['APPDATA'];
    const fakeHome = mkdtempSync(join(tmpdir(), 'fileorg-home-'));
    tmpDirs.push(fakeHome);
    process.env['HOME'] = fakeHome;

    const ptr = defaultPointerPath();
    const cat = defaultCatalogPath();

    expect(ptr.startsWith(fakeHome)).toBe(true);
    expect(ptr).toContain('.fileorganizer');
    expect(cat.startsWith(fakeHome)).toBe(true);
    expect(cat).toContain('.fileorganizer');
  });
});
