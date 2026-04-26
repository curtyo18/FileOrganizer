import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord } from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';
import { Icon, driveIconName } from '../components/icon.js';
import { formatBytes, driveColor, driveLetter, fillPercent, relativeTime } from '../lib/format.js';

export function Drives(_props: RoutableProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listDrives().then(setDrives).catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card">
        <div class="card-hd">
          <Icon name="drive" />
          <span>Drives</span>
          <span class="pill">{drives.length}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
            roles will be editable in M6
          </span>
        </div>
        {error ? (
          <div style={{ padding: 14, color: 'var(--danger)', fontSize: 11.5 }}>{error}</div>
        ) : drives.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--fg-3)', fontSize: 11.5 }}>
            No drives registered yet.
          </div>
        ) : (
          <table class="tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>Label</th>
                <th style={{ width: 70 }}>Letter</th>
                <th style={{ width: 90 }}>Kind</th>
                <th>Capacity</th>
                <th>Roles</th>
                <th style={{ width: 100 }}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {drives.map((d) => {
                const pct = fillPercent(d.totalBytes, d.freeBytes);
                const used = Math.max(0, d.totalBytes - d.freeBytes);
                const ltr = driveLetter(d.currentLetter, d.label.charAt(0).toUpperCase());
                const color = driveColor(d.currentLetter ?? d.label);
                return (
                  <tr key={d.id}>
                    <td>
                      <div
                        class="drive-glyph"
                        style={{
                          color: color,
                          borderLeft: `3px solid ${color}`,
                        }}
                      >
                        <Icon name={driveIconName(d.kind)} size={13} />
                      </div>
                    </td>
                    <td style={{ fontWeight: 500 }}>{d.label}</td>
                    <td class="mono" style={{ color: 'var(--fg-2)' }}>
                      {d.currentLetter ?? ltr}
                    </td>
                    <td style={{ color: 'var(--fg-2)' }}>{d.kind}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div class="bar" style={{ flex: 1, maxWidth: 200 }}>
                          <i
                            style={{
                              width: pct + '%',
                              background:
                                pct > 90
                                  ? 'var(--danger)'
                                  : pct > 75
                                    ? 'var(--warn)'
                                    : color,
                            }}
                          />
                        </div>
                        <span
                          class="mono tnum"
                          style={{ fontSize: 10.5, color: 'var(--fg-2)', minWidth: 130, textAlign: 'right' }}
                        >
                          {formatBytes(used)} / {formatBytes(d.totalBytes)}
                        </span>
                      </div>
                    </td>
                    <td>
                      {d.roles.length === 0 ? (
                        <span style={{ color: 'var(--fg-3)' }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {d.roles.map((r) => (
                            <span key={r} class="pill" style={{ fontSize: 9.5 }}>{r}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td class="mono" style={{ color: 'var(--fg-2)' }}>
                      {relativeTime(d.lastSeenAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
