import { describe, it, expect } from 'vitest';
import { isPathUnderRoot } from './paths.js';

describe('isPathUnderRoot', () => {
  it('POSIX: candidate clearly under root → true', () => {
    expect(isPathUnderRoot('/data', '/data/x/y.jpg')).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'POSIX: case-distinct paths are different paths',
    () => {
      expect(isPathUnderRoot('/data', '/Data/x.jpg')).toBe(false);
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'win32: differently-cased path under same root → true',
    () => {
      expect(isPathUnderRoot('C:\\Data', 'C:\\DATA\\x.jpg')).toBe(true);
    },
  );

  it('both platforms: path === root returns false', () => {
    expect(isPathUnderRoot('/data', '/data')).toBe(false);
  });

  it('both platforms: path NOT under root → false', () => {
    expect(isPathUnderRoot('/data', '/other')).toBe(false);
  });

  it('prefix match without separator is NOT under root', () => {
    // /data2 starts with /data but is not under /data
    expect(isPathUnderRoot('/data', '/data2')).toBe(false);
  });

  it('root with trailing separator normalises correctly', () => {
    expect(isPathUnderRoot('/data/', '/data/x.jpg')).toBe(true);
    expect(isPathUnderRoot('/data/', '/data')).toBe(false);
  });
});
