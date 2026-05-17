import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { quarantineFile, restoreFromQuarantine } from './quarantine.js';
import { QuarantineError } from '@fileorganizer/shared';

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

  it('QUARANTINE_COLLISION: quarantining the same path twice in the same batch throws', () => {
    // quarantineFile checks existsSync(dest) before renaming. If we quarantine
    // file A into batch B, then write a new file at the original path and try
    // to quarantine it into the same batch B, the destination slot is already
    // occupied — triggering QUARANTINE_COLLISION.
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'dedupe', description: 'collision-test' });
    const src = join(driveRoot, 'collision.jpg');

    writeFileSync(src, 'contents');
    quarantineFile({
      db, batchId: batch.id, driveId, driveRoot,
      sourcePath: src, sha256: 'h1', sizeBytes: 8, mtime: '2024-01-01T00:00:00.000Z',
    });

    // Put a new file at the same source path so the second call doesn't fail on
    // "source missing" — only the dest collision should fire.
    writeFileSync(src, 'contents');

    let caughtErr: unknown;
    try {
      quarantineFile({
        db, batchId: batch.id, driveId, driveRoot,
        sourcePath: src, sha256: 'h1', sizeBytes: 8, mtime: '2024-01-01T00:00:00.000Z',
      });
    } catch (e) {
      caughtErr = e;
    }

    expect(caughtErr).toBeInstanceOf(QuarantineError);
    expect((caughtErr as QuarantineError).code).toBe('QUARANTINE_COLLISION');
  });

  it('QUARANTINE_NOT_FOUND: restoreFromQuarantine with unknown id throws typed error', () => {
    let caughtErr: unknown;
    try {
      restoreFromQuarantine({ db, driveRoot, quarantineId: 999999 });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(QuarantineError);
    expect((caughtErr as QuarantineError).code).toBe('QUARANTINE_NOT_FOUND');
    expect((caughtErr as QuarantineError).message).toMatch(/999999/);
  });

  it('QUARANTINE_FILE_MISSING: quarantine record exists but file gone from disk throws typed error', () => {
    const src = join(driveRoot, 'will-vanish.jpg');
    writeFileSync(src, 'data');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'dedupe', description: 'missing-test' });
    const result = quarantineFile({
      db, batchId: batch.id, driveId, driveRoot,
      sourcePath: src, sha256: 'hx', sizeBytes: 4, mtime: '2024-01-01T00:00:00.000Z',
    });

    // Simulate the quarantined file disappearing from disk (e.g., external deletion).
    unlinkSync(result.quarantinePath);

    let caughtErr: unknown;
    try {
      restoreFromQuarantine({ db, driveRoot, quarantineId: result.quarantineId });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(QuarantineError);
    expect((caughtErr as QuarantineError).code).toBe('QUARANTINE_FILE_MISSING');
  });
});
