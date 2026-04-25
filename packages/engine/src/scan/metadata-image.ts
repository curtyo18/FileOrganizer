import exifr from 'exifr';

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

export async function extractImageMetadata(path: string): Promise<ImageMetadata> {
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
  } catch {
    return { exifDate: null, width: null, height: null };
  }
}
