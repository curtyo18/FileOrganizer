import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { runScan } from './orchestrator.js';
import { ThrottleManager } from '../throttle/manager.js';
import { defaultThrottleProfiles, DEFAULT_CATEGORY_MAP } from '@fileorganizer/shared';
import { createLogger } from '../log.js';

let dir: string;
let db: Catalog;
let driveId: string;
let scanRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-orch-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  scanRoot = join(dir, 'data');
  mkdirSync(scanRoot, { recursive: true });
  const drive = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1_000_000_000,
    freeBytes: 500_000_000,
  });
  driveId = drive.id;
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function fixture(rel: string, body: string): string {
  const path = join(scanRoot, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  return path;
}

describe('runScan', () => {
  it('indexes new files and assigns categories', async () => {
    fixture('a.jpg', 'aaa');
    fixture('b.pdf', 'bbb');
    fixture('skip.exe', 'xxx');
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const result = await runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    });
    expect(result.filesIndexed).toBe(2);
    // .exe is filtered by the walker via the category-map allowlist, so it
    // never reaches the orchestrator's filesSkipped counter. filesSkipped
    // counts files emitted by the walker whose category lookup later fails
    // (e.g., if the category map was mutated mid-scan).
    expect(result.filesSkipped).toBe(0);
    const files = new FilesRepo(db);
    expect(files.findByPath(driveId, join(scanRoot, 'a.jpg'))?.category).toBe('image');
    expect(files.findByPath(driveId, join(scanRoot, 'b.pdf'))?.category).toBe('document');
  });

  it('skips re-hashing unchanged files on second scan', async () => {
    fixture('a.jpg', 'aaa');
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const opts = {
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    };
    await runScan(opts);
    const second = await runScan(opts);
    expect(second.filesIndexed).toBe(0);
    expect(second.filesUnchanged).toBe(1);
  });

  it('marks files missing on rescan when they disappeared', async () => {
    const a = fixture('a.jpg', 'aaa');
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const opts = {
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    };
    await runScan(opts);
    rmSync(a);
    await runScan(opts);
    const files = new FilesRepo(db);
    expect(files.findByPath(driveId, a)?.state).toBe('missing');
  });

  it('finalizes the scan as cancelled when the abort signal fires mid-walk', async () => {
    for (let i = 0; i < 1000; i += 1) {
      fixture(`f${String(i).padStart(4, '0')}.jpg`, `payload-${i}`.repeat(50));
    }
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const controller = new AbortController();
    const promise = runScan({
      db,
      driveId,
      roots: [scanRoot],
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttle,
      log,
      mediainfoPath: '/no/such',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(result.filesIndexed).toBeGreaterThan(0);
    expect(result.filesIndexed).toBeLessThan(1000);
    const scan = new ScansRepo(db).findById(result.scanId);
    expect(scan!.status).toBe('cancelled');
  });

  it('persists a scans row with completed status', async () => {
    fixture('a.jpg', 'aaa');
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const result = await runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    });
    const scan = new ScansRepo(db).findById(result.scanId);
    expect(scan!.status).toBe('completed');
    expect(scan!.progress.filesIndexed).toBe(1);
  });
});
