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
  // Game launchers — most installed games live under one of these and
  // would otherwise pollute the catalog with UI sprites, voice lines,
  // and cutscenes that look like real media to dedup/organize.
  'Steam',
  'SteamLibrary',
  'steamapps',
  'Epic Games',
  'Epic Games Launcher',
  'GOG Games',
  'GOG Galaxy',
  'Battle.net',
  'Blizzard',
  'Origin Games',
  'EA Games',
  'EA Desktop',
  'Riot Games',
  'Ubisoft',
  'Ubisoft Game Launcher',
  'Microsoft Games',
  'Rockstar Games',
  'WindowsApps',
  'XboxGames',
  'itchio',
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
