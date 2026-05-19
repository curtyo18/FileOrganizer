import { describe, it, expect } from 'vitest';

import { extractVideoMetadata, parseMediainfoOutput } from './metadata-video.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '../log.js';

describe('parseMediainfoOutput', () => {
  it('returns null exifDate when no recorded date', () => {
    const json = JSON.stringify({
      media: { track: [{ '@type': 'Video', Width: '1920', Height: '1080', Duration: '12.345' }] },
    });
    const meta = parseMediainfoOutput(json);
    expect(meta.exifDate).toBeNull();
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.durationSeconds).toBeCloseTo(12.345, 3);
  });

  it('reads creation time from General track', () => {
    const json = JSON.stringify({
      media: {
        track: [
          { '@type': 'General', Recorded_Date: '2023-08-15T14:23:01Z' },
          { '@type': 'Video', Width: '1920', Height: '1080', Duration: '5.0' },
        ],
      },
    });
    const meta = parseMediainfoOutput(json);
    expect(meta.exifDate).toBe('2023-08-15T14:23:01.000Z');
  });

  it('handles missing video track gracefully', () => {
    const json = JSON.stringify({ media: { track: [] } });
    const meta = parseMediainfoOutput(json);
    expect(meta.width).toBeNull();
    expect(meta.height).toBeNull();
    expect(meta.durationSeconds).toBeNull();
  });
});

function makeLogger(): { logger: Logger; warns: Array<{ msg: string; fields: Record<string, unknown> }> } {
  const warns: Array<{ msg: string; fields: Record<string, unknown> }> = [];
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: (msg, fields) => warns.push({ msg, fields: fields ?? {} }),
    error: noop,
    child: () => logger,
  };
  return { logger, warns };
}

describe('extractVideoMetadata', () => {
  it('returns blank metadata when binary path is missing', async () => {
    const meta = await extractVideoMetadata('/does/not/exist.mp4', { binaryPath: '/no/such/binary' });
    expect(meta).toEqual({ exifDate: null, width: null, height: null, durationSeconds: null });
  });

  it.skipIf(process.platform === 'win32')('logs warn with metadata-video-error (phase execFile) when execFile throws, and returns null metadata', async () => {
    // Create a real binary that exists so we pass the existsSync check,
    // but make it exit with a non-zero status to trigger the execFile catch.
    const tmpDir = mkdtempSync(join(tmpdir(), 'fileorg-vidmeta-err-'));
    const fakeBinary = join(tmpDir, 'mediainfo-fail.sh');
    writeFileSync(fakeBinary, '#!/bin/sh\nexit 1', { mode: 0o755 });

    const { logger, warns } = makeLogger();
    try {
      const meta = await extractVideoMetadata('/video/sample.mp4', {
        binaryPath: fakeBinary,
        log: logger,
      });
      expect(meta).toEqual({ exifDate: null, width: null, height: null, durationSeconds: null });
      expect(warns).toHaveLength(1);
      const w = warns[0]!;
      expect(w.msg).toBe('metadata-video-error');
      expect(w.fields['path']).toBe('/video/sample.mp4');
      expect(w.fields['phase']).toBe('execFile');
      expect(typeof w.fields['err']).toBe('string');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('logs warn with metadata-video-error (phase parse) when JSON is invalid, and returns null metadata', async () => {
    const { logger, warns } = makeLogger();
    const result = parseMediainfoOutput('not-valid-json', {
      log: logger,
      path: '/video/sample.mp4',
    });
    expect(result).toEqual({ exifDate: null, width: null, height: null, durationSeconds: null });
    expect(warns).toHaveLength(1);
    const w = warns[0]!;
    expect(w.msg).toBe('metadata-video-error');
    expect(w.fields['path']).toBe('/video/sample.mp4');
    expect(w.fields['phase']).toBe('parse');
    expect(typeof w.fields['err']).toBe('string');
  });

  it.skipIf(process.platform === 'win32')('happy path: returns parsed metadata when a real fake-binary emits canned MediaInfo JSON', async () => {
    // Create a real shell script that acts as a fake MediaInfo binary.
    // This tests the full execFileAsync → parseMediainfoOutput pipeline
    // without needing to mock the already-promisified execFile closure.
    const tmpDir = mkdtempSync(join(tmpdir(), 'fileorg-vidmeta-'));
    const fakeBinary = join(tmpDir, 'mediainfo.sh');

    const cannedJson = JSON.stringify({
      media: {
        track: [
          { '@type': 'General', Recorded_Date: '2023-08-15T14:23:01Z' },
          { '@type': 'Video', Width: '1920', Height: '1080', Duration: '123.456' },
        ],
      },
    });

    // Write a tiny shell script that ignores all arguments and prints the JSON.
    writeFileSync(
      fakeBinary,
      `#!/bin/sh\nprintf '%s' '${cannedJson.replace(/'/g, "'\\''")}'`,
      { mode: 0o755 },
    );

    try {
      const meta = await extractVideoMetadata('/video/sample.mp4', { binaryPath: fakeBinary });
      expect(meta.exifDate).toBe('2023-08-15T14:23:01.000Z');
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
      expect(meta.durationSeconds).toBeCloseTo(123.456, 3);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
