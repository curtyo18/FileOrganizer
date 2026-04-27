import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { RulesRepo } from './repo.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-rules-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('RulesRepo', () => {
  it('lists rules ordered by ascending priority', () => {
    const repo = new RulesRepo(db);
    repo.create({
      name: 'low priority',
      priority: 200,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{year}/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });
    repo.create({
      name: 'high priority',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{year}/{filename}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });

    const list = repo.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('high priority');
    expect(list[0]!.priority).toBe(100);
    expect(list[1]!.priority).toBe(200);
  });

  it('round-trips match JSON, enabled flag, and policies', () => {
    const repo = new RulesRepo(db);
    const created = repo.create({
      name: 'old large videos',
      priority: 50,
      match: {
        category: ['video'],
        dateBefore: '2024-01-01',
        minSizeBytes: 10_000_000,
        pathGlob: '**/Downloads/**',
      },
      destinationRole: 'archive',
      destinationTemplate: 'Archive/{year}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'skip-quarantine',
    });

    const fetched = repo.findById(created.id)!;
    expect(fetched.enabled).toBe(true);
    expect(fetched.match.category).toEqual(['video']);
    expect(fetched.match.dateBefore).toBe('2024-01-01');
    expect(fetched.match.minSizeBytes).toBe(10_000_000);
    expect(fetched.match.pathGlob).toBe('**/Downloads/**');
    expect(fetched.movePolicy).toBe('cross-drive-review');
    expect(fetched.quarantinePolicy).toBe('skip-quarantine');
  });

  it('updates name, priority, and enabled flag', () => {
    const repo = new RulesRepo(db);
    const created = repo.create({
      name: 'original',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'photos',
      destinationTemplate: 'Photos/{year}',
      movePolicy: 'same-drive-auto',
      quarantinePolicy: 'default',
    });

    const updated = repo.update(created.id, {
      name: 'renamed',
      priority: 75,
      enabled: false,
    });

    expect(updated.name).toBe('renamed');
    expect(updated.priority).toBe(75);
    expect(updated.enabled).toBe(false);
    expect(repo.findById(created.id)!.name).toBe('renamed');
  });

  it('deletes a rule', () => {
    const repo = new RulesRepo(db);
    const r = repo.create({
      name: 'doomed',
      priority: 500,
      match: {},
      destinationRole: 'misc',
      destinationTemplate: '{filename}',
      movePolicy: 'always-review',
      quarantinePolicy: 'default',
    });

    repo.delete(r.id);
    expect(repo.findById(r.id)).toBeNull();
    expect(repo.list()).toHaveLength(0);
  });
});
