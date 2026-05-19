import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './index.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';

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

describe('CLI corrupt catalog', () => {
  it('init exits non-zero with CATALOG_CORRUPT in stderr when catalog is corrupted', async () => {
    const pointerPath = join(dir, 'pointer.json');
    const catalogPath = join(dir, 'cat.db');

    // Build a healthy catalog first so we have a valid migrated file to corrupt.
    const db = openCatalog(catalogPath);
    migrate(db);
    db.pragma('wal_checkpoint(TRUNCATE)');
    closeCatalog(db);

    // Corrupt the freelist trunk pointer (offset 32-35) to page 9999 — same
    // technique as the unit test: opens fine but integrity_check reports errors.
    const fd = openSync(catalogPath, 'r+');
    writeSync(fd, Buffer.from([0x00, 0x00, 0x27, 0x0f]), 0, 4, 32);
    closeSync(fd);

    const result = await runCli(['init', '--pointer', pointerPath, '--catalog', catalogPath]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CATALOG_CORRUPT');
    expect(result.stderr).toContain(catalogPath);
  });
});

describe('CLI scan', () => {
  it('runs a scan over a temp directory and reports indexed count', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'fileorg-cli-scan-'));
    try {
      const pointerPath = join(dir2, 'pointer.json');
      const catalogPath = join(dir2, 'cat.db');
      const dataDir = join(dir2, 'data');
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'a.jpg'), 'x');
      writeFileSync(join(dataDir, 'b.pdf'), 'y');
      await runCli(['init', '--pointer', pointerPath, '--catalog', catalogPath]);
      const r = await runCli([
        'scan',
        '--pointer', pointerPath,
        '--path', dataDir,
        '--profile', 'idle',
        '--mediainfo', '/no/such/binary',
      ]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('indexed=2');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
