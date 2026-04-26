export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const decimals = i <= 1 ? 0 : i === 2 ? 1 : 2;
  return `${v.toFixed(decimals)} ${units[i]}`;
}

export function formatNum(n: number): string {
  return n.toLocaleString();
}

const DRIVE_COLORS: Record<string, string> = {
  C: '#a78ce8',
  D: '#69b8d4',
  E: '#e89a4d',
  F: '#7fc28a',
  G: '#d47878',
  H: '#c0a070',
  I: '#9ec3a6',
  J: '#8ab0d4',
  K: '#c084ce',
  L: '#80b0c0',
  M: '#d49c84',
  N: '#d47878',
  O: '#a0c084',
  P: '#c08aa0',
  Q: '#84c0c0',
  R: '#c0a8c0',
  S: '#a8c08a',
  T: '#c8a890',
  U: '#88a8c8',
  V: '#c0c088',
  W: '#a8a8a8',
  X: '#8a8e96',
  Y: '#cc9090',
  Z: '#90a0cc',
};

export function driveColor(letterOrId: string | null | undefined): string {
  if (!letterOrId) return '#8a8e96';
  const ch = letterOrId.replace(/[^A-Za-z]/g, '').toUpperCase().charAt(0);
  return DRIVE_COLORS[ch] ?? '#8a8e96';
}

export function driveLetter(letter: string | null | undefined, fallback = '?'): string {
  if (!letter) return fallback;
  const ch = letter.replace(/[^A-Za-z]/g, '').toUpperCase().charAt(0);
  return ch || fallback;
}

export function fillPercent(total: number, free: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((total - free) / total) * 100)));
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diffMs = Date.now() - t;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}
