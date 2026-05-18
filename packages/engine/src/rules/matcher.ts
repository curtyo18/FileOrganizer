import picomatch from 'picomatch';
import type { FileRecord, Rule } from '@fileorganizer/shared';

export function matches(file: FileRecord, rule: Rule): boolean {
  const match = rule.match;

  if (match.category && !match.category.includes(file.category)) return false;

  const fileDate = file.exifDate ?? file.mtime;
  if (match.dateBefore && fileDate >= match.dateBefore) return false;
  if (match.dateAfter && fileDate <= match.dateAfter) return false;

  if (match.dateSourceMin === 'exif' && file.dateSource !== 'exif') return false;
  if (match.dateSourceMin === 'mtime' && file.dateSource === 'none') return false;

  if (match.minSizeBytes != null && file.sizeBytes < match.minSizeBytes) return false;
  if (match.maxSizeBytes != null && file.sizeBytes > match.maxSizeBytes) return false;

  if (match.pathGlob) {
    const isMatch = picomatch(match.pathGlob, { dot: true });
    if (!isMatch(file.path)) return false;
  }

  if (match.sourceDrives && !match.sourceDrives.includes(file.driveId)) return false;

  return true;
}

export function firstMatch(file: FileRecord, rules: Rule[]): Rule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (matches(file, rule)) return rule;
  }
  return null;
}
