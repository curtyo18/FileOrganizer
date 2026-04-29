import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import { route } from 'preact-router';
import type { DriveRecord, ScanRecord } from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';
import { Icon, driveIconName } from '../components/icon.js';
import {
  formatBytes,
  formatNum,
  driveColor,
  driveLetter,
  fillPercent,
  relativeTime,
} from '../lib/format.js';

interface ActionCardProps {
  kind: 'ok' | 'warn' | 'info' | 'danger' | 'muted';
  title: string;
  sub: string;
  cta: string;
  href: string;
}

function ActionCard({ kind, title, sub, cta, href }: ActionCardProps) {
  return (
    <div class="card" style={{ padding: 12, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span class={`dot ${kind}`} style={{ marginTop: 5 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{sub}</div>
        </div>
      </div>
      <button
        class="btn sm"
        style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
        onClick={() => route(href)}
      >
        {cta} →
      </button>
    </div>
  );
}

function DriveRow({ d }: { d: DriveRecord }) {
  const pct = fillPercent(d.totalBytes, d.freeBytes);
  const usedBytes = Math.max(0, d.totalBytes - d.freeBytes);
  const ltr = driveLetter(d.currentLetter, d.label.charAt(0).toUpperCase());
  const color = driveColor(d.currentLetter ?? d.label);
  const status = 'ok';
  return (
    <div
      style={{
        padding: '10px 10px',
        display: 'grid',
        gridTemplateColumns: '32px 1fr auto auto',
        gap: 12,
        alignItems: 'center',
        borderRadius: 4,
      }}
    >
      <div
        class="drive-glyph"
        style={{
          borderColor: color,
          color: color,
          borderLeft: `3px solid ${color}`,
        }}
      >
        <Icon name={driveIconName(d.kind)} size={13} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span class={`dot ${status}`} />
          <span style={{ fontWeight: 500, fontSize: 12 }}>{d.label}</span>
          <span class="mono" style={{ color: 'var(--fg-3)' }}>{d.currentLetter ?? ltr}</span>
          <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>· {d.kind}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div class="bar" style={{ flex: 1, maxWidth: 280 }}>
            <i
              style={{
                width: pct + '%',
                background: pct > 90 ? 'var(--danger)' : pct > 75 ? 'var(--warn)' : color,
              }}
            />
          </div>
          <span
            class="mono tnum"
            style={{ fontSize: 10.5, color: 'var(--fg-2)', minWidth: 130, textAlign: 'right' }}
          >
            {formatBytes(usedBytes)} / {formatBytes(d.totalBytes)}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
        {d.roles.slice(0, 2).map((r) => (
          <span key={r} class="pill" style={{ fontSize: 9.5 }}>{r}</span>
        ))}
        {d.roles.length > 2 && (
          <span style={{ fontSize: 9.5, color: 'var(--fg-3)' }}>+{d.roles.length - 2}</span>
        )}
        {d.roles.length === 0 && (
          <span style={{ fontSize: 9.5, color: 'var(--fg-3)' }}>no roles</span>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--fg-2)', textAlign: 'right' }}>
        <div class="label-cap" style={{ marginBottom: 2, fontSize: 9 }}>seen</div>
        <div class="mono">{relativeTime(d.lastSeenAt)}</div>
      </div>
    </div>
  );
}

function ActivityFeed({ scans, drives }: { scans: ScanRecord[]; drives: DriveRecord[] }) {
  const recent = scans.slice(0, 12);
  const driveById = new Map(drives.map((d) => [d.id, d]));

  return (
    <div class="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div class="card-hd">
        <Icon name="history" />
        <span>Activity</span>
        {scans.some((s) => s.status === 'running') ? (
          <span class="dot scanning" style={{ marginLeft: 4 }} />
        ) : null}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>
          {scans.length === 0 ? 'no activity' : 'last 12'}
        </span>
      </div>
      <div style={{ padding: '4px 0', flex: 1, overflowY: 'auto' }}>
        {recent.length === 0 ? (
          <div style={{ padding: '20px 14px', color: 'var(--fg-3)', fontSize: 11.5 }}>
            Run a scan to see activity here.
          </div>
        ) : (
          recent.map((s, i) => {
            const drive = driveById.get(s.driveId);
            const kindPill =
              s.status === 'completed'
                ? { bg: 'oklch(0.78 0.13 155 / 0.14)', fg: 'var(--ok)', text: 'COMPLETED' }
                : s.status === 'running'
                  ? { bg: 'var(--accent-bg)', fg: 'var(--accent)', text: 'SCAN' }
                  : s.status === 'failed'
                    ? { bg: 'oklch(0.70 0.18 25 / 0.14)', fg: 'var(--danger)', text: 'FAILED' }
                    : { bg: 'var(--bg-3)', fg: 'var(--fg-1)', text: s.status.toUpperCase() };
            return (
              <div
                key={s.id}
                style={{
                  padding: '8px 14px',
                  display: 'grid',
                  gridTemplateColumns: 'auto auto 1fr',
                  gap: 10,
                  alignItems: 'baseline',
                  borderBottom: i < recent.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                <span class="mono" style={{ color: 'var(--fg-3)', fontSize: 10 }}>
                  {relativeTime(s.startedAt)}
                </span>
                <span
                  class="pill"
                  style={{
                    background: kindPill.bg,
                    color: kindPill.fg,
                    fontSize: 9.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {kindPill.text}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--fg-1)' }}>
                  {drive?.label ?? s.driveId.slice(0, 8) + '…'}
                  {s.progress?.filesIndexed ? (
                    <span class="mono tnum" style={{ color: 'var(--fg-3)', marginLeft: 6 }}>
                      {formatNum(s.progress.filesIndexed)} indexed
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function Dashboard(_props: RoutableProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [scans, setScans] = useState<ScanRecord[]>([]);

  const reload = () => {
    api.listDrives().then(setDrives).catch(() => {});
    api.listScans().then((s) => setScans(s as ScanRecord[])).catch(() => {});
  };

  useEffect(() => {
    reload();
    const interval = window.setInterval(reload, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        height: '100%',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <ActionCard
          kind="muted"
          title="Duplicates"
          sub="byte-identical groups across drives"
          cta="Open"
          href="/duplicates"
        />
        <ActionCard
          kind="muted"
          title="Organize plan"
          sub="plan, dry-run, apply rule moves"
          cta="Open"
          href="/organize"
        />
        <ActionCard
          kind="info"
          title="Scan a drive"
          sub="paste any folder path"
          cta="Open"
          href="/scans"
        />
        <ActionCard
          kind="ok"
          title="Browse catalog"
          sub={drives.length > 0 ? `${drives.length} drives indexed` : 'no drives yet'}
          cta="Open"
          href="/browse"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, minHeight: 0 }}>
        <div class="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div class="card-hd">
            <Icon name="drive" />
            <span>Drives</span>
            <span class="pill">{drives.length}</span>
            <div style={{ flex: 1 }} />
            <button
              class="btn sm ghost"
              onClick={() => route('/scans')}
              title="Add a drive by scanning a folder on it"
            >
              <Icon name="plus" size={11} /> Add
            </button>
          </div>
          <div style={{ padding: 4 }}>
            {drives.length === 0 ? (
              <div style={{ padding: '20px 14px', color: 'var(--fg-3)', fontSize: 11.5 }}>
                No drives registered yet. Go to{' '}
                <a href="/scans" onClick={(e) => { e.preventDefault(); route('/scans'); }} style={{ color: 'var(--accent)' }}>Scans</a>
                {' '}and paste a folder path to add your first drive.
              </div>
            ) : (
              drives.map((d) => <DriveRow key={d.id} d={d} />)
            )}
          </div>
        </div>
        <ActivityFeed scans={scans} drives={drives} />
      </div>
    </div>
  );
}
