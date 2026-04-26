import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord, ScanRecord } from '@fileorganizer/shared';

export function Scans(_props: RoutableProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [driveId, setDriveId] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [profile, setProfile] = useState<'idle' | 'balanced' | 'full-send'>('balanced');
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    Promise.all([api.listDrives(), api.listScans()])
      .then(([d, s]) => {
        setDrives(d);
        setScans(s as ScanRecord[]);
        if (!driveId && d.length > 0) setDriveId(d[0]!.id);
      })
      .catch((e) => setError((e as Error).message));
  };

  useEffect(reload, []);

  const onStart = async () => {
    setError(null);
    try {
      await api.startScan({ driveId, rootPaths: [rootPath], profile });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <h1>Scans</h1>
      <div class="card">
        <h2>Start scan</h2>
        {drives.length === 0 ? (
          <p class="muted">No drives registered. Run a scan from the CLI first.</p>
        ) : (
          <>
            <label>Drive: </label>
            <select value={driveId} onChange={(e) => setDriveId((e.target as HTMLSelectElement).value)}>
              {drives.map((d) => <option value={d.id}>{d.label}</option>)}
            </select>
            <label> Root path: </label>
            <input value={rootPath} onInput={(e) => setRootPath((e.target as HTMLInputElement).value)} />
            <label> Profile: </label>
            <select value={profile} onChange={(e) => setProfile((e.target as HTMLSelectElement).value as typeof profile)}>
              <option value="idle">idle</option>
              <option value="balanced">balanced</option>
              <option value="full-send">full-send</option>
            </select>
            {' '}<button onClick={onStart}>Start scan</button>
          </>
        )}
        {error ? <p style="color:var(--danger)">{error}</p> : null}
      </div>
      <div class="card">
        <h2>Recent scans</h2>
        {scans.length === 0 ? <p class="muted">No scans yet.</p> : (
          <table>
            <thead>
              <tr><th>Started</th><th>Drive</th><th>Status</th><th>Files</th></tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id}>
                  <td>{s.startedAt}</td>
                  <td>{s.driveId.slice(0, 8)}…</td>
                  <td>{s.status}</td>
                  <td>{s.progress?.filesIndexed ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
