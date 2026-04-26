import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord } from '@fileorganizer/shared';

interface FileRow {
  id: number;
  driveId: string;
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  category: string;
  sha256: string;
  mtime: string;
  exifDate: string | null;
  state: string;
}

export function Browse(_props: RoutableProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [driveId, setDriveId] = useState('');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [offset, setOffset] = useState(0);
  const limit = 100;

  useEffect(() => {
    api.listDrives().then((d) => {
      setDrives(d);
      if (d.length > 0) setDriveId(d[0]!.id);
    });
  }, []);

  useEffect(() => {
    if (!driveId) return;
    api.listFiles(driveId, limit, offset).then((rows) => setFiles(rows as FileRow[]));
  }, [driveId, offset]);

  return (
    <div>
      <h1>Browse</h1>
      <div class="card">
        <label>Drive: </label>
        <select value={driveId} onChange={(e) => { setOffset(0); setDriveId((e.target as HTMLSelectElement).value); }}>
          {drives.map((d) => <option value={d.id}>{d.label}</option>)}
        </select>
        {' '}<button class="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</button>
        {' '}<button class="secondary" disabled={files.length < limit} onClick={() => setOffset(offset + limit)}>Next</button>
        <span class="muted"> rows {offset + 1}–{offset + files.length}</span>
      </div>
      <div class="card">
        <table>
          <thead>
            <tr><th>Path</th><th>Cat</th><th>Size</th><th>Date</th><th>SHA-256</th><th>State</th></tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>{f.path}</td>
                <td>{f.category}</td>
                <td>{formatBytes(f.sizeBytes)}</td>
                <td>{f.exifDate ?? f.mtime}</td>
                <td title={f.sha256}>{f.sha256.slice(0, 8)}…</td>
                <td>{f.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
