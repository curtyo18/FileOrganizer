import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { quarantineFile, restoreFromQuarantine } from './quarantine.js';

let dir: string;
let db: Catalog;
let driveId: string;
let driveRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-q-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  driveRoot = join(dir, 'drive');
  mkdirSync(driveRoot, { recursive: true });
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
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('quarantineFile', () => {
  it('moves file into _FileOrganizer_quarantine and records metadata', () => {
    const src = join(driveRoot, 'sub', 'a.jpg');
    mkdirSync(join(src, '..'), { recursive: true });
    writeFileSync(src, 'x');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'dedupe', description: 't' });
    const result = quarantineFile({
      db,
      batchId: batch.id,
      driveId,
      driveRoot,
      sourcePath: src,
      sha256: 'hashx',
      sizeBytes: 1,
      mtime: '2024-01-01T00:00:00.000Z',
    });
    expect(existsSync(src)).toBe(false);
    expect(existsSync(result.quarantinePath)).toBe(true);
    expect(result.quarantinePath).toContain('_FileOrganizer_quarantine');
    expect(result.quarantinePath).toContain(batch.id);
  });

  it('restoreFromQuarantine puts the file back', () => {
    const src = join(driveRoot, 'sub', 'a.jpg');
    mkdirSync(join(src, '..'), { recursive: true });
    writeFileSync(src, 'x');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'dedupe', description: 't' });
    const result = quarantineFile({
      db,
      batchId: batch.id,
      driveId,
      driveRoot,
      sourcePath: src,
      sha256: 'hashx',
      sizeBytes: 1,
      mtime: '2024-01-01T00:00:00.000Z',
    });
    restoreFromQuarantine({ db, driveRoot, quarantineId: result.quarantineId });
    expect(existsSync(src)).toBe(true);
    expect(existsSync(result.quarantinePath)).toBe(false);
    expect(readFileSync(src, 'utf-8')).toBe('x');
  });

  it('refuses to quarantine a file outside the drive root', () => {
    const outside = join(dir, 'outside.jpg');
    writeFileSync(outside, 'y');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'dedupe', description: 't' });
    expect(() =>
      quarantineFile({
        db,
        batchId: batch.id,
        driveId,
        driveRoot,
        sourcePath: outside,
        sha256: 'h',
        sizeBytes: 1,
        mtime: '2024-01-01T00:00:00.000Z',
      }),
    ).toThrow(/not under drive root/);
  });

  it('refuses to restore when destination already exists', () => {
    const src = join(driveRoot, 'a.jpg');
    writeFileSync(src, 'x');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'dedupe', description: 't' });
    const result = quarantineFile({
      db,
      batchId: batch.id,
      driveId,
      driveRoot,
      sourcePath: src,
      sha256: 'h',
      sizeBytes: 1,
      mtime: '2024-01-01T00:00:00.000Z',
    });
    writeFileSync(src, 'something else');
    expect(() => restoreFromQuarantine({ db, driveRoot, quarantineId: result.quarantineId })).toThrow(
      /file exists at original path/,
    );
  });
});
