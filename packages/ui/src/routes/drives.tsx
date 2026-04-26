import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord } from '@fileorganizer/shared';

export function Drives(_props: RoutableProps) {
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    defaultApiClient()
      .listDrives()
      .then(setDrives)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div class="card">Error: {error}</div>;
  if (drives.length === 0) return <div class="card">No drives registered yet.</div>;

  return (
    <div>
      <h1>Drives</h1>
      <table>
        <thead>
          <tr><th>Label</th><th>Letter</th><th>Kind</th><th>Capacity</th><th>Roles</th></tr>
        </thead>
        <tbody>
          {drives.map((d) => (
            <tr key={d.id}>
              <td>{d.label}</td>
              <td>{d.currentLetter ?? '-'}</td>
              <td>{d.kind}</td>
              <td>{formatBytes(d.freeBytes)} / {formatBytes(d.totalBytes)}</td>
              <td>{d.roles.join(', ') || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
