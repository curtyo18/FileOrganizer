import picomatch from 'picomatch';
import type { FileRecord, Rule } from '@fileorganizer/shared';
import { RuleError } from '@fileorganizer/shared';

type GlobMatcher = (path: string) => boolean;

/**
 * Compile a rule's pathGlob into a picomatch matcher.
 * Throws `RuleError('INVALID_GLOB', ...)` if the glob string is syntactically
 * invalid so the error surfaces as a 400 via the API's onError handler.
 */
export function compileGlobOrThrow(rule: Rule): GlobMatcher {
  try {
    return picomatch(rule.match.pathGlob!, { dot: true, strictBrackets: true });
  } catch (err) {
    throw new RuleError(
      'INVALID_GLOB',
      `rule ${rule.name} has invalid pathGlob: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/**
 * Test whether `file` satisfies every active constraint in `rule.match`.
 *
 * @param isMatch - precompiled picomatch result for `rule.match.pathGlob`.
 *   Pass `null` when there is no pathGlob. When non-null this function reuses
 *   the already-compiled matcher instead of recompiling on every call.
 */
export function matches(file: FileRecord, rule: Rule, isMatch: GlobMatcher | null = null): boolean {
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
    const matcher = isMatch ?? compileGlobOrThrow(rule);
    // Normalise backslashes to forward slashes before evaluation.
    // pathGlob patterns use forward-slash conventions (picomatch requires this).
    // On Windows, file.path may contain '\' separators; normalising here makes
    // a single glob pattern work on both POSIX and Windows paths.
    const normalizedPath = file.path.replace(/\\/g, '/');
    if (!matcher(normalizedPath)) return false;
  }

  if (match.sourceDrives && !match.sourceDrives.includes(file.driveId)) return false;

  return true;
}

/**
 * Return the first enabled rule in `rules` whose match criteria the `file`
 * satisfies, or `null` if none matches.
 *
 * Globs are compiled once per enabled rule at the start of this call (not once
 * per `(file, rule)` pair), giving an ≈N_rules× improvement over lazy
 * per-check compilation.
 */
export function firstMatch(file: FileRecord, rules: Rule[]): Rule | null {
  // Precompile all pathGlobs up front — one compile per enabled rule, not one
  // per match check.
  const compiled = rules
    .filter((r) => r.enabled)
    .map((r) => ({ rule: r, isMatch: r.match.pathGlob ? compileGlobOrThrow(r) : null }));

  for (const { rule, isMatch } of compiled) {
    if (matches(file, rule, isMatch)) return rule;
  }
  return null;
}
