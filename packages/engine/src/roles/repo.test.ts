import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DEFAULT_FILL_THRESHOLD_PERCENT } from '@fileorganizer/shared';
import { DriveRepo } from '../drives/repo.js';
import { RolesRepo } from './repo.js';

let dir: string;
let db: Catalog;
let d1: string;
let d2: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-roles-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  d1 = new DriveRepo(db).upsert({
    volumeSerial: 'V1',
    label: 'D1',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  }).id;
  d2 = new DriveRepo(db).upsert({
    volumeSerial: 'V2',
    label: 'D2',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  }).id;
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('RolesRepo', () => {
  it('creates a role with a drive priority list', () => {
    const repo = new RolesRepo(db);
    const role = repo.create({
      name: 'media-archive',
      drivePriority: [d1, d2],
      fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT,
    });
    expect(role.name).toBe('media-archive');
    expect(role.drivePriority).toEqual([d1, d2]);
    expect(role.fillThresholdPercent).toBe(DEFAULT_FILL_THRESHOLD_PERCENT);
  });

  it('lists roles in stable insertion order and finds by name', () => {
    const repo = new RolesRepo(db);
    repo.create({ name: 'a', drivePriority: [d1], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT });
    repo.create({ name: 'b', drivePriority: [d2], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT });
    expect(repo.list().map((r) => r.name)).toEqual(['a', 'b']);
    expect(repo.findByName('a')).not.toBeNull();
    expect(repo.findByName('missing')).toBeNull();
  });

  it('updates priority and threshold and persists', () => {
    const repo = new RolesRepo(db);
    repo.create({ name: 'r', drivePriority: [d1, d2], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT });
    repo.update('r', { drivePriority: [d2, d1], fillThresholdPercent: 80 });
    const r = repo.findByName('r')!;
    expect(r.drivePriority).toEqual([d2, d1]);
    expect(r.fillThresholdPercent).toBe(80);
  });

  it('rejects roles referencing unknown drive ids', () => {
    const repo = new RolesRepo(db);
    expect(() =>
      repo.create({ name: 'x', drivePriority: ['nope'], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT }),
    ).toThrow(/unknown drive/i);
  });

  it('rejects duplicate role names', () => {
    const repo = new RolesRepo(db);
    repo.create({ name: 'r', drivePriority: [d1], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT });
    expect(() =>
      repo.create({ name: 'r', drivePriority: [d2], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT }),
    ).toThrow(/exists/i);
  });

  it('throws when updating a role that does not exist', () => {
    const repo = new RolesRepo(db);
    expect(() => repo.update('ghost', { fillThresholdPercent: 50 })).toThrow(/not found/i);
  });

  it('deletes a role', () => {
    const repo = new RolesRepo(db);
    repo.create({ name: 'r', drivePriority: [d1], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT });
    repo.delete('r');
    expect(repo.findByName('r')).toBeNull();
  });

  it('allows roles with empty drive priority (drives may not be registered yet)', () => {
    const repo = new RolesRepo(db);
    const role = repo.create({ name: 'pending', drivePriority: [], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT });
    expect(role.drivePriority).toEqual([]);
  });
});
