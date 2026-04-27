import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { RulesRepo } from './repo.js';
import { seedDefaultRules } from './defaults.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-defaults-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('seedDefaultRules', () => {
  it('seeds six rules with the documented priorities on an empty catalog', () => {
    const seeded = seedDefaultRules(db);
    expect(seeded).toBe(6);

    const rules = new RulesRepo(db).list();
    expect(rules.map((r) => r.priority)).toEqual([100, 110, 200, 210, 300, 310]);
    expect(rules[0]!.match.category).toEqual(['image']);
    expect(rules[0]!.destinationTemplate).toBe('Photos/{year}/{month:02}/{filename}');
    expect(rules[1]!.match.category).toEqual(['video']);

    const docRecent = rules[2]!;
    expect(docRecent.match.category).toEqual(['document', 'spreadsheet', 'presentation', 'ebook']);
    expect(docRecent.match.dateAfter).toBeTruthy();

    const docArchive = rules[3]!;
    expect(docArchive.match.dateBefore).toBeTruthy();
    expect(docArchive.destinationTemplate).toContain('_archive');

    expect(rules[4]!.match.category).toEqual(['audio']);
    expect(rules[5]!.match.category).toEqual(['audio']);
    expect(rules[5]!.destinationTemplate).toContain('_archive');
  });

  it('does not re-seed when the rules table already has entries', () => {
    seedDefaultRules(db);
    const seededAgain = seedDefaultRules(db);
    expect(seededAgain).toBe(0);
    expect(new RulesRepo(db).list()).toHaveLength(6);
  });
});
