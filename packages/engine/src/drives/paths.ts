import { sep } from 'node:path';

/**
 * Returns true when `candidate` is strictly inside `root` — i.e., it begins
 * with `root + sep`. Returns false when `candidate === root` (the root itself
 * is not "under" itself) or when the candidate is simply a different tree.
 *
 * On Windows (NTFS is case-insensitive) both sides are lowercased before
 * comparison. On POSIX case is preserved.
 */
export function isPathUnderRoot(root: string, candidate: string): boolean {
  const isWin = process.platform === 'win32';
  const normalizedRoot = isWin ? root.toLowerCase() : root;
  const normalizedCandidate = isWin ? candidate.toLowerCase() : candidate;
  if (normalizedCandidate === normalizedRoot) return false;
  const withSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  return normalizedCandidate.startsWith(withSep);
}
