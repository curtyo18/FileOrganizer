import { describe, it, expect } from 'vitest';
import { CatalogError, ScanError, RuleError, IntegrityError, isFileOrganizerError } from './errors.js';

describe('error classes', () => {
  it('CatalogError carries a code and message', () => {
    const err = new CatalogError('CATALOG_LOCKED', 'database is locked');
    expect(err.code).toBe('CATALOG_LOCKED');
    expect(err.message).toBe('database is locked');
    expect(err.name).toBe('CatalogError');
    expect(err instanceof Error).toBe(true);
  });

  it('ScanError carries a code and optional cause', () => {
    const cause = new Error('underlying');
    const err = new ScanError('DRIVE_DISCONNECTED', 'NAS not reachable', cause);
    expect(err.code).toBe('DRIVE_DISCONNECTED');
    expect(err.cause).toBe(cause);
  });

  it('isFileOrganizerError detects all error subclasses', () => {
    expect(isFileOrganizerError(new CatalogError('X', 'y'))).toBe(true);
    expect(isFileOrganizerError(new ScanError('X', 'y'))).toBe(true);
    expect(isFileOrganizerError(new RuleError('X', 'y'))).toBe(true);
    expect(isFileOrganizerError(new IntegrityError('X', 'y'))).toBe(true);
    expect(isFileOrganizerError(new Error('plain'))).toBe(false);
  });
});
