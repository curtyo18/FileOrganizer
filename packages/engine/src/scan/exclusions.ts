export const DEFAULT_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
  '$Recycle.Bin',
  'System Volume Information',
  'node_modules',
  '__pycache__',
  'dist',
  'build',
  'target',
  'vendor',
  '_FileOrganizer_quarantine',
]);

export function isPathExcluded(
  name: string,
  defaults: ReadonlySet<string> = DEFAULT_EXCLUDED_NAMES,
  extras: readonly string[] = [],
): boolean {
  if (name.startsWith('.')) return true;
  if (defaults.has(name)) return true;
  if (extras.includes(name)) return true;
  return false;
}
