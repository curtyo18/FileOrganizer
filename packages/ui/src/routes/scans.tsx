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
  const [pathInput, setPathInput] = useState('');
  const [profile, setProfile] = useState<'idle' | 'balanced' | 'full-send'>('balanced');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
    setInfo(null);
    try {
      await api.startScan({ driveId, rootPaths: [rootPath], profile });
      setInfo('Scan started');
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onScanByPath = async () => {
    setError(null);
    setInfo(null);
    if (!pathInput.trim()) {
      setError('Enter a path');
      return;
    }
    try {
      await api.startScan({ rootPath: pathInput.trim(), profile });
      setInfo(`Scan started for ${pathInput.trim()}`);
      setPathInput('');
      // Give the scan a moment to register the drive before reloading.
      setTimeout(reload, 200);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <h1>Scans</h1>

      <div class="card">
        <h2>Scan a folder</h2>
        <p class="muted">
          Enter the absolute path to scan. The drive will be auto-detected and registered if new.
        </p>
        <input
          style="width:60%"
          placeholder="D:\Pictures or /home/user/photos"
          value={pathInput}
          onInput={(e) => setPathInput((e.target as HTMLInputElement).value)}
        />
        {' '}
        <select
          value={profile}
          onChange={(e) => setProfile((e.target as HTMLSelectElement).value as typeof profile)}
        >
          <option value="idle">idle</option>
          <option value="balanced">balanced</option>
          <option value="full-send">full-send</option>
        </select>
        {' '}
        <button onClick={onScanByPath}>Scan</button>
      </div>

      {drives.length > 0 ? (
        <div class="card">
          <h2>Re-scan a known drive</h2>
          <label>Drive: </label>
          <select value={driveId} onChange={(e) => setDriveId((e.target as HTMLSelectElement).value)}>
            {drives.map((d) => <option value={d.id}>{d.label}</option>)}
          </select>
          {' '}<label>Root path: </label>
          <input
            value={rootPath}
            onInput={(e) => setRootPath((e.target as HTMLInputElement).value)}
            placeholder="path within this drive"
          />
          {' '}<button class="secondary" onClick={onStart}>Start</button>
        </div>
      ) : null}

      {error ? <div class="card" style="color:var(--danger)">{error}</div> : null}
      {info ? <div class="card muted">{info}</div> : null}

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
