import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo, toFileRecord, type UpsertFileInput } from './files-repo.js';

let dir: string;
let db: Catalog;
let driveId: string;
let scanId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-files-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  const drive = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  });
  driveId = drive.id;
  scanId = 'test-scan-1';
  db.prepare(
    `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
  ).run(scanId, driveId, new Date().toISOString(), 'running', 'balanced');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function input(path: string, sha: string, mtime: string): UpsertFileInput {
  return {
    driveId,
    path,
    name: path.split('/').pop()!,
    extension: 'jpg',
    sizeBytes: 100,
    category: 'image',
    sha256: sha,
    mtime,
    ctime: mtime,
    exifDate: null,
    dateSource: 'mtime',
    width: null,
    height: null,
    durationSeconds: null,
    ntfsFileId: null,
    state: 'indexed',
    scanId,
  };
}

describe('FilesRepo', () => {
  it('upsertOne inserts a new file', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const row = repo.findByPath(driveId, '/a.jpg');
    expect(row).not.toBeNull();
    expect(row!.sha256).toBe('h1');
  });

  it('upsertOne replaces on (drive,path) collision', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    repo.upsertOne(input('/a.jpg', 'h2', '2024-02-01T00:00:00.000Z'));
    const row = repo.findByPath(driveId, '/a.jpg');
    expect(row!.sha256).toBe('h2');
  });

  it('quickCheck returns "skip" for unchanged file', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const r = repo.quickCheck(driveId, '/a.jpg', 100, '2024-01-01T00:00:00.000Z');
    expect(r.kind).toBe('skip');
  });

  it('quickCheck returns "rehash" when size or mtime differs', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    expect(repo.quickCheck(driveId, '/a.jpg', 200, '2024-01-01T00:00:00.000Z').kind).toBe('rehash');
    expect(repo.quickCheck(driveId, '/a.jpg', 100, '2024-02-01T00:00:00.000Z').kind).toBe('rehash');
  });

  it('quickCheck returns "new" for unknown path', () => {
    const repo = new FilesRepo(db);
    expect(repo.quickCheck(driveId, '/x.jpg', 1, '2024-01-01T00:00:00.000Z').kind).toBe('new');
  });

  it('markMissing flips state for files not seen in current scan within roots', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/x/a/foo.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');
    repo.markMissing(driveId, newScanId, ['/x/a']);
    const row = repo.findByPath(driveId, '/x/a/foo.jpg');
    expect(row!.state).toBe('missing');
  });

  it('markMissing leaves files outside the scanned roots untouched', () => {
    const repo = new FilesRepo(db);
    // Indexed by an earlier scan on /x/a
    repo.upsertOne({
      ...input('/x/a/foo.jpg', 'h1', '2024-01-01T00:00:00.000Z'),
      scanId,
    });
    // Now run a scan rooted at /x/b (different scan id)
    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');
    repo.markMissing(driveId, newScanId, ['/x/b']);
    const row = repo.findByPath(driveId, '/x/a/foo.jpg');
    expect(row!.state).toBe('indexed');
  });

  it('markMissing only flips files removed between two scans of the same root', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/x/a/keep.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    repo.upsertOne(input('/x/a/gone.jpg', 'h2', '2024-01-01T00:00:00.000Z'));
    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');
    // Re-see only the keep file under the same scan
    repo.upsertOne({ ...input('/x/a/keep.jpg', 'h1', '2024-01-01T00:00:00.000Z'), scanId: newScanId });
    repo.markMissing(driveId, newScanId, ['/x/a']);
    expect(repo.findByPath(driveId, '/x/a/keep.jpg')!.state).toBe('indexed');
    expect(repo.findByPath(driveId, '/x/a/gone.jpg')!.state).toBe('missing');
  });

  it('markMissing with empty scanRoots is a no-op', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/x/a/foo.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');
    const changes = repo.markMissing(driveId, newScanId, []);
    expect(changes).toBe(0);
    expect(repo.findByPath(driveId, '/x/a/foo.jpg')!.state).toBe('indexed');
  });

  it('markMissing path-prefix does not match sibling roots with shared prefix', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/x/foobar/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');
    repo.markMissing(driveId, newScanId, ['/x/foo']);
    expect(repo.findByPath(driveId, '/x/foobar/a.jpg')!.state).toBe('indexed');
  });

  it('markMissing does not match sibling paths when scan root contains literal %', () => {
    // /scan-root%/photo01.jpg would match /scan-root%1.jpg via unescaped LIKE
    const repo = new FilesRepo(db);
    // Target: file UNDER the scan root (contains %)
    repo.upsertOne(input('/scan-root%/photo%1.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    // Sibling: same prefix but NOT under the scan root
    repo.upsertOne(input('/scan-root-other/photo%1.jpg', 'h2', '2024-01-01T00:00:00.000Z'));
    // Plain file in sibling without wildcard chars - should also NOT be matched
    repo.upsertOne(input('/scan-root-other/photo01.jpg', 'h3', '2024-01-01T00:00:00.000Z'));

    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');

    // Only mark missing for /scan-root% (i.e. none of the files re-appear in new scan)
    repo.markMissing(driveId, newScanId, ['/scan-root%']);

    // The file under /scan-root% should be marked missing
    expect(repo.findByPath(driveId, '/scan-root%/photo%1.jpg')!.state).toBe('missing');
    // Siblings under /scan-root-other must NOT be marked missing
    expect(repo.findByPath(driveId, '/scan-root-other/photo%1.jpg')!.state).toBe('indexed');
    expect(repo.findByPath(driveId, '/scan-root-other/photo01.jpg')!.state).toBe('indexed');
  });

  it('markMissing does not match sibling paths when scan root contains literal _', () => {
    // /scan-root_a/photo_a.jpg is under the root; /scan-root-other/photoxa.jpg should NOT match
    const repo = new FilesRepo(db);
    // File UNDER the scan root (contains _)
    repo.upsertOne(input('/scan-root_a/photo_a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    // Sibling: different root that would match if _ were treated as LIKE wildcard
    repo.upsertOne(input('/scan-root-other/photoxa.jpg', 'h2', '2024-01-01T00:00:00.000Z'));

    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');

    repo.markMissing(driveId, newScanId, ['/scan-root_a']);

    // File under /scan-root_a marked missing (not re-seen in new scan)
    expect(repo.findByPath(driveId, '/scan-root_a/photo_a.jpg')!.state).toBe('missing');
    // File under /scan-root-other must NOT be matched via _ wildcard
    expect(repo.findByPath(driveId, '/scan-root-other/photoxa.jpg')!.state).toBe('indexed');
  });
});

describe('toFileRecord', () => {
  it('maps all 19 fields from a sqlite row, coercing nullables to null', () => {
    // Full row with all non-null values
    const row: Record<string, unknown> = {
      id: 42,
      drive_id: 'drive-1',
      path: '/photos/img.jpg',
      name: 'img.jpg',
      extension: 'jpg',
      size_bytes: 1024,
      category: 'image',
      sha256: 'abc123',
      mtime: '2024-03-01T00:00:00.000Z',
      ctime: '2024-03-01T00:00:00.000Z',
      exif_date: '2024-02-15T10:00:00.000Z',
      date_source: 'exif',
      width: 1920,
      height: 1080,
      duration_seconds: 30.5,
      ntfs_file_id: 'ntfs-id-1',
      state: 'indexed',
      last_verified_at: '2024-03-01T12:00:00.000Z',
      scan_id: 'scan-abc',
    };

    const rec = toFileRecord(row);

    expect(rec.id).toBe(42);
    expect(rec.driveId).toBe('drive-1');
    expect(rec.path).toBe('/photos/img.jpg');
    expect(rec.name).toBe('img.jpg');
    expect(rec.extension).toBe('jpg');
    expect(rec.sizeBytes).toBe(1024);
    expect(rec.category).toBe('image');
    expect(rec.sha256).toBe('abc123');
    expect(rec.mtime).toBe('2024-03-01T00:00:00.000Z');
    expect(rec.ctime).toBe('2024-03-01T00:00:00.000Z');
    expect(rec.exifDate).toBe('2024-02-15T10:00:00.000Z');
    expect(rec.dateSource).toBe('exif');
    expect(rec.width).toBe(1920);
    expect(rec.height).toBe(1080);
    expect(rec.durationSeconds).toBe(30.5);
    expect(rec.ntfsFileId).toBe('ntfs-id-1');
    expect(rec.state).toBe('indexed');
    expect(rec.lastVerifiedAt).toBe('2024-03-01T12:00:00.000Z');
    expect(rec.scanId).toBe('scan-abc');
  });

  it('coerces nullable fields to null when the row has null values', () => {
    const row: Record<string, unknown> = {
      id: 1,
      drive_id: 'd',
      path: '/f.mp4',
      name: 'f.mp4',
      extension: 'mp4',
      size_bytes: 500,
      category: 'video',
      sha256: 'def456',
      mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z',
      exif_date: null,
      date_source: 'mtime',
      width: null,
      height: null,
      duration_seconds: null,
      ntfs_file_id: null,
      state: 'indexed',
      last_verified_at: '2024-01-01T00:00:00.000Z',
      scan_id: 'scan-xyz',
    };

    const rec = toFileRecord(row);

    expect(rec.exifDate).toBeNull();
    expect(rec.width).toBeNull();
    expect(rec.height).toBeNull();
    expect(rec.durationSeconds).toBeNull();
    expect(rec.ntfsFileId).toBeNull();
  });
});
