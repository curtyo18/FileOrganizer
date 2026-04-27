import { describe, it, expect } from 'vitest';
import type { DriveRecord, RoleDefinition } from '@fileorganizer/shared';
import { resolveRole } from './role-resolver.js';

function makeDrive(over: Partial<DriveRecord> & { id: string }): DriveRecord {
  return {
    volumeSerial: `serial-${over.id}`,
    label: over.id.toUpperCase(),
    currentLetter: null,
    mountPath: null,
    kind: 'local',
    roles: [],
    totalBytes: 1_000_000_000_000,
    freeBytes: 800_000_000_000,
    lastSeenAt: '2025-06-01T00:00:00.000Z',
    connected: true,
    ...over,
  };
}

function makeRole(over: Partial<RoleDefinition> = {}): RoleDefinition {
  return {
    name: 'media-archive',
    drivePriority: ['d1', 'd2'],
    fillThresholdPercent: 90,
    ...over,
  };
}

describe('resolveRole', () => {
  it('returns the highest-priority connected drive with space', () => {
    const drives = new Map<string, DriveRecord>([
      ['d1', makeDrive({ id: 'd1' })],
      ['d2', makeDrive({ id: 'd2' })],
    ]);
    const result = resolveRole({ role: makeRole(), drives });
    expect(result.driveId).toBe('d1');
    expect(result.reason).toContain('D1');
  });

  it('skips drive that is over fill threshold and falls through', () => {
    const drives = new Map<string, DriveRecord>([
      ['d1', makeDrive({ id: 'd1', totalBytes: 100, freeBytes: 5 })],
      ['d2', makeDrive({ id: 'd2' })],
    ]);
    const result = resolveRole({ role: makeRole({ fillThresholdPercent: 90 }), drives });
    expect(result.driveId).toBe('d2');
  });

  it('returns null when every drive is over threshold', () => {
    const drives = new Map<string, DriveRecord>([
      ['d1', makeDrive({ id: 'd1', totalBytes: 100, freeBytes: 5 })],
      ['d2', makeDrive({ id: 'd2', totalBytes: 100, freeBytes: 2 })],
    ]);
    const result = resolveRole({ role: makeRole({ fillThresholdPercent: 90 }), drives });
    expect(result.driveId).toBeNull();
    expect(result.reason).toContain('media-archive');
  });

  it('skips disconnected drives', () => {
    const drives = new Map<string, DriveRecord>([
      ['d1', makeDrive({ id: 'd1', connected: false })],
      ['d2', makeDrive({ id: 'd2' })],
    ]);
    const result = resolveRole({ role: makeRole(), drives });
    expect(result.driveId).toBe('d2');
  });

  it('skips drives that are missing from the map', () => {
    const drives = new Map<string, DriveRecord>([['d2', makeDrive({ id: 'd2' })]]);
    const result = resolveRole({ role: makeRole({ drivePriority: ['d1', 'd2'] }), drives });
    expect(result.driveId).toBe('d2');
  });

  it('returns null when no drives match a role', () => {
    const result = resolveRole({
      role: makeRole({ drivePriority: ['d-missing'] }),
      drives: new Map(),
    });
    expect(result.driveId).toBeNull();
  });
});
