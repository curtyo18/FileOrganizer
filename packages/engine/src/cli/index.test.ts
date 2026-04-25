import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './index.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI', () => {
  it('init creates pointer file and catalog db', async () => {
    const pointerPath = join(dir, 'pointer.json');
    const catalogPath = join(dir, 'cat.db');
    const result = await runCli(['init', '--pointer', pointerPath, '--catalog', catalogPath]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(pointerPath)).toBe(true);
    expect(existsSync(catalogPath)).toBe(true);
  });

  it('status prints registered drives', async () => {
    const pointerPath = join(dir, 'pointer.json');
    const catalogPath = join(dir, 'cat.db');
    await runCli(['init', '--pointer', pointerPath, '--catalog', catalogPath]);
    const result = await runCli(['status', '--pointer', pointerPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Drives: 0');
  });

  it('exits 2 on unknown command', async () => {
    const result = await runCli(['nope']);
    expect(result.exitCode).toBe(2);
  });
});
