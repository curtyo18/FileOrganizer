import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveCollision } from './collision.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-collision-'));
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function shaOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('resolveCollision', () => {
  it('returns use-as-is when destination does not exist', async () => {
    const dest = resolve(dir, 'a.jpg');
    const out = await resolveCollision(dest, shaOf('source'), 64 * 1024);
    expect(out.kind).toBe('use-as-is');
    expect(out.path).toBe(dest);
  });

  it('returns same-content when destination has the same hash as the source', async () => {
    const dest = resolve(dir, 'a.jpg');
    writeFileSync(dest, 'shared content');
    const out = await resolveCollision(dest, shaOf('shared content'), 64 * 1024);
    expect(out.kind).toBe('same-content');
    expect(out.path).toBe(dest);
  });

  it('suffixes with _1 when destination has different content', async () => {
    const dest = resolve(dir, 'a.jpg');
    writeFileSync(dest, 'existing');
    const out = await resolveCollision(dest, shaOf('source'), 64 * 1024);
    expect(out.kind).toBe('suffix');
    expect(out.path).toBe(resolve(dir, 'a_1.jpg'));
  });

  it('walks _2, _3 etc. when earlier suffixed names also exist', async () => {
    writeFileSync(resolve(dir, 'a.jpg'), 'one');
    writeFileSync(resolve(dir, 'a_1.jpg'), 'two');
    writeFileSync(resolve(dir, 'a_2.jpg'), 'three');
    const out = await resolveCollision(
      resolve(dir, 'a.jpg'),
      shaOf('source'),
      64 * 1024,
    );
    expect(out.kind).toBe('suffix');
    expect(out.path).toBe(resolve(dir, 'a_3.jpg'));
  });
});
