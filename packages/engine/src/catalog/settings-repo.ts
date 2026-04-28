import { cpus } from 'node:os';
import type { Catalog } from './connection.js';
import {
  DEFAULT_CATEGORY_MAP,
  defaultThrottleProfiles,
  type Settings,
} from '@fileorganizer/shared';

const KEY = 'settings';

export class SettingsRepo {
  constructor(private readonly db: Catalog) {}

  load(): Settings {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(KEY) as { value: string } | undefined;
    if (row) {
      return JSON.parse(row.value) as Settings;
    }
    const fresh = this.defaults();
    this.save(fresh);
    return fresh;
  }

  save(s: Settings): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
      .run(KEY, JSON.stringify(s));
  }

  private defaults(): Settings {
    const cpuCount = cpus().length || 4;
    return {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      throttleProfiles: defaultThrottleProfiles(cpuCount),
      throttleSchedule: [],
      recentArchiveCutoffYears: 2,
      uiPort: 0,
    };
  }
}
