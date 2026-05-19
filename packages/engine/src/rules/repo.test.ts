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

  it('populates created_at on insert (does not rely on the migration default)', () => {
    // Regression for the Windows-only failure where migration 0007's
    // DEFAULT CURRENT_TIMESTAMP was rejected by stricter SQLite builds.
    // The current contract is: RulesRepo.create() always supplies a real
    // timestamp explicitly, so the row's created_at is never the empty
    // placeholder left by the migration's constant default.
    const repo = new RulesRepo(db);
    const before = Date.now();
    const rule = repo.create({
      name: 'has timestamp',
      priority: 100,
      match: {},
      destinationRole: 'misc',
      destinationTemplate: '{filename}',
      movePolicy: 'always-review',
      quarantinePolicy: 'default',
    });
    const after = Date.now();

    const row = db
      .prepare(`SELECT created_at FROM rules WHERE id = ?`)
      .get(rule.id) as { created_at: string };
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const insertedAt = Date.parse(row.created_at);
    expect(insertedAt).toBeGreaterThanOrEqual(before);
    expect(insertedAt).toBeLessThanOrEqual(after);
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

  it('equal-priority rules ordered by created_at ASC then name ASC', () => {
    const repo = new RulesRepo(db);
    // Insert with explicit delays to ensure distinct created_at values aren't needed —
    // we rely on the name tiebreaker since SQLite CURRENT_TIMESTAMP is second-precision.
    // Insert three rules at the same priority; the DB assigns created_at via DEFAULT.
    // To make created_at ordering deterministic without sleeping, we insert them and
    // rely on name tiebreaker (rowid order can differ from alphabetical).
    repo.create({
      name: 'charlie',
      priority: 100,
      match: {},
      destinationRole: 'misc',
      destinationTemplate: '{filename}',
      movePolicy: 'always-review',
      quarantinePolicy: 'default',
    });
    repo.create({
      name: 'alpha',
      priority: 100,
      match: {},
      destinationRole: 'misc',
      destinationTemplate: '{filename}',
      movePolicy: 'always-review',
      quarantinePolicy: 'default',
    });
    repo.create({
      name: 'bravo',
      priority: 100,
      match: {},
      destinationRole: 'misc',
      destinationTemplate: '{filename}',
      movePolicy: 'always-review',
      quarantinePolicy: 'default',
    });

    const list = repo.list();
    expect(list).toHaveLength(3);
    // All same priority and same created_at second → name tiebreaker applies
    expect(list[0]!.name).toBe('alpha');
    expect(list[1]!.name).toBe('bravo');
    expect(list[2]!.name).toBe('charlie');
  });
});
