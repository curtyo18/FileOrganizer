import { useEffect, useState, useRef } from 'preact/hooks';
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
  const pollTimer = useRef<number | null>(null);

  const reload = async () => {
    try {
      const [d, s] = await Promise.all([api.listDrives(), api.listScans()]);
      setDrives(d);
      setScans(s as ScanRecord[]);
      if (!driveId && d.length > 0) setDriveId(d[0]!.id);
      return s as ScanRecord[];
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  };

  useEffect(() => {
    reload();
    return () => {
      if (pollTimer.current !== null) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, []);

  // While any scan is running or paused, poll every 1.5s.
  useEffect(() => {
    const anyActive = scans.some((s) => s.status === 'running' || s.status === 'paused');
    if (anyActive && pollTimer.current === null) {
      pollTimer.current = window.setInterval(() => {
        reload();
      }, 1500);
    } else if (!anyActive && pollTimer.current !== null) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, [scans]);

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
      setTimeout(reload, 200);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const activeScans = scans.filter((s) => s.status === 'running' || s.status === 'paused');
  const completedScans = scans.filter((s) => s.status !== 'running' && s.status !== 'paused');

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

      {activeScans.length > 0 ? (
        <div class="card">
          <h2>Active scans <span class="muted" style="font-size:0.7em">(updating live)</span></h2>
          {activeScans.map((s) => (
            <div key={s.id} style="margin-bottom:12px">
              <div>
                <strong>{s.rootPaths.join(', ') || s.driveId.slice(0, 8) + '…'}</strong>
                <span class="muted"> · {s.status} · {s.throttleProfile}</span>
              </div>
              <div class="muted">
                {s.progress?.filesSeen ?? 0} files seen ·{' '}
                {s.progress?.filesIndexed ?? 0} indexed ·{' '}
                {s.progress?.filesSkipped ?? 0} skipped ·{' '}
                {formatBytes(s.progress?.bytesProcessed ?? 0)} processed
              </div>
              {s.progress?.lastCompletedDirectory ? (
                <div class="muted" style="font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  in: {s.progress.lastCompletedDirectory}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div class="card">
        <h2>Recent scans</h2>
        {completedScans.length === 0 ? <p class="muted">No completed scans yet.</p> : (
          <table>
            <thead>
              <tr><th>Started</th><th>Drive</th><th>Status</th><th>Files indexed</th><th>Errors</th></tr>
            </thead>
            <tbody>
              {completedScans.map((s) => (
                <tr key={s.id}>
                  <td>{formatTime(s.startedAt)}</td>
                  <td>{s.driveId.slice(0, 8)}…</td>
                  <td>{s.status}</td>
                  <td>{s.progress?.filesIndexed ?? 0}</td>
                  <td>{s.stats?.errors ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
