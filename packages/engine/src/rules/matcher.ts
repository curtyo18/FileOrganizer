import picomatch from 'picomatch';
import type { FileRecord, Rule } from '@fileorganizer/shared';

export function matches(file: FileRecord, rule: Rule): boolean {
  const m = rule.match;

  if (m.category && !m.category.includes(file.category)) return false;

  const fileDate = file.exifDate ?? file.mtime;
  if (m.dateBefore && fileDate >= m.dateBefore) return false;
  if (m.dateAfter && fileDate <= m.dateAfter) return false;

  if (m.dateSourceMin === 'exif' && file.dateSource !== 'exif') return false;
  if (m.dateSourceMin === 'mtime' && file.dateSource === 'none') return false;

  if (m.minSizeBytes != null && file.sizeBytes < m.minSizeBytes) return false;
  if (m.maxSizeBytes != null && file.sizeBytes > m.maxSizeBytes) return false;

  if (m.pathGlob) {
    const isMatch = picomatch(m.pathGlob, { dot: true });
    if (!isMatch(file.path)) return false;
  }

  if (m.sourceDrives && !m.sourceDrives.includes(file.driveId)) return false;

  return true;
}

export function firstMatch(file: FileRecord, rules: Rule[]): Rule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (matches(file, rule)) return rule;
  }
  return null;
}
