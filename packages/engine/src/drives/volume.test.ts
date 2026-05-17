import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.mock must be hoisted before any imports that use the module.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual };
});

// Mock node:path so we can return a Windows-style absolute path from resolve()
// when testing detectWindows on Linux CI.
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return { ...actual };
});

import { detectVolume } from './volume.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as childProcess from 'node:child_process';
import * as nodePath from 'node:path';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectVolume', () => {
  it('returns shape with serial, capacity, free for a real path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-vol-'));
    try {
      const v = detectVolume(dir);
      expect(typeof v.volumeSerial).toBe('string');
      expect(v.volumeSerial.length).toBeGreaterThan(0);
      expect(v.totalBytes).toBeGreaterThan(0);
      expect(v.freeBytes).toBeGreaterThanOrEqual(0);
      expect(v.kind).toMatch(/local|external|network/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the same serial across calls for the same path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-vol-'));
    try {
      const a = detectVolume(dir);
      const b = detectVolume(dir);
      expect(a.volumeSerial).toBe(b.volumeSerial);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('detectWindows (via detectVolume on win32)', () => {
  it('happy path: uses volumeSerial returned by execFileSync (PowerShell)', () => {
    // detectWindows is only called on win32. We force process.platform, mock
    // resolve() to return a Windows-style path (so driveLetter is extracted),
    // and mock execFileSync to return canned PowerShell-style responses.
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    // Make resolve() echo back a Windows-style path so the drive-letter regex
    // /^([A-Za-z]):/ matches on Linux CI.
    vi.spyOn(nodePath, 'resolve').mockReturnValue('C:\\Photos');

    // execFileSync is called twice: once for UniqueId, once for DriveType.
    // The overload with { encoding } returns string; cast via unknown to satisfy
    // the overloaded mock type (which TypeScript resolves to the Buffer overload).
    const execSpy = vi
      .spyOn(childProcess, 'execFileSync')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockReturnValueOnce('\\\\?\\Volume{deadbeef-0000-0000-0000-000000000001}\\\n' as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockReturnValueOnce('Fixed\n' as any);

    try {
      const v = detectVolume('C:\\Photos');
      expect(v.volumeSerial).toBe('\\\\?\\Volume{deadbeef-0000-0000-0000-000000000001}\\');
      expect(v.kind).toBe('local');
      expect(execSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('fallback: when execFileSync throws, synthSerial is used instead', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    // Make resolve() return a Windows-style path so driveLetter is extracted
    // and execFileSync is actually attempted (then throws).
    vi.spyOn(nodePath, 'resolve').mockReturnValue('C:\\Photos');

    // Both execFileSync calls throw — serial falls back to synthSerial.
    vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw new Error('powershell.exe not found');
    });

    try {
      const v = detectVolume('C:\\Photos');
      // synthSerial always starts with 'synth-'
      expect(v.volumeSerial).toMatch(/^synth-/);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
