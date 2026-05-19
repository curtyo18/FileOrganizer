import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractImageMetadata } from './metadata-image.js';
import { buildJpegWithExifDate, buildPlainJpeg } from './__fixtures__/build-fixtures.js';
import { makeCapturingLogger } from '../test-helpers/log.js';


let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-meta-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('extractImageMetadata', () => {
  it('returns null exif date for a plain jpeg', async () => {
    const path = join(dir, 'plain.jpg');
    await buildPlainJpeg(path);
    const meta = await extractImageMetadata(path);
    expect(meta.exifDate).toBeNull();
  });

  it('reads DateTimeOriginal from a synthesized exif jpeg', async () => {
    const path = join(dir, 'exif.jpg');
    await buildJpegWithExifDate(path);
    const meta = await extractImageMetadata(path);
    expect(meta.exifDate).toMatch(/^2023-08-15T14:23:01/);
  });

  it('logs warn with metadata-image-error when exifr.parse throws, and returns null metadata', async () => {
    // Pass a path that does not exist — exifr throws ENOENT, which the catch
    // block should log and then return the null fallback.
    const { logger, warns } = makeCapturingLogger();
    const meta = await extractImageMetadata('/nonexistent/photo.jpg', { log: logger });
    expect(meta).toEqual({ exifDate: null, width: null, height: null });
    expect(warns).toHaveLength(1);
    const w = warns[0]!;
    expect(w.msg).toBe('metadata-image-error');
    expect(w.fields['path']).toBe('/nonexistent/photo.jpg');
    expect(typeof w.fields['err']).toBe('string');
  });
});
