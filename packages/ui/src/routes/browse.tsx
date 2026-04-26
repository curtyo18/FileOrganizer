import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord } from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';
import { Icon } from '../components/icon.js';
import { formatBytes, driveColor, driveLetter } from '../lib/format.js';

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

  const drive = drives.find((d) => d.id === driveId);
  const driveColorVal = drive ? driveColor(drive.currentLetter ?? drive.label) : '#888';
  const ltr = drive ? driveLetter(drive.currentLetter, drive.label.charAt(0).toUpperCase()) : '?';

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflowY: 'auto' }}>
      <div class="card">
        <div class="card-hd">
          <Icon name="folder" />
          <span>Browse</span>
          <div style={{ flex: 1 }} />
          <select value={driveId} onChange={(e) => { setOffset(0); setDriveId((e.target as HTMLSelectElement).value); }}>
            {drives.map((d) => <option value={d.id}>{d.label}</option>)}
          </select>
          <button
            class="btn sm ghost"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            ← Prev
          </button>
          <button
            class="btn sm ghost"
            disabled={files.length < limit}
            onClick={() => setOffset(offset + limit)}
          >
            Next →
          </button>
          <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
            rows {files.length === 0 ? 0 : offset + 1}–{offset + files.length}
          </span>
        </div>
        {!drive ? (
          <div style={{ padding: 14, color: 'var(--fg-3)', fontSize: 11.5 }}>
            No drives — go to Scans and add one.
          </div>
        ) : files.length === 0 ? (
          <div style={{ padding: 14, color: 'var(--fg-3)', fontSize: 11.5 }}>No files indexed on this drive yet.</div>
        ) : (
          <table class="tbl">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Path</th>
                <th style={{ width: 90 }}>Cat</th>
                <th style={{ width: 100, textAlign: 'right' }}>Size</th>
                <th style={{ width: 130 }}>Date</th>
                <th style={{ width: 110 }}>SHA-256</th>
                <th style={{ width: 90 }}>State</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 2,
                        background: driveColorVal,
                        fontFamily: 'var(--mono)',
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#000',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {ltr}
                    </span>
                  </td>
                  <td class="mono" style={{ fontSize: 10.5, color: 'var(--fg-1)' }}>
                    {f.path}
                  </td>
                  <td>
                    <span class="pill" style={{ fontSize: 9.5 }}>{f.category}</span>
                  </td>
                  <td class="mono tnum" style={{ textAlign: 'right', color: 'var(--fg-2)' }}>
                    {formatBytes(f.sizeBytes)}
                  </td>
                  <td class="mono" style={{ color: 'var(--fg-2)' }}>
                    {(f.exifDate ?? f.mtime).slice(0, 10)}
                  </td>
                  <td class="mono" style={{ color: 'var(--fg-3)' }} title={f.sha256}>
                    {f.sha256.slice(0, 8)}…
                  </td>
                  <td>
                    <span
                      class={`pill ${f.state === 'indexed' ? 'ok' : f.state === 'quarantined' ? 'warn' : ''}`}
                      style={{ fontSize: 9.5 }}
                    >
                      {f.state}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
