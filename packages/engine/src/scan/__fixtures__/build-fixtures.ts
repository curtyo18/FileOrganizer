import sharp from 'sharp';

export async function buildPlainJpeg(outPath: string): Promise<void> {
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .jpeg()
    .toFile(outPath);
}

export async function buildJpegWithExifDate(outPath: string): Promise<void> {
  // Sharp's withMetadata({ exif }) can write IFD2 (Exif sub-IFD) tags
  // directly, replacing the previous piexifjs-based approach.
  // piexifjs (devDep) has been removed: sharp already ships as a production
  // dep and its native EXIF write path is sufficient for our test fixture
  // needs. Spike confirmed DateTimeOriginal round-trips correctly via
  // exifr.parse({ reviveValues: false }).
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .withMetadata({
      exif: {
        IFD2: {
          DateTimeOriginal: '2023:08:15 14:23:01',
        },
      },
    })
    .jpeg()
    .toFile(outPath);
}
