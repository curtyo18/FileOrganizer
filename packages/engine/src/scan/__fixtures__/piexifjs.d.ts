declare module 'piexifjs' {
  export interface ExifIFDTags {
    DateTimeOriginal: number;
    [k: string]: number;
  }
  export const ExifIFD: ExifIFDTags;
  export function dump(exifObj: unknown): string;
  export function insert(exifStr: string, jpegDataUrl: string): string;
  const piexif: { ExifIFD: ExifIFDTags; dump: typeof dump; insert: typeof insert };
  export default piexif;
}
