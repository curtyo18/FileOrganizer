import type { Category, MovePolicy, QuarantinePolicy } from './types.js';

export interface RuleMatch {
  category?: Category[];
  dateBefore?: string;
  dateAfter?: string;
  dateSourceMin?: 'exif' | 'mtime' | 'any';
  minSizeBytes?: number | null;
  maxSizeBytes?: number | null;
  pathGlob?: string | null;
  sourceDrives?: string[] | null;
  sourceRoles?: string[] | null;
}

export interface Rule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  match: RuleMatch;
  destinationRole: string;
  destinationTemplate: string;
  movePolicy: MovePolicy;
  quarantinePolicy: QuarantinePolicy;
}
