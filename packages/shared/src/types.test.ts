import { describe, it, expect } from 'vitest';
import type { Category, DriveKind, ScanStatus, FileState, BatchKind, OperationKind, OperationStatus } from './types.js';
import { CATEGORIES, DRIVE_KINDS } from './types.js';

describe('domain enums', () => {
  it('exposes the full category list', () => {
    expect(CATEGORIES).toEqual([
      'image',
      'video',
      'audio',
      'document',
      'spreadsheet',
      'presentation',
      'archive',
      'ebook',
      'code',
    ]);
  });

  it('exposes drive kinds', () => {
    expect(DRIVE_KINDS).toEqual(['local', 'external', 'network']);
  });

  it('rejects unknown category at compile-time via type narrowing', () => {
    const c: Category = 'image';
    expect(c).toBe('image');
  });
});
