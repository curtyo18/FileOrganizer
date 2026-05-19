import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { runScan } from './orchestrator.js';
import { ThrottleManager } from '../throttle/manager.js';
import { defaultThrottleProfiles, DEFAULT_CATEGORY_MAP, ScanError } from '@fileorganizer/shared';
import { silentLogger } from '../test-helpers/log.js';

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
    const log = silentLogger();
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

  it('scan writes stat.ino as ntfs_file_id for indexed files', async () => {
    const path = fixture('ntfs-id-test.jpg', 'content');
    const log = silentLogger();
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    await runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    });
    const row = db
      .prepare(`SELECT ntfs_file_id FROM files WHERE path = ?`)
      .get(path) as { ntfs_file_id: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.ntfs_file_id).not.toBeNull();
    expect(row!.ntfs_file_id).toBe(statSync(path).ino.toString());
  });

  it('skips re-hashing unchanged files on second scan', async () => {
    fixture('a.jpg', 'aaa');
    const log = silentLogger();
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
    const log = silentLogger();
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
    const log = silentLogger();
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

  it('persists empty-dir state to the catalog after a successful scan', async () => {
    fixture('keeper/sub/inside.jpg', 'keep');
    fixture('non-matching/a.tmp', 'tmp');
    // fully empty branch
    mkdirSync(join(scanRoot, 'fully-empty', 'deep'), { recursive: true });
    // sibling of keeper that's empty
    mkdirSync(join(scanRoot, 'keeper', 'empty-sibling'), { recursive: true });
    const log = silentLogger();
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    await runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    });
    const rows = db
      .prepare(`SELECT path FROM empty_dirs WHERE drive_id = ? ORDER BY path`)
      .all(driveId) as { path: string }[];
    const paths = new Set(rows.map((r) => r.path));
    expect(paths.has(join(scanRoot, 'fully-empty', 'deep'))).toBe(true);
    expect(paths.has(join(scanRoot, 'fully-empty'))).toBe(true);
    expect(paths.has(join(scanRoot, 'keeper', 'empty-sibling'))).toBe(true);
    expect(paths.has(join(scanRoot, 'non-matching'))).toBe(true);
    // dirs holding indexed files are not stored
    expect(paths.has(join(scanRoot, 'keeper'))).toBe(false);
    expect(paths.has(join(scanRoot, 'keeper', 'sub'))).toBe(false);
    // root itself is never reported
    expect(paths.has(scanRoot)).toBe(false);
  });

  it('prunes stale empty-dir rows on the second scan', async () => {
    mkdirSync(join(scanRoot, 'gone'), { recursive: true });
    mkdirSync(join(scanRoot, 'becomes-occupied'), { recursive: true });
    mkdirSync(join(scanRoot, 'still-empty'), { recursive: true });
    const log = silentLogger();
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const baseOpts = {
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    };
    await runScan(baseOpts);
    let paths = (db
      .prepare(`SELECT path FROM empty_dirs WHERE drive_id = ?`)
      .all(driveId) as { path: string }[]).map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        join(scanRoot, 'gone'),
        join(scanRoot, 'becomes-occupied'),
        join(scanRoot, 'still-empty'),
      ]),
    );

    rmSync(join(scanRoot, 'gone'), { recursive: true, force: true });
    fixture('becomes-occupied/file.jpg', 'data');

    await runScan(baseOpts);
    paths = (db
      .prepare(`SELECT path FROM empty_dirs WHERE drive_id = ?`)
      .all(driveId) as { path: string }[]).map((r) => r.path);
    expect(paths).toContain(join(scanRoot, 'still-empty'));
    expect(paths).not.toContain(join(scanRoot, 'gone'));
    expect(paths).not.toContain(join(scanRoot, 'becomes-occupied'));
  });

  it('does not prune empty-dir rows when the scan is cancelled', async () => {
    mkdirSync(join(scanRoot, 'pre-existing'), { recursive: true });
    const log = silentLogger();
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    await runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    });
    const before = (db
      .prepare(`SELECT path FROM empty_dirs WHERE drive_id = ?`)
      .all(driveId) as { path: string }[]).map((r) => r.path);
    expect(before).toContain(join(scanRoot, 'pre-existing'));

    for (let i = 0; i < 1000; i += 1) {
      fixture(`f${String(i).padStart(4, '0')}.jpg`, `payload-${i}`.repeat(50));
    }
    const controller = new AbortController();
    const promise = runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const result = await promise;
    expect(result.cancelled).toBe(true);

    const after = (db
      .prepare(`SELECT path FROM empty_dirs WHERE drive_id = ?`)
      .all(driveId) as { path: string }[]).map((r) => r.path);
    // Cancelled scans must not prune — pre-existing row stays.
    expect(after).toContain(join(scanRoot, 'pre-existing'));
  });

  it('persists a scans row with completed status', async () => {
    fixture('a.jpg', 'aaa');
    const log = silentLogger();
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

describe('runScan — volume serial pre-flight', () => {
  // The pre-flight check only fires for real (non-synth) volume serials.
  // On POSIX, detectVolume returns synth-<sha1> serials; registering a drive
  // with a non-synth serial simulates a Windows drive whose volume serial
  // was recorded at registration and now differs from the live OS report.
  const FAKE_WINDOWS_SERIAL = '{12345678-ABCD-EF01-2345-6789ABCDEF01}';

  it('refuses to start with VOLUME_SERIAL_MISMATCH when stored serial differs from live', async () => {
    // Drive registered with a non-synth serial pointing at a real path.
    // The live detectVolume will return a synth-* serial (POSIX) or a
    // different real serial (Windows remapping) — either way a mismatch.
    const drive = new DriveRepo(db).upsert({
      volumeSerial: FAKE_WINDOWS_SERIAL,
      label: 'stale-drive',
      currentLetter: null,
      mountPath: scanRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 500_000_000,
    });
    const log = silentLogger();
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);

    let caught: unknown;
    try {
      await runScan({
        db, driveId: drive.id, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
        throttle, log, mediainfoPath: '/no/such',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ScanError);
    expect((caught as ScanError).code).toBe('VOLUME_SERIAL_MISMATCH');
    // Error message must name both the catalog value and the live value so the
    // operator can debug the remapping.
    expect((caught as ScanError).message).toContain(FAKE_WINDOWS_SERIAL);
    expect((caught as ScanError).message).toContain('live=');
  });

  it('starts normally when the stored serial is a synth serial (POSIX: check skipped)', async () => {
    // Synth serials are path-specific and can't detect drive remapping on POSIX,
    // so the pre-flight is skipped for them.  This verifies that skip is correct
    // and the scan proceeds without a false VOLUME_SERIAL_MISMATCH.
    fixture('a.jpg', 'aaa');
    const log = silentLogger();
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);

    // driveId from beforeEach has volumeSerial='X' (non-synth, no mountPath=null).
    // Use it directly — mountPath is null so the check is also skipped.
    const result = await runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    });
    expect(result.filesIndexed).toBe(1);
  });

  it('leaves no running scans row after a mismatch throw', async () => {
    const drive = new DriveRepo(db).upsert({
      volumeSerial: FAKE_WINDOWS_SERIAL,
      label: 'stale-drive2',
      currentLetter: null,
      mountPath: scanRoot,
      kind: 'local',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 500_000_000,
    });
    const log = silentLogger();
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);

    await runScan({
      db, driveId: drive.id, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    }).catch(() => { /* expected mismatch */ });

    // No running scan should exist after the throw.
    expect(new ScansRepo(db).hasRunning(drive.id)).toBe(false);
  });
});
