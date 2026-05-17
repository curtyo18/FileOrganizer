import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord, ScanRecord } from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';
import { Icon } from '../components/icon.js';
import { FolderPickerModal } from '../components/folder-picker.js';
import { formatBytes, formatNum, relativeTime } from '../lib/format.js';

type Profile = 'idle' | 'balanced' | 'full-send';

export function Scans(_props: RoutableProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [pathInput, setPathInput] = useState('');
  const [profile, setProfile] = useState<Profile>('balanced');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Polling runs unconditionally from mount so a transient failure on first
  // load never permanently disables live progress updates. The interval simply
  // retries on each tick; errors are surfaced to the engine-offline indicator
  // in the top bar via the global reloadGlobal failure counter (Sub-fix A).
  const POLL_INTERVAL_MS = 1500;

  const reload = async () => {
    try {
      const [d, s] = await Promise.all([api.listDrives(), api.listScans()]);
      setDrives(d);
      setScans(s as ScanRecord[]);
    } catch {
      // Swallow per-tick errors here; the global App-level polling (Sub-fix A)
      // surfaces persistent engine-offline state to the user.
    }
  };

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => { void reload(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const onScan = async () => {
    setError(null);
    setInfo(null);
    if (!pathInput.trim()) {
      setError('Enter a path');
      return;
    }
    setStarting(true);
    const target = pathInput.trim();
    try {
      await api.startScan({ rootPath: target, profile });
      setInfo(`Scan started for ${target}`);
      setPathInput('');
      setTimeout(reload, 200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const driveById = new Map(drives.map((d) => [d.id, d]));
  const activeScans = scans.filter((s) => s.status === 'running' || s.status === 'paused');
  const completedScans = scans.filter((s) => s.status !== 'running' && s.status !== 'paused');

  const onCancel = async (scanId: string) => {
    if (!window.confirm('Cancel scan?')) return;
    try {
      await api.cancelScan(scanId);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflowY: 'auto' }}>
      <div class="card">
        <div class="card-hd">
          <Icon name="scan" />
          <span>Scan a folder</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
            drive auto-detected from path
          </span>
        </div>
        <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="D:\Pictures or /home/user/photos"
            value={pathInput}
            onInput={(e) => setPathInput((e.target as HTMLInputElement).value)}
            style={{ flex: 1, minWidth: 240 }}
            disabled={starting}
          />
          <button class="btn ghost" onClick={() => setPickerOpen(true)} disabled={starting}>
            <Icon name="folder" size={11} /> Browse…
          </button>
          <select
            value={profile}
            onChange={(e) => setProfile((e.target as HTMLSelectElement).value as Profile)}
            disabled={starting}
          >
            <option value="idle">idle</option>
            <option value="balanced">balanced</option>
            <option value="full-send">full-send</option>
          </select>
          <button class="btn primary" onClick={onScan} disabled={starting}>
            <Icon name="play" size={11} /> {starting ? 'Starting scan…' : 'Scan'}
          </button>
        </div>
        {error ? (
          <div style={{ padding: '0 14px 14px', color: 'var(--danger)', fontSize: 11.5 }}>{error}</div>
        ) : null}
        {info ? (
          <div style={{ padding: '0 14px 14px', color: 'var(--fg-2)', fontSize: 11.5 }}>{info}</div>
        ) : null}
      </div>

      {activeScans.length > 0 ? (
        <div class="card">
          <div class="card-hd">
            <Icon name="scan" />
            <span>Active scans</span>
            <span class="dot scanning" style={{ marginLeft: 4 }} />
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>updating live</span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {activeScans.map((s) => {
              const drive = driveById.get(s.driveId);
              return (
                <div key={s.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span class="dot scanning" />
                    <span style={{ fontWeight: 500 }}>
                      {drive?.label ?? s.driveId.slice(0, 8) + '…'}
                    </span>
                    <span class="pill accent" style={{ fontSize: 9.5 }}>{s.throttleProfile}</span>
                    <span class="pill" style={{ fontSize: 9.5 }}>{s.status}</span>
                    {s.rootPaths.length > 0 ? (
                      <span class="mono" style={{ color: 'var(--fg-3)', fontSize: 10.5 }}>
                        {s.rootPaths.join(', ')}
                      </span>
                    ) : null}
                    <div style={{ flex: 1 }} />
                    <button
                      class="btn ghost sm"
                      onClick={() => onCancel(s.id)}
                      title="Cancel scan"
                    >
                      Stop
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 18, fontSize: 11, color: 'var(--fg-2)' }}>
                    <span>
                      <span class="label-cap" style={{ marginRight: 5 }}>seen</span>
                      <span class="mono tnum" style={{ color: 'var(--fg-1)' }}>
                        {formatNum(s.progress?.filesSeen ?? 0)}
                      </span>
                    </span>
                    <span>
                      <span class="label-cap" style={{ marginRight: 5 }}>indexed</span>
                      <span class="mono tnum" style={{ color: 'var(--accent)' }}>
                        {formatNum(s.progress?.filesIndexed ?? 0)}
                      </span>
                    </span>
                    <span>
                      <span class="label-cap" style={{ marginRight: 5 }}>skipped</span>
                      <span class="mono tnum" style={{ color: 'var(--fg-1)' }}>
                        {formatNum(s.progress?.filesSkipped ?? 0)}
                      </span>
                    </span>
                    <span>
                      <span class="label-cap" style={{ marginRight: 5 }}>processed</span>
                      <span class="mono tnum" style={{ color: 'var(--fg-1)' }}>
                        {formatBytes(s.progress?.bytesProcessed ?? 0)}
                      </span>
                    </span>
                  </div>
                  {s.progress?.lastCompletedDirectory ? (
                    <div
                      class="mono"
                      style={{
                        marginTop: 4,
                        fontSize: 10.5,
                        color: 'var(--fg-3)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      in: {s.progress.lastCompletedDirectory}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div class="card">
        <div class="card-hd">
          <Icon name="history" />
          <span>Recent scans</span>
          <span class="pill">{completedScans.length}</span>
        </div>
        {completedScans.length === 0 ? (
          <div style={{ padding: 14, color: 'var(--fg-3)', fontSize: 11.5 }}>
            No completed scans yet.
          </div>
        ) : (
          <table class="tbl">
            <thead>
              <tr>
                <th>Started</th>
                <th>Drive</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 110 }}>Profile</th>
                <th style={{ width: 100, textAlign: 'right' }}>Indexed</th>
                <th style={{ width: 80, textAlign: 'right' }}>Errors</th>
              </tr>
            </thead>
            <tbody>
              {completedScans.map((s) => {
                const drive = driveById.get(s.driveId);
                const statusClass =
                  s.status === 'completed'
                    ? 'ok'
                    : s.status === 'failed'
                      ? 'danger'
                      : s.status === 'cancelled'
                        ? 'warn'
                        : '';
                return (
                  <tr key={s.id}>
                    <td class="mono" style={{ color: 'var(--fg-2)' }}>
                      {relativeTime(s.startedAt)}
                    </td>
                    <td>{drive?.label ?? s.driveId.slice(0, 8) + '…'}</td>
                    <td>
                      <span class={`pill ${statusClass}`} style={{ fontSize: 9.5 }}>
                        {s.status}
                      </span>
                    </td>
                    <td class="mono" style={{ color: 'var(--fg-2)' }}>
                      {s.throttleProfile}
                    </td>
                    <td class="mono tnum" style={{ textAlign: 'right' }}>
                      {formatNum(s.progress?.filesIndexed ?? 0)}
                    </td>
                    <td class="mono tnum" style={{ textAlign: 'right', color: 'var(--fg-2)' }}>
                      {s.stats?.errors ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pickerOpen ? (
        <FolderPickerModal
          initialPath={pathInput.trim() || '/'}
          onSelect={(p) => {
            setPathInput(p);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
