import { route } from 'preact-router';
import { Icon } from './icon.js';
import { formatBytes } from '../lib/format.js';

interface NavItem {
  id: string;
  href: string;
  label: string;
  icon: string;
  kbd?: string;
  count?: string | null;
  sub?: string | null;
  live?: boolean;
  highlight?: boolean;
}

interface SidebarProps {
  active: string;
  driveCount: number;
  scanIsLive: boolean;
  duplicateGroupCount?: number;
  ruleCount?: number;
  quarantineBytes?: number;
}

export function Sidebar(props: SidebarProps) {
  const items: (NavItem | null)[] = [
    { id: 'dashboard', href: '/', label: 'Dashboard', icon: 'scan', kbd: 'g d' },
    {
      id: 'drives',
      href: '/drives',
      label: 'Drives',
      icon: 'drive',
      kbd: 'g v',
      count: props.driveCount > 0 ? String(props.driveCount) : null,
    },
    {
      id: 'scans',
      href: '/scans',
      label: 'Scans',
      icon: 'scan',
      kbd: 'g s',
      live: props.scanIsLive,
    },
    { id: 'browse', href: '/browse', label: 'Browse', icon: 'folder', kbd: 'g b' },
    null,
    {
      id: 'organize',
      href: '/organize',
      label: 'Organize',
      icon: 'rules',
      kbd: 'g o',
      count: props.ruleCount && props.ruleCount > 0 ? String(props.ruleCount) : null,
    },
    {
      id: 'duplicates',
      href: '/duplicates',
      label: 'Duplicates',
      icon: 'dupes',
      kbd: 'g u',
      count:
        props.duplicateGroupCount && props.duplicateGroupCount > 0
          ? String(props.duplicateGroupCount)
          : null,
      highlight: true,
    },
    null,
    { id: 'history', href: '/history', label: 'History', icon: 'history', kbd: 'g h' },
    {
      id: 'quarantine',
      href: '/quarantine',
      label: 'Quarantine',
      icon: 'quarantine',
      kbd: 'g q',
      sub: props.quarantineBytes && props.quarantineBytes > 0 ? formatBytes(props.quarantineBytes) : null,
    },
  ];

  return (
    <aside
      style={{
        width: 220,
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100%',
      }}
    >
      <div style={{ padding: '14px 14px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: 'linear-gradient(135deg, var(--accent), oklch(0.58 0.13 50))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            fontSize: 11,
            color: '#1a120a',
          }}
        >
          fo
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>FileOrganizer</div>
          <div style={{ fontSize: 10, color: 'var(--fg-2)', fontFamily: 'var(--mono)' }}>
            local
          </div>
        </div>
      </div>

      <div style={{ padding: '0 8px 8px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 8px',
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            color: 'var(--fg-2)',
            fontSize: 11.5,
            cursor: 'text',
          }}
          title="Search (coming soon)"
        >
          <Icon name="search" size={12} />
          <span>Search…</span>
          <span style={{ marginLeft: 'auto' }} class="kbd">/</span>
        </div>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        {items.map((it, i) =>
          it === null ? (
            <div key={`d-${i}`} class="div-h" />
          ) : (
            <a
              key={it.id}
              href={it.href}
              onClick={(e) => {
                e.preventDefault();
                route(it.href);
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 8px',
                borderRadius: 4,
                background: props.active === it.id ? 'var(--bg-3)' : 'transparent',
                color: props.active === it.id ? 'var(--fg-0)' : 'var(--fg-1)',
                fontSize: 12,
                fontWeight: props.active === it.id ? 500 : 400,
                marginBottom: 1,
              }}
            >
              <Icon name={it.icon} size={13} />
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.live ? <span class="dot scanning" /> : null}
              {it.count ? (
                <span
                  class={it.highlight ? 'pill accent' : ''}
                  style={
                    it.highlight
                      ? { fontSize: 10 }
                      : { fontSize: 10.5, color: 'var(--fg-2)', fontFamily: 'var(--mono)' }
                  }
                >
                  {it.count}
                </span>
              ) : null}
              {it.sub ? <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{it.sub}</span> : null}
            </a>
          ),
        )}
      </nav>

      <div style={{ padding: 10, borderTop: '1px solid var(--line)', fontSize: 11 }}>
        <div class="label-cap" style={{ marginBottom: 6 }}>throttle</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {(['idle', 'balanced', 'full-send'] as const).map((p) => {
            const active = p === 'balanced';
            return (
              <div
                key={p}
                style={{
                  flex: 1,
                  padding: '3px 4px',
                  borderRadius: 3,
                  fontSize: 10,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: active ? 'var(--accent-bg)' : 'var(--bg-2)',
                  color: active ? 'var(--accent)' : 'var(--fg-2)',
                  border: active ? '1px solid var(--accent-line)' : '1px solid transparent',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {p}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--mono)' }}>
          balanced · profile defaults
        </div>
      </div>
    </aside>
  );
}
