import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { Optimizer } from './optimizer.js';
import { SettingsRepo } from './settings-repo.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-opt-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('Optimizer', () => {
  it('runs PRAGMA optimize on first call and persists last-run timestamp', () => {
    const opt = new Optimizer(db);
    expect(opt.shouldRun()).toBe(true);
    opt.runIfDue();
    expect(opt.shouldRun()).toBe(false);
  });

  it('runs again after 24h elapsed', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      const opt = new Optimizer(db);
      opt.runIfDue();
      expect(opt.shouldRun()).toBe(false);
      vi.setSystemTime(new Date('2024-01-02T01:00:00Z'));
      expect(opt.shouldRun()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips PRAGMA when run twice within the interval', () => {
    const opt = new Optimizer(db);
    opt.runIfDue();

    const firstSettings = new SettingsRepo(db).load();
    const firstTs = firstSettings.lastOptimizedAt;

    opt.runIfDue();

    const secondSettings = new SettingsRepo(db).load();
    const secondTs = secondSettings.lastOptimizedAt;

    expect(secondTs).toBe(firstTs);
  });

  it('treats unparseable timestamps as overdue', () => {
    // Seed the settings blob with a bad lastOptimizedAt
    const repo = new SettingsRepo(db);
    const s = repo.load();
    s.lastOptimizedAt = 'not-a-date';
    repo.save(s);

    const opt = new Optimizer(db);
    expect(opt.shouldRun()).toBe(true);
  });

  it('shouldRun uses injected now() clock without fake timers', () => {
    // t0: long in the past — optimizer must think it's already overdue
    const past = new Date('2020-01-01T00:00:00Z').getTime();
    // t1: fixed "now" far enough after past to exceed the 24h interval
    const future = new Date('2020-01-03T00:00:00Z').getTime();

    const repo = new SettingsRepo(db);
    const s = repo.load();
    s.lastOptimizedAt = new Date(past).toISOString();
    repo.save(s);

    const opt = new Optimizer(db, { now: () => future });
    expect(opt.shouldRun()).toBe(true);

    // After running, shouldRun should return false at the same fixed clock
    opt.runIfDue();
    expect(opt.shouldRun()).toBe(false);
  });

  it('runIfDue writes lastOptimizedAt inside the Settings JSON blob, not as a separate row', () => {
    const opt = new Optimizer(db);
    opt.runIfDue();

    // The main 'settings' blob must contain lastOptimizedAt
    const raw = db.prepare(`SELECT value FROM settings WHERE key = 'settings'`).get() as {
      value: string;
    };
    const blob = JSON.parse(raw.value) as Record<string, unknown>;
    expect(typeof blob['lastOptimizedAt']).toBe('string');
    expect(Number.isNaN(Date.parse(blob['lastOptimizedAt'] as string))).toBe(false);

    // No separate row with key = 'lastOptimizedAt' should exist
    const legacyRow = db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get('lastOptimizedAt') as { value: string } | undefined;
    expect(legacyRow).toBeUndefined();
  });
});
