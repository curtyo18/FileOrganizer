import type { DateSource } from '@fileorganizer/shared';

export interface DateResolutionInput {
  exifDate: string | null;
  mtime: string | null;
}

export interface DateResolution {
  date: string | null;
  source: DateSource;
  suspicious: boolean;
}

const MIN_REASONABLE = Date.UTC(1990, 0, 1);

export function resolveFileDate(input: DateResolutionInput): DateResolution {
  const now = Date.now();
  if (input.exifDate) {
    const t = Date.parse(input.exifDate);
    if (!Number.isNaN(t) && t >= MIN_REASONABLE && t <= now) {
      return { date: input.exifDate, source: 'exif', suspicious: false };
    }
    if (input.mtime) {
      return { date: input.mtime, source: 'mtime', suspicious: true };
    }
    return { date: null, source: 'none', suspicious: true };
  }
  if (input.mtime) {
    return { date: input.mtime, source: 'mtime', suspicious: false };
  }
  return { date: null, source: 'none', suspicious: false };
}
