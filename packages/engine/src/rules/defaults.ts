import type { Catalog } from '../catalog/connection.js';
import { RulesRepo, type CreateRuleInput } from './repo.js';

// Deliberately uses a fixed 365-day year (ignores leap years) for a rough
// two-year cutoff. This seeder runs once on a fresh catalog to generate
// starter rules; it does not honour Settings.recentArchiveCutoffYears
// because those settings may not exist yet when seeding runs.
const TWO_YEARS_MS = 1000 * 60 * 60 * 24 * 365 * 2;

export function seedDefaultRules(db: Catalog, now: Date = new Date()): number {
  const repo = new RulesRepo(db);
  if (repo.list().length > 0) return 0;
  const cutoff = new Date(now.getTime() - TWO_YEARS_MS).toISOString().slice(0, 10);
  const rules = defaultRules(cutoff);
  for (const input of rules) {
    repo.create(input);
  }
  return rules.length;
}

function defaultRules(cutoff: string): CreateRuleInput[] {
  return [
    {
      name: 'Photos by date',
      priority: 100,
      match: { category: ['image'] },
      destinationRole: 'media-archive',
      destinationTemplate: 'Photos/{year}/{month:02}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    },
    {
      name: 'Videos by date',
      priority: 110,
      match: { category: ['video'] },
      destinationRole: 'media-archive',
      destinationTemplate: 'Videos/{year}/{month:02}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    },
    {
      name: 'Recent documents',
      priority: 200,
      match: {
        category: ['document', 'spreadsheet', 'presentation', 'ebook'],
        dateAfter: cutoff,
      },
      destinationRole: 'active-documents',
      destinationTemplate: 'Documents/{category}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    },
    {
      name: 'Archived documents',
      priority: 210,
      match: {
        category: ['document', 'spreadsheet', 'presentation', 'ebook'],
        dateBefore: cutoff,
      },
      destinationRole: 'document-archive',
      destinationTemplate: 'Documents/_archive/{year}/{category}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    },
    {
      name: 'Recent audio',
      priority: 300,
      match: { category: ['audio'], dateAfter: cutoff },
      destinationRole: 'active-documents',
      destinationTemplate: 'Audio/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    },
    {
      name: 'Archived audio',
      priority: 310,
      match: { category: ['audio'], dateBefore: cutoff },
      destinationRole: 'document-archive',
      destinationTemplate: 'Audio/_archive/{year}/{filename}',
      movePolicy: 'cross-drive-review',
      quarantinePolicy: 'default',
    },
  ];
}
