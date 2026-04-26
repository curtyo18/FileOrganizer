import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord } from '@fileorganizer/shared';

export function Dashboard(_props: RoutableProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listDrives().then(setDrives).catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {error ? <div class="card">Error: {error}</div> : null}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        {drives.map((d) => {
          const usedPct = d.totalBytes > 0 ? Math.round(((d.totalBytes - d.freeBytes) / d.totalBytes) * 100) : 0;
          return (
            <div class="card" key={d.id}>
              <h3>{d.label}</h3>
              <div class="muted">{d.currentLetter ?? '—'} · {d.kind}</div>
              <div style="margin-top:8px" class="fill-bar"><div style={`width:${usedPct}%`}></div></div>
              <div class="muted" style="margin-top:4px">{usedPct}% used · {formatBytes(d.freeBytes)} free</div>
              <div class="muted" style="margin-top:8px">Roles: {d.roles.join(', ') || '—'}</div>
            </div>
          );
        })}
      </div>
      {drives.length === 0 ? <div class="card muted">No drives yet. Run a scan from the CLI or Scans page.</div> : null}
    </div>
  );
}

function formatBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${u[i]}`;
}
