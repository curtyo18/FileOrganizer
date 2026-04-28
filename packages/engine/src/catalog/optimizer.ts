import type { Catalog } from './connection.js';

const KEY = 'lastOptimizedAt';
const INTERVAL_MS = 24 * 60 * 60 * 1000;

export class Optimizer {
  constructor(private readonly db: Catalog) {}

  shouldRun(): boolean {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as
      | { value: string }
      | undefined;
    if (!row) return true;
    const last = Date.parse(row.value);
    if (Number.isNaN(last)) return true;
    return Date.now() - last >= INTERVAL_MS;
  }

  runIfDue(): void {
    if (!this.shouldRun()) return;
    this.db.exec(`PRAGMA optimize`);
    this.db
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
      .run(KEY, new Date().toISOString());
  }

  startInterval(intervalMs: number = INTERVAL_MS): NodeJS.Timeout {
    const handle = setInterval(() => this.runIfDue(), intervalMs);
    if (typeof handle.unref === 'function') handle.unref();
    return handle;
  }
}
