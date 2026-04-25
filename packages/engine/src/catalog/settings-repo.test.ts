import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { SettingsRepo } from './settings-repo.js';
import { DEFAULT_CATEGORY_MAP } from '@fileorganizer/shared';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-settings-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsRepo', () => {
  it('initialises with defaults on first call', () => {
    const repo = new SettingsRepo(db);
    const s = repo.load();
    expect(s.categoryMap).toEqual(DEFAULT_CATEGORY_MAP);
    expect(s.recentArchiveCutoffYears).toBe(2);
    expect(s.uiPort).toBe(0);
  });

  it('persists changes', () => {
    const repo = new SettingsRepo(db);
    const s = repo.load();
    s.uiPort = 12345;
    s.recentArchiveCutoffYears = 3;
    repo.save(s);
    const reloaded = new SettingsRepo(db).load();
    expect(reloaded.uiPort).toBe(12345);
    expect(reloaded.recentArchiveCutoffYears).toBe(3);
  });
});
