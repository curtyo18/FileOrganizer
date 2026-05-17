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
      // Explicitly destructure only known Settings keys so that unrecognised
      // columns stored in the DB (e.g. from a future migration rollback) are
      // dropped rather than accumulating in the in-memory shape and being
      // re-serialised on the next save().
      const loaded = JSON.parse(row.value) as Record<string, unknown>;
      const defaults = this.defaults();
      return {
        catalogVersion:
          typeof loaded['catalogVersion'] === 'number'
            ? loaded['catalogVersion']
            : defaults.catalogVersion,
        categoryMap:
          loaded['categoryMap'] != null
            ? (loaded['categoryMap'] as Settings['categoryMap'])
            : defaults.categoryMap,
        throttleProfiles:
          loaded['throttleProfiles'] != null
            ? (loaded['throttleProfiles'] as Settings['throttleProfiles'])
            : defaults.throttleProfiles,
        throttleSchedule:
          Array.isArray(loaded['throttleSchedule'])
            ? (loaded['throttleSchedule'] as Settings['throttleSchedule'])
            : defaults.throttleSchedule,
        recentArchiveCutoffYears:
          typeof loaded['recentArchiveCutoffYears'] === 'number'
            ? loaded['recentArchiveCutoffYears']
            : defaults.recentArchiveCutoffYears,
        uiPort:
          typeof loaded['uiPort'] === 'number' ? loaded['uiPort'] : defaults.uiPort,
        userExcluded:
          Array.isArray(loaded['userExcluded'])
            ? (loaded['userExcluded'] as Settings['userExcluded'])
            : defaults.userExcluded,
      };
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
      userExcluded: [],
    };
  }
}
