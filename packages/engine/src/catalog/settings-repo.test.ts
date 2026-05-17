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
    expect(s.userExcluded).toEqual([]);
  });

  it('backfills userExcluded when an older settings row is missing the field', () => {
    const oldShape = {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttleProfiles: { idle: { name: 'idle' } },
      throttleSchedule: [],
      recentArchiveCutoffYears: 5,
      uiPort: 9999,
    };
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      'settings',
      JSON.stringify(oldShape),
    );
    const s = new SettingsRepo(db).load();
    expect(s.userExcluded).toEqual([]);
    expect(s.recentArchiveCutoffYears).toBe(5);
    expect(s.uiPort).toBe(9999);
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

  it('load() drops unknown keys that appear in the DB settings row', () => {
    // Seed the DB with a settings row that contains an unknown key
    const rowWithBogus = {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttleProfiles: {},
      throttleSchedule: [],
      recentArchiveCutoffYears: 2,
      uiPort: 0,
      userExcluded: [],
      bogusField: 'should-be-dropped',
    };
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      'settings',
      JSON.stringify(rowWithBogus),
    );

    const s = new SettingsRepo(db).load();
    // The returned object must not contain the unknown key
    expect((s as unknown as Record<string, unknown>)['bogusField']).toBeUndefined();
  });

  it('load() + save() round-trip does not persist unknown keys', () => {
    // Seed with an unknown key
    const rowWithBogus = {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttleProfiles: {},
      throttleSchedule: [],
      recentArchiveCutoffYears: 2,
      uiPort: 7777,
      userExcluded: [],
      anotherBogusKey: 42,
    };
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      'settings',
      JSON.stringify(rowWithBogus),
    );

    const repo = new SettingsRepo(db);
    const loaded = repo.load();
    // Save immediately (round-trip)
    repo.save(loaded);

    // Read raw JSON from DB and confirm unknown key is gone
    const raw = db.prepare(`SELECT value FROM settings WHERE key = 'settings'`).get() as {
      value: string;
    };
    const persisted = JSON.parse(raw.value) as Record<string, unknown>;
    expect(persisted['anotherBogusKey']).toBeUndefined();
    // Known key must still be present
    expect(persisted['uiPort']).toBe(7777);
  });
});
