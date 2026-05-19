import type { Catalog } from './connection.js';
import { SettingsRepo } from './settings-repo.js';

const INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface OptimizerOptions {
  now?: () => number;
}

export class Optimizer {
  private readonly now: () => number;

  constructor(
    private readonly db: Catalog,
    opts: OptimizerOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
  }

  shouldRun(): boolean {
    const settings = new SettingsRepo(this.db).load();
    const { lastOptimizedAt } = settings;
    if (!lastOptimizedAt) return true;
    const last = Date.parse(lastOptimizedAt);
    if (Number.isNaN(last)) return true;
    return this.now() - last >= INTERVAL_MS;
  }

  runIfDue(): void {
    if (!this.shouldRun()) return;
    this.db.exec(`PRAGMA optimize`);
    const repo = new SettingsRepo(this.db);
    const settings = repo.load();
    repo.save({ ...settings, lastOptimizedAt: new Date(this.now()).toISOString() });
  }

  startInterval(intervalMs: number = INTERVAL_MS): NodeJS.Timeout {
    const handle = setInterval(() => this.runIfDue(), intervalMs);
    if (typeof handle.unref === 'function') handle.unref();
    return handle;
  }
}
