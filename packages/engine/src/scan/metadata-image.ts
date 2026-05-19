// Dependency note: we stay on exifr (single package, ESM-friendly, low-dep,
// read-only EXIF/XMP parsing).
// Alternatives considered and rejected:
//   - @exifr/parse: split-package variant, less stable API surface.
//   - exiftool-vendored: ships a binary subprocess, heavyweight for our
//     read-only needs.
//   - node-exif: unmaintained (last npm release 2017).
// exifr last npm release: 2022-05-01T21:24:18.198Z
import exifr from 'exifr';
import type { Logger } from '../log.js';

export interface ImageMetadata {
  exifDate: string | null;
  width: number | null;
  height: number | null;
}

// reviveValues: false keeps date fields as their raw "YYYY:MM:DD HH:MM:SS"
// strings. We then parse them as UTC ourselves — EXIF datetimes have no
// timezone info, and treating them as UTC at face value is more reproducible
// across machines than letting exifr apply the host's local timezone.
const PARSE_OPTS = {
  pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight'],
  reviveValues: false,
} as const;

const EXIF_DATE_RE = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/;

function exifDateToIso(value: unknown): string | null {
  if (typeof value !== 'string') {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    return null;
  }
  const match = EXIF_DATE_RE.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

export interface ExtractImageOptions {
  log?: Logger;
}

export async function extractImageMetadata(
  path: string,
  opts?: ExtractImageOptions,
): Promise<ImageMetadata> {
  try {
    const data = await exifr.parse(path, PARSE_OPTS as object);
    if (!data) return { exifDate: null, width: null, height: null };
    const candidates: unknown[] = [data.DateTimeOriginal, data.CreateDate, data.DateTimeDigitized];
    let exifDate: string | null = null;
    for (const c of candidates) {
      const iso = exifDateToIso(c);
      if (iso) {
        exifDate = iso;
        break;
      }
    }
    const width =
      typeof data.ExifImageWidth === 'number'
        ? data.ExifImageWidth
        : typeof data.ImageWidth === 'number'
          ? data.ImageWidth
          : null;
    const height =
      typeof data.ExifImageHeight === 'number'
        ? data.ExifImageHeight
        : typeof data.ImageHeight === 'number'
          ? data.ImageHeight
          : null;
    return { exifDate, width, height };
  } catch (err) {
    opts?.log?.warn('metadata-image-error', { path, err: (err as Error).message });
    return { exifDate: null, width: null, height: null };
  }
}
