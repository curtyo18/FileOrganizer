import { describe, it, expect } from 'vitest';
import { categoryForExtension, DEFAULT_CATEGORY_MAP, type CategoryMap } from './settings.js';

describe('categoryForExtension', () => {
  it('matches known extensions case-insensitively', () => {
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, 'jpg')).toBe('image');
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, '.JPG')).toBe('image');
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, 'PDF')).toBe('document');
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, 'mp4')).toBe('video');
  });

  it('returns null for unknown extensions', () => {
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, 'exe')).toBeNull();
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, '')).toBeNull();
  });

  it('returns null for unknown category keys (does not silently widen)', () => {
    const customMap: CategoryMap = { custom_kind: ['xyz'] };
    expect(categoryForExtension(customMap, 'xyz')).toBeNull();
  });
});
