import type { Category, ThrottleProfileName } from './types.js';
import type { ThrottleProfile, ThrottleScheduleEntry } from './throttle.js';

export interface RoleDefinition {
  name: string;
  drivePriority: string[];
  fillThresholdPercent: number;
}

export interface CategoryMap {
  [category: string]: string[];
}

export interface Settings {
  catalogVersion: number;
  categoryMap: CategoryMap;
  throttleProfiles: Record<ThrottleProfileName, ThrottleProfile>;
  throttleSchedule: ThrottleScheduleEntry[];
  recentArchiveCutoffYears: number;
  uiPort: number;
}

export const DEFAULT_CATEGORY_MAP: CategoryMap = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'heic', 'webp', 'raw', 'cr2', 'nef', 'arw', 'dng'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'],
  document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md'],
  spreadsheet: ['xls', 'xlsx', 'ods', 'csv'],
  presentation: ['ppt', 'pptx', 'odp', 'key'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz'],
  ebook: ['epub', 'mobi', 'azw', 'azw3'],
  code: [
    'py', 'js', 'ts', 'tsx', 'jsx', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
    'ipynb', 'sh', 'rb', 'php', 'swift', 'kt',
  ],
};

export function categoryForExtension(map: CategoryMap, extension: string): Category | null {
  const ext = extension.toLowerCase().replace(/^\./, '');
  for (const [cat, exts] of Object.entries(map)) {
    if (exts.includes(ext)) {
      return cat as Category;
    }
  }
  return null;
}
