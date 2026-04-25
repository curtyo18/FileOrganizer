import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from './repo.js';

let dir: string;
let db: Catalog;
let repo: DriveRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-drives-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  repo = new DriveRepo(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('DriveRepo', () => {
  it('upserts a new drive and assigns id', () => {
    const drive = repo.upsert({
      volumeSerial: 'AAAA-BBBB',
      label: 'SSD-Active',
      currentLetter: 'D:',
      kind: 'local',
      roles: ['active-documents'],
      totalBytes: 1_000_000_000,
      freeBytes: 500_000_000,
    });
    expect(drive.id).toBeTruthy();
    expect(drive.volumeSerial).toBe('AAAA-BBBB');
    expect(drive.roles).toEqual(['active-documents']);
  });

  it('updates an existing drive on second upsert with same serial', () => {
    const a = repo.upsert({
      volumeSerial: 'AAAA-BBBB',
      label: 'SSD-Active',
      currentLetter: 'D:',
      kind: 'local',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 500_000_000,
    });
    const b = repo.upsert({
      volumeSerial: 'AAAA-BBBB',
      label: 'SSD-Active-Renamed',
      currentLetter: 'E:',
      kind: 'local',
      roles: ['x'],
      totalBytes: 1_000_000_000,
      freeBytes: 400_000_000,
    });
    expect(b.id).toBe(a.id);
    expect(b.label).toBe('SSD-Active-Renamed');
    expect(b.currentLetter).toBe('E:');
    expect(b.freeBytes).toBe(400_000_000);
    expect(b.roles).toEqual(['x']);
    expect(repo.list()).toHaveLength(1);
  });

  it('lists drives ordered by label', () => {
    repo.upsert({ volumeSerial: 'B', label: 'Beta', currentLetter: null, kind: 'local', roles: [], totalBytes: 1, freeBytes: 1 });
    repo.upsert({ volumeSerial: 'A', label: 'Alpha', currentLetter: null, kind: 'local', roles: [], totalBytes: 1, freeBytes: 1 });
    const drives = repo.list();
    expect(drives.map((d) => d.label)).toEqual(['Alpha', 'Beta']);
  });
});
