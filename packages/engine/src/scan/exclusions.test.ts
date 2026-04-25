import { describe, it, expect } from 'vitest';
import { isPathExcluded, DEFAULT_EXCLUDED_NAMES } from './exclusions.js';

describe('isPathExcluded', () => {
  it('excludes default system folders', () => {
    expect(isPathExcluded('Windows', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('Program Files', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('$Recycle.Bin', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('System Volume Information', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('node_modules', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('__pycache__', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('_FileOrganizer_quarantine', DEFAULT_EXCLUDED_NAMES)).toBe(true);
  });

  it('excludes hidden directories starting with a dot', () => {
    expect(isPathExcluded('.git', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('.venv', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('.config', DEFAULT_EXCLUDED_NAMES)).toBe(true);
  });

  it('does not exclude regular folder names', () => {
    expect(isPathExcluded('Photos', DEFAULT_EXCLUDED_NAMES)).toBe(false);
    expect(isPathExcluded('Documents', DEFAULT_EXCLUDED_NAMES)).toBe(false);
    expect(isPathExcluded('My Project', DEFAULT_EXCLUDED_NAMES)).toBe(false);
  });

  it('respects extra exclusions', () => {
    expect(isPathExcluded('CustomFolder', DEFAULT_EXCLUDED_NAMES, ['CustomFolder'])).toBe(true);
  });
});
