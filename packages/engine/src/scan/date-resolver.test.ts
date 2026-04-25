import { describe, it, expect } from 'vitest';
import { resolveFileDate } from './date-resolver.js';

describe('resolveFileDate', () => {
  it('prefers exif when present and valid', () => {
    const r = resolveFileDate({ exifDate: '2023-08-15T00:00:00.000Z', mtime: '2024-01-01T00:00:00.000Z' });
    expect(r.date).toBe('2023-08-15T00:00:00.000Z');
    expect(r.source).toBe('exif');
  });

  it('falls back to mtime when exif is missing', () => {
    const r = resolveFileDate({ exifDate: null, mtime: '2024-01-01T00:00:00.000Z' });
    expect(r.date).toBe('2024-01-01T00:00:00.000Z');
    expect(r.source).toBe('mtime');
  });

  it('returns none when both missing', () => {
    const r = resolveFileDate({ exifDate: null, mtime: null });
    expect(r.date).toBeNull();
    expect(r.source).toBe('none');
  });

  it('flags suspicious exif (future) and falls through to mtime', () => {
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const r = resolveFileDate({ exifDate: future, mtime: '2024-01-01T00:00:00.000Z' });
    expect(r.source).toBe('mtime');
    expect(r.suspicious).toBe(true);
  });

  it('flags suspicious exif (before 1990)', () => {
    const r = resolveFileDate({ exifDate: '1980-01-01T00:00:00.000Z', mtime: '2024-01-01T00:00:00.000Z' });
    expect(r.source).toBe('mtime');
    expect(r.suspicious).toBe(true);
  });
});
