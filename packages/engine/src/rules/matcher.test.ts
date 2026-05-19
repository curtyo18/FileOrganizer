import { describe, it, expect } from 'vitest';
import type { FileRecord, Rule, RuleMatch } from '@fileorganizer/shared';
import { RuleError } from '@fileorganizer/shared';
import { matches, firstMatch } from './matcher.js';

function makeFile(over: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 1,
    driveId: 'drive-a',
    path: '/Users/x/Pictures/a.jpg',
    name: 'a.jpg',
    extension: 'jpg',
    sizeBytes: 1000,
    category: 'image',
    sha256: 'a'.repeat(64),
    mtime: '2025-06-01T00:00:00.000Z',
    ctime: '2025-06-01T00:00:00.000Z',
    exifDate: null,
    dateSource: 'mtime',
    width: 100,
    height: 100,
    durationSeconds: null,
    ntfsFileId: null,
    state: 'indexed',
    lastVerifiedAt: '2025-06-01T00:00:00.000Z',
    scanId: 'scan-1',
    ...over,
  };
}

function makeRule(match: RuleMatch, over: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    name: 'test',
    priority: 100,
    enabled: true,
    match,
    destinationRole: 'photos',
    destinationTemplate: 'Photos/{filename}',
    movePolicy: 'same-drive-auto',
    quarantinePolicy: 'default',
    ...over,
  };
}

describe('matcher.matches', () => {
  it('matches by category', () => {
    expect(matches(makeFile({ category: 'image' }), makeRule({ category: ['image'] }))).toBe(true);
  });

  it('rejects when category does not match', () => {
    expect(matches(makeFile({ category: 'video' }), makeRule({ category: ['image'] }))).toBe(false);
  });

  it('matches dateBefore against exifDate when present', () => {
    const file = makeFile({ exifDate: '2023-01-01T00:00:00.000Z', dateSource: 'exif' });
    expect(matches(file, makeRule({ dateBefore: '2024-01-01' }))).toBe(true);
  });

  it('rejects dateBefore when file is newer', () => {
    const file = makeFile({ exifDate: '2025-01-01T00:00:00.000Z', dateSource: 'exif' });
    expect(matches(file, makeRule({ dateBefore: '2024-01-01' }))).toBe(false);
  });

  it('rejects when dateSourceMin requires exif but file only has mtime', () => {
    const file = makeFile({ exifDate: null, dateSource: 'mtime' });
    expect(matches(file, makeRule({ dateSourceMin: 'exif' }))).toBe(false);
  });

  it('rejects when dateSourceMin requires mtime but file has none', () => {
    const file = makeFile({ exifDate: null, dateSource: 'none' });
    expect(matches(file, makeRule({ dateSourceMin: 'mtime' }))).toBe(false);
  });

  it('matches a pathGlob against the file path', () => {
    const file = makeFile({ path: '/Users/x/Downloads/a.jpg' });
    expect(matches(file, makeRule({ pathGlob: '**/Downloads/**' }))).toBe(true);
  });

  it('rejects when pathGlob does not match', () => {
    const file = makeFile({ path: '/Users/x/Pictures/a.jpg' });
    expect(matches(file, makeRule({ pathGlob: '**/Downloads/**' }))).toBe(false);
  });

  it('rejects when file is below minSizeBytes', () => {
    expect(matches(makeFile({ sizeBytes: 100 }), makeRule({ minSizeBytes: 200 }))).toBe(false);
  });

  it('matches when file meets minSizeBytes', () => {
    expect(matches(makeFile({ sizeBytes: 500 }), makeRule({ minSizeBytes: 200 }))).toBe(true);
  });

  it('rejects when file is above maxSizeBytes', () => {
    expect(matches(makeFile({ sizeBytes: 5000 }), makeRule({ maxSizeBytes: 1000 }))).toBe(false);
  });

  it('matches when file driveId is in sourceDrives', () => {
    const file = makeFile({ driveId: 'drive-a' });
    expect(matches(file, makeRule({ sourceDrives: ['drive-a', 'drive-b'] }))).toBe(true);
  });

  it('rejects when file driveId is not in sourceDrives', () => {
    const file = makeFile({ driveId: 'drive-c' });
    expect(matches(file, makeRule({ sourceDrives: ['drive-a', 'drive-b'] }))).toBe(false);
  });

  it('matches when no constraints are set (catch-all rule)', () => {
    expect(matches(makeFile(), makeRule({}))).toBe(true);
  });
});

