import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashFile } from './hasher.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-hash-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('hashFile', () => {
  it('computes the sha256 of a known input', async () => {
    const path = join(dir, 'a.bin');
    writeFileSync(path, 'hello world');
    const hash = await hashFile(path, { chunkBytes: 64, sleepMs: 0 });
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('handles empty files', async () => {
    const path = join(dir, 'empty.bin');
    writeFileSync(path, '');
    const hash = await hashFile(path, { chunkBytes: 64, sleepMs: 0 });
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('respects chunk size by producing same hash regardless of chunking', async () => {
    const path = join(dir, 'big.bin');
    writeFileSync(path, 'a'.repeat(10_000));
    const small = await hashFile(path, { chunkBytes: 100, sleepMs: 0 });
    const large = await hashFile(path, { chunkBytes: 10_000, sleepMs: 0 });
    expect(small).toBe(large);
  });
});
