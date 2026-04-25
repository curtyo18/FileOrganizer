import { describe, it, expect } from 'vitest';
import { extractVideoMetadata, parseMediainfoOutput } from './metadata-video.js';

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

describe('extractVideoMetadata', () => {
  it('returns blank metadata when binary path is missing', async () => {
    const meta = await extractVideoMetadata('/does/not/exist.mp4', { binaryPath: '/no/such/binary' });
    expect(meta).toEqual({ exifDate: null, width: null, height: null, durationSeconds: null });
  });
});
