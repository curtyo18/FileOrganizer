import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { Optimizer } from './optimizer.js';

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
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('lastOptimizedAt') as
      | { value: string }
      | undefined;
    expect(row).toBeDefined();
    expect(Number.isNaN(Date.parse(row!.value))).toBe(false);
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
    const first = db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get('lastOptimizedAt') as { value: string };
    opt.runIfDue();
    const second = db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get('lastOptimizedAt') as { value: string };
    expect(second.value).toBe(first.value);
  });

  it('treats unparseable timestamps as overdue', () => {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      'lastOptimizedAt',
      'not-a-date',
    );
    const opt = new Optimizer(db);
    expect(opt.shouldRun()).toBe(true);
  });
});
