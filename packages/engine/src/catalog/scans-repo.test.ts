import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { ScansRepo } from './scans-repo.js';

let dir: string;
let db: Catalog;
let driveId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-scans-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  const d = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  });
  driveId = d.id;
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('ScansRepo', () => {
  it('starts a scan and stores it as running', () => {
    const repo = new ScansRepo(db);
    const scan = repo.start({
      driveId,
      rootPaths: ['/foo'],
      throttleProfile: 'balanced',
    });
    expect(scan.id).toBeTruthy();
    expect(scan.status).toBe('running');
  });

  it('updates progress and finishes a scan', () => {
    const repo = new ScansRepo(db);
    const scan = repo.start({ driveId, rootPaths: ['/foo'], throttleProfile: 'balanced' });
    repo.updateProgress(scan.id, {
      lastCompletedDirectory: '/foo/bar',
      filesSeen: 10,
      filesIndexed: 8,
      filesSkipped: 2,
      bytesProcessed: 1024,
    });
    repo.finish(scan.id, 'completed', { errors: 0 });
    const reloaded = repo.findById(scan.id);
    expect(reloaded!.status).toBe('completed');
    expect(reloaded!.progress.filesIndexed).toBe(8);
    expect(reloaded!.stats.errors).toBe(0);
  });
});
