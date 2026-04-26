import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import piexif from 'piexifjs';

export async function buildPlainJpeg(outPath: string): Promise<void> {
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .jpeg()
    .toFile(outPath);
}

export async function buildJpegWithExifDate(outPath: string): Promise<void> {
  await buildPlainJpeg(outPath);
  const bytes = readFileSync(outPath);
  const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const exif = {
    '0th': {},
    Exif: {
      [piexif.ExifIFD.DateTimeOriginal]: '2023:08:15 14:23:01',
    },
    GPS: {},
    Interop: {},
    '1st': {},
    thumbnail: null,
  };
  const exifStr = piexif.dump(exif);
  const updated = piexif.insert(exifStr, dataUrl);
  const base64 = updated.split(',')[1] ?? '';
  writeFileSync(outPath, Buffer.from(base64, 'base64'));
}
