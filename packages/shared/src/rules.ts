import type { Category, MovePolicy, QuarantinePolicy } from './types.js';

export interface RuleMatch {
  category?: Category[];
  /**
   * Match files with a date STRICTLY BEFORE this timestamp.
   * Both fields use ISO 8601 string lex-comparison — relies on the invariant
   * that ISO 8601 timestamps are lex-sortable. `file.exifDate ?? file.mtime`
   * must be in the same format (which the scanner guarantees).
   */
  dateBefore?: string;
  /**
   * Match files with a date STRICTLY AFTER this timestamp.
   * Both fields use ISO 8601 string lex-comparison — relies on the invariant
   * that ISO 8601 timestamps are lex-sortable. `file.exifDate ?? file.mtime`
   * must be in the same format (which the scanner guarantees).
   */
  dateAfter?: string;
  dateSourceMin?: 'exif' | 'mtime' | 'any';
  minSizeBytes?: number | null;
  maxSizeBytes?: number | null;
  /**
   * Glob pattern matched against the file path.
   * Use forward-slash separators in the pattern (e.g. "**\/Downloads\/**").
   * The matcher always normalises backslashes (`\`) in `file.path` to forward
   * slashes before evaluation, so a single pattern works on both POSIX and
   * Windows paths.
   */
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
