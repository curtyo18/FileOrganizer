import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { SettingsRepo } from './settings-repo.js';
import { DEFAULT_CATEGORY_MAP, defaultThrottleProfiles } from '@fileorganizer/shared';
import { cpus } from 'node:os';

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

  it('falls back to defaults and emits warn when an older settings row has incomplete throttleProfiles', () => {
    // Pre-schema-validation rows with partial throttleProfiles are now treated as
    // invalid by the zod schema — the whole load() falls back to defaults.
    const cpuCount = cpus().length || 4;
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
    // Schema validation fails → defaults returned
    expect(s.userExcluded).toEqual([]);
    expect(s.throttleProfiles).toEqual(defaultThrottleProfiles(cpuCount));
    // individual user values from the bad row are NOT preserved — defaults win
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

  it('load() drops unknown keys that appear in the DB settings row (valid seed)', () => {
    // Seed the DB with a settings row that contains an unknown key alongside valid data.
    // The zod schema uses .strip() (default), so unknown keys are dropped from parsed output.
    const cpuCount = cpus().length || 4;
    const rowWithBogus = {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttleProfiles: defaultThrottleProfiles(cpuCount),
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

  it('load() + save() round-trip does not persist unknown keys (valid seed)', () => {
    // Seed with a fully valid throttleProfiles so schema validation passes, plus an extra key.
    const cpuCount = cpus().length || 4;
    const rowWithBogus = {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttleProfiles: defaultThrottleProfiles(cpuCount),
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

  it('load() returns defaults and emits warn log when throttleProfiles is malformed', () => {
    const malformed = {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttleProfiles: 'not-an-object',
      throttleSchedule: [],
      recentArchiveCutoffYears: 2,
      uiPort: 0,
      userExcluded: [],
    };
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      'settings',
      JSON.stringify(malformed),
    );

    const captured: string[] = [];
    const stderrAny = process.stderr as unknown as { write: (chunk: string) => boolean };
    const originalWrite = stderrAny.write.bind(process.stderr);
    stderrAny.write = (chunk: string) => {
      captured.push(chunk);
      return originalWrite(chunk);
    };

    let result: ReturnType<SettingsRepo['load']>;
    try {
      result = new SettingsRepo(db).load();
    } finally {
      stderrAny.write = originalWrite;
    }

    // Should return defaults
    const cpuCount = cpus().length || 4;
    expect(result!.throttleProfiles).toEqual(defaultThrottleProfiles(cpuCount));
    expect(result!.uiPort).toBe(0);

    // Should have emitted a warn log
    const allOutput = captured.join('');
    expect(allOutput).toContain('warn');
    expect(allOutput).toContain('settings-schema-invalid');
  });

  it('load() returns parsed data unchanged when the stored JSON is valid', () => {
    const cpuCount = cpus().length || 4;
    const valid = {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttleProfiles: defaultThrottleProfiles(cpuCount),
      throttleSchedule: [],
      recentArchiveCutoffYears: 7,
      uiPort: 4242,
      userExcluded: ['C:\\Temp'],
    };
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      'settings',
      JSON.stringify(valid),
    );

    const s = new SettingsRepo(db).load();
    expect(s.recentArchiveCutoffYears).toBe(7);
    expect(s.uiPort).toBe(4242);
    expect(s.userExcluded).toEqual(['C:\\Temp']);
  });
});
