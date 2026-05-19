import { cpus } from 'node:os';
import type { Catalog } from './connection.js';
import {
  DEFAULT_CATEGORY_MAP,
  defaultThrottleProfiles,
  type Settings,
} from '@fileorganizer/shared';
import { SettingsSchema } from './settings-schema.js';

const KEY = 'settings';

export class SettingsRepo {
  constructor(private readonly db: Catalog) {}

  load(): Settings {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(KEY) as { value: string } | undefined;

    if (row) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.value);
      } catch {
        process.stderr.write(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: 'warn',
            msg: 'settings-schema-invalid',
            reason: 'JSON parse error',
          }) + '\n',
        );
        return this.defaults();
      }

      const result = SettingsSchema.safeParse(parsed);
      if (result.success) {
        // Cast needed: zod infers optional fields as `T | undefined` but
        // exactOptionalPropertyTypes expects `?: T` (absent, not explicitly undefined).
        return result.data as Settings;
      }

      process.stderr.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'warn',
          msg: 'settings-schema-invalid',
          errors: result.error.issues,
        }) + '\n',
      );
      return this.defaults();
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
