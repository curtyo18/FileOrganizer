import { describe, it, expect } from 'vitest';
import { detectVolume } from './volume.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
