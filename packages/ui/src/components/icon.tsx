interface IconProps {
  name: string;
  size?: number;
}

const PATHS: Record<string, string> = {
  drive: 'M2 4h12v8H2zM4 12v2M12 12v2',
  folder: 'M2 4h4l1 1h7v8H2z',
  scan: 'M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3M5 8h6',
  rules: 'M3 3h10M3 8h10M3 13h6',
  dupes: 'M5 5h7v7H5zM3 3h7v2M3 3v7h2',
  history: 'M8 4v4l2 2M2 8a6 6 0 106-6M2 8H1M2 8l1.5-1.5',
  quarantine: 'M3 6h10v8H3zM5 6V3h6v3',
  settings: 'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1v2M8 13v2M14 8h-2M4 8H2',
  chevron: 'M5 3l5 5-5 5',
  'chevron-d': 'M3 5l5 5 5-5',
  play: 'M4 3l8 5-8 5z',
  pause: 'M4 3h3v10H4zM9 3h3v10H9z',
  plus: 'M8 3v10M3 8h10',
  check: 'M3 8l3 3 7-7',
  x: 'M3 3l10 10M13 3L3 13',
  file: 'M4 2h6l2 2v10H4z',
  image: 'M2 3h12v10H2zM5 8l2 2 3-4 3 4',
  video: 'M2 4h8v8H2zM10 6l4-2v8l-4-2',
  nas: 'M2 4h12v3H2zM2 9h12v3H2zM4 5.5h.5M4 10.5h.5',
};

export function Icon({ name, size = 14 }: IconProps) {
  const d = PATHS[name] ?? '';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

export function driveIconName(kind: string | null | undefined): string {
  return kind === 'network' ? 'nas' : 'drive';
}
