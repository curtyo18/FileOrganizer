import { describe, it, expect } from 'vitest';
import type { FileRecord } from '@fileorganizer/shared';
import { RuleError } from '@fileorganizer/shared';
import { renderTemplate } from './template.js';

function makeFile(over: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 1,
    driveId: 'drive-a',
    path: '/Users/x/a.jpg',
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

describe('renderTemplate', () => {
  it('renders {year}/{month:02}/{filename} from EXIF date', () => {
    const file = makeFile({
      exifDate: '2023-08-15T10:00:00.000Z',
      dateSource: 'exif',
      name: 'a.jpg',
    });
    const out = renderTemplate('Photos/{year}/{month:02}/{filename}', file, 'PRIMARY');
    expect(out).toBe('Photos/2023/08/a.jpg');
  });

  it('renders {category}/{stem}-{day:02}.{ext}', () => {
    const file = makeFile({
      exifDate: '2023-08-05T00:00:00.000Z',
      dateSource: 'exif',
      name: 'IMG.jpg',
      extension: 'jpg',
      category: 'image',
    });
    const out = renderTemplate('{category}/{stem}-{day:02}.{ext}', file, 'PRIMARY');
    expect(out).toBe('image/IMG-05.jpg');
  });

  it('renders {drive_label}', () => {
    const file = makeFile({ exifDate: '2023-01-01T00:00:00.000Z', dateSource: 'exif' });
    expect(renderTemplate('{drive_label}/{year}', file, 'BACKUP-01')).toBe('BACKUP-01/2023');
  });

  it('falls back to mtime when exifDate is null', () => {
    const file = makeFile({
      exifDate: null,
      mtime: '2024-12-31T00:00:00.000Z',
      dateSource: 'mtime',
    });
    expect(renderTemplate('{year}/{month:02}', file, 'PRIMARY')).toBe('2024/12');
  });

  it('throws RuleError when {year} is referenced and no date is available', () => {
    const file = makeFile({ exifDate: null, mtime: '', dateSource: 'none' });
    expect(() => renderTemplate('Photos/{year}/{filename}', file, 'PRIMARY')).toThrow(RuleError);
  });

  it('throws RuleError on unknown field', () => {
    const file = makeFile({ exifDate: '2023-01-01T00:00:00.000Z', dateSource: 'exif' });
    expect(() => renderTemplate('{bogus}', file, 'PRIMARY')).toThrow(RuleError);
  });

  it('passes through forward-slash in {filename} as-is (caller is responsible for path safety)', () => {
    // A filename containing '/' is not sanitised by renderTemplate — the output
    // will contain the slash exactly as given.  Callers that use the result as a
    // filesystem path must validate or sanitise the rendered string themselves.
    const file = makeFile({
      exifDate: '2023-01-01T00:00:00.000Z',
      dateSource: 'exif',
      name: 'sub/malicious.jpg',
    });
    const out = renderTemplate('{year}/{filename}', file, 'PRIMARY');
    expect(out).toBe('2023/sub/malicious.jpg');
  });

  it('passes through backslash in {filename} as-is (caller is responsible for path safety)', () => {
    // A filename containing '\\' is not sanitised by renderTemplate — the output
    // will contain the backslash exactly as given.
    const file = makeFile({
      exifDate: '2023-01-01T00:00:00.000Z',
      dateSource: 'exif',
      name: 'sub\\malicious.jpg',
    });
    const out = renderTemplate('{year}/{filename}', file, 'PRIMARY');
    expect(out).toBe('2023/sub\\malicious.jpg');
  });
});
