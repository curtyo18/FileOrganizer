import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { RolesRepo } from './repo.js';
import { DEFAULT_ROLE_NAMES, seedDefaultRoles } from './defaults.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-roles-defaults-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('seedDefaultRoles', () => {
  it('seeds the default roles into an empty catalog', () => {
    const inserted = seedDefaultRoles(db);
    expect(inserted).toBe(DEFAULT_ROLE_NAMES.length);
    const names = new RolesRepo(db).list().map((r) => r.name);
    for (const expected of DEFAULT_ROLE_NAMES) {
      expect(names).toContain(expected);
    }
  });

  it('is idempotent — second call inserts nothing', () => {
    seedDefaultRoles(db);
    const inserted = seedDefaultRoles(db);
    expect(inserted).toBe(0);
    const list = new RolesRepo(db).list();
    expect(list.length).toBe(DEFAULT_ROLE_NAMES.length);
  });

  it('seeds with empty drivePriority and a 90% fill threshold', () => {
    seedDefaultRoles(db);
    for (const r of new RolesRepo(db).list()) {
      expect(r.drivePriority).toEqual([]);
      expect(r.fillThresholdPercent).toBe(90);
    }
  });
});
