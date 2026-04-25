import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  exifDate: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface ExtractVideoOptions {
  binaryPath: string;
  timeoutMs?: number;
}

export async function extractVideoMetadata(
  path: string,
  opts: ExtractVideoOptions,
): Promise<VideoMetadata> {
  if (!existsSync(opts.binaryPath)) {
    return { exifDate: null, width: null, height: null, durationSeconds: null };
  }
  try {
    const { stdout } = await execFileAsync(
      opts.binaryPath,
      ['--Output=JSON', '--Full', path],
      { timeout: opts.timeoutMs ?? 10_000, maxBuffer: 5 * 1024 * 1024 },
    );
    return parseMediainfoOutput(stdout);
  } catch {
    return { exifDate: null, width: null, height: null, durationSeconds: null };
  }
}

interface MediaInfoTrack {
  '@type': string;
  Width?: string;
  Height?: string;
  Duration?: string;
  Recorded_Date?: string;
  Encoded_Date?: string;
  Tagged_Date?: string;
}

interface MediaInfoOutput {
  media?: { track?: MediaInfoTrack[] };
}

export function parseMediainfoOutput(json: string): VideoMetadata {
  let parsed: MediaInfoOutput;
  try {
    parsed = JSON.parse(json) as MediaInfoOutput;
  } catch {
    return { exifDate: null, width: null, height: null, durationSeconds: null };
  }
  const tracks = parsed.media?.track ?? [];
  const general = tracks.find((t) => t['@type'] === 'General');
  const video = tracks.find((t) => t['@type'] === 'Video');
  const dateStr = general?.Recorded_Date ?? general?.Encoded_Date ?? general?.Tagged_Date ?? null;
  const exifDate = dateStr ? toIsoOrNull(dateStr) : null;
  const width = numberOrNull(video?.Width);
  const height = numberOrNull(video?.Height);
  const durationSeconds = numberOrNull(video?.Duration);
  return { exifDate, width, height, durationSeconds };
}

function toIsoOrNull(s: string): string | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function numberOrNull(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