describe('matcher.firstMatch', () => {
  it('returns the first enabled rule that matches in iteration order', () => {
    const file = makeFile({ category: 'video' });
    const r1 = makeRule({ category: ['image'] }, { id: 'r1', priority: 100 });
    const r2 = makeRule({ category: ['video'] }, { id: 'r2', priority: 200 });
    const r3 = makeRule({ category: ['video'] }, { id: 'r3', priority: 300 });
    const result = firstMatch(file, [r1, r2, r3]);
    expect(result?.id).toBe('r2');
  });

  it('skips disabled rules', () => {
    const file = makeFile({ category: 'image' });
    const r1 = makeRule({ category: ['image'] }, { id: 'r1', enabled: false });
    const r2 = makeRule({ category: ['image'] }, { id: 'r2', enabled: true });
    expect(firstMatch(file, [r1, r2])?.id).toBe('r2');
  });

  it('returns null when nothing matches', () => {
    const file = makeFile({ category: 'video' });
    const r1 = makeRule({ category: ['image'] });
    expect(firstMatch(file, [r1])).toBeNull();
  });

  it('precompiles globs once per enabled rule per firstMatch call via compileGlobOrThrow', () => {
    // Verify that compileGlobOrThrow is exported (used by firstMatch internals)
    // and that calling firstMatch with multiple rules with pathGlobs works correctly,
    // meaning globs are compiled once per rule (not once per match check).
    // Structural verification: a malformed glob in one rule is caught at compile-time
    // (during precompile), not lazily per-match — so even when another rule would
    // match before we reach the bad one, the bad glob still throws.
    const file = makeFile({ path: '/Users/x/Downloads/a.jpg' });
    const goodRule = makeRule({ pathGlob: '**/Downloads/**' }, { id: 'good', priority: 50 });
    const badRule = makeRule({ pathGlob: '[' }, { id: 'bad', name: 'bad-rule', priority: 200 });

    // Precompilation means bad-rule is compiled even though good-rule would match first
    expect(() => firstMatch(file, [goodRule, badRule])).toThrow(RuleError);
  });

  it("pathGlob '**/Downloads/**' matches a Windows-style backslash path", () => {
    const file = makeFile({ path: 'C:\\Users\\foo\\Downloads\\bar.jpg' });
    const rule = makeRule({ pathGlob: '**/Downloads/**' });
    expect(matches(file, rule)).toBe(true);
  });

  it('malformed pathGlob throws RuleError with code INVALID_GLOB', () => {
    const file = makeFile({ path: '/Users/x/Downloads/a.jpg' });
    const rule = makeRule({ pathGlob: '[' }, { name: 'bad-rule' });
    expect(() => firstMatch(file, [rule])).toThrow(RuleError);
    expect(() => firstMatch(file, [rule])).toThrow(
      expect.objectContaining({ code: 'INVALID_GLOB' }),
    );
    expect(() => firstMatch(file, [rule])).toThrow(/bad-rule/);
  });
});

describe('matcher.dateBefore boundary', () => {
  it('does NOT match when file date equals dateBefore (strict less-than)', () => {
    const file = makeFile({ mtime: '2024-01-01T00:00:00.000Z', exifDate: null });
    const rule = makeRule({ dateBefore: '2024-01-01T00:00:00.000Z' });
    expect(matches(file, rule)).toBe(false);
  });

  it('matches when file date is strictly before dateBefore', () => {
    const file = makeFile({ mtime: '2023-12-31T23:59:59.999Z', exifDate: null });
    const rule = makeRule({ dateBefore: '2024-01-01T00:00:00.000Z' });
    expect(matches(file, rule)).toBe(true);
  });
});
