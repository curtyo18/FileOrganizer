import { describe, it, expect } from 'vitest';
import { scoreCopies } from './scorer.js';
import type { DuplicateCopy } from './detect.js';

function copy(o: Partial<DuplicateCopy>): DuplicateCopy {
  return {
    fileId: 1,
    driveId: 'd1',
    path: '/a.jpg',
    sizeBytes: 100,
    category: 'image',
    state: 'indexed',
    mtime: '2024-01-01T00:00:00.000Z',
    ...o,
  };
}

describe('scoreCopies', () => {
  it('prefers a copy on a drive carrying the rule role', () => {
    const copies = [
      copy({ fileId: 1, driveId: 'da', path: '/a.jpg' }),
      copy({ fileId: 2, driveId: 'db', path: '/b.jpg' }),
    ];
    const drives = new Map([
      ['da', { kind: 'local' as const, roles: [] }],
      ['db', { kind: 'local' as const, roles: ['media-archive'] }],
    ]);
    const result = scoreCopies(copies, {
      drives,
      ruleRole: 'media-archive',
      destinationTemplates: [],
    });
    expect(result.keeperFileId).toBe(2);
    expect(result.reasons[0]).toContain('role');
  });

  it('falls through to path depth when role and template are tied', () => {
    const copies = [
      copy({ fileId: 1, path: '/a.jpg' }),
      copy({ fileId: 2, path: '/Photos/2023/08/a.jpg' }),
    ];
    const drives = new Map([['d1', { kind: 'local' as const, roles: [] }]]);
    const result = scoreCopies(
      copies.map((c) => ({ ...c, driveId: 'd1' })),
      { drives, ruleRole: null, destinationTemplates: [] },
    );
    expect(result.keeperFileId).toBe(2);
  });

  it('breaks ties by older mtime', () => {
    const copies = [
      copy({ fileId: 1, path: '/a.jpg', mtime: '2024-06-01T00:00:00.000Z' }),
      copy({ fileId: 2, path: '/a.jpg', mtime: '2024-01-01T00:00:00.000Z' }),
    ];
    const drives = new Map([['d1', { kind: 'local' as const, roles: [] }]]);
    const result = scoreCopies(
      copies.map((c) => ({ ...c, driveId: 'd1' })),
      { drives, ruleRole: null, destinationTemplates: [] },
    );
    expect(result.keeperFileId).toBe(2);
  });

  it('uses lexicographic path order as final tiebreaker', () => {
    const copies = [copy({ fileId: 1, path: '/zzz.jpg' }), copy({ fileId: 2, path: '/aaa.jpg' })];
    const drives = new Map([['d1', { kind: 'local' as const, roles: [] }]]);
    const result = scoreCopies(
      copies.map((c) => ({ ...c, driveId: 'd1' })),
      { drives, ruleRole: null, destinationTemplates: [] },
    );
    expect(result.keeperFileId).toBe(2);
  });

  it('throws when called with zero copies', () => {
    const drives = new Map<string, { kind: 'local'; roles: string[] }>();
    expect(() =>
      scoreCopies([], { drives, ruleRole: null, destinationTemplates: [] }),
    ).toThrow('scoreCopies requires at least one copy');
  });

  it("returns reasons[0] === 'only copy' when there is exactly one copy", () => {
    const drives = new Map([['d1', { kind: 'local' as const, roles: [] }]]);
    const result = scoreCopies(
      [copy({ fileId: 42, driveId: 'd1' })],
      { drives, ruleRole: null, destinationTemplates: [] },
    );
    expect(result.keeperFileId).toBe(42);
    expect(result.reasons[0]).toBe('only copy');
  });
});
