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
  // Installed creative-suite / dev-tool dirs — these ship hundreds of
  // bundled assets (presets, brushes, templates, sample projects) that
  // look like user media to the dedup/organize passes and pollute plans.
  'Adobe',
  'Adobe Creative Cloud',
  'Adobe Premiere Pro',
  'Adobe Premiere Pro 2020',
  'Adobe Photoshop',
  'Adobe Illustrator',
  'Adobe After Effects',
  'Adobe Lightroom',
  'Microsoft Office',
  'Office',
  'Autodesk',
  'JetBrains',
]);

const DEFAULT_EXCLUDED_NAMES_LC: ReadonlySet<string> = new Set(
  [...DEFAULT_EXCLUDED_NAMES].map((n) => n.toLowerCase()),
);

export function isPathExcluded(
  name: string,
  defaults: ReadonlySet<string> = DEFAULT_EXCLUDED_NAMES,
  extras: readonly string[] = [],
): boolean {
  if (name.startsWith('.')) return true;
  const lower = name.toLowerCase();
  const defaultsLc =
    defaults === DEFAULT_EXCLUDED_NAMES
      ? DEFAULT_EXCLUDED_NAMES_LC
      : new Set([...defaults].map((n) => n.toLowerCase()));
  if (defaultsLc.has(lower)) return true;
  for (const extra of extras) {
    if (extra.toLowerCase() === lower) return true;
  }
  return false;
}
