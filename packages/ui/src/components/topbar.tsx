import type { DriveRecord } from '@fileorganizer/shared';
import { Icon } from './icon.js';
import { driveLetter, fillPercent } from '../lib/format.js';

interface TopBarProps {
  section: string;
  drives: DriveRecord[];
}

export function TopBar({ section, drives }: TopBarProps) {
  const sectionLabel = section ? section.charAt(0).toUpperCase() + section.slice(1) : 'Dashboard';
  return (
    <div
      style={{
        height: 38,
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-1)',
        flexShrink: 0,
        fontSize: 11.5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-2)' }}>
        <span>FileOrganizer</span>
        <Icon name="chevron" size={10} />
        <span style={{ color: 'var(--fg-0)' }}>{sectionLabel}</span>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {drives.slice(0, 8).map((d) => {
          const pct = fillPercent(d.totalBytes, d.freeBytes);
          const ltr = driveLetter(d.currentLetter, d.label.charAt(0).toUpperCase());
          return (
            <div
              key={d.id}
              title={`${d.label} · ${d.currentLetter ?? '—'}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 3,
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                fontSize: 10.5,
                fontFamily: 'var(--mono)',
              }}
            >
              <span class="dot ok" />
              <span style={{ color: 'var(--fg-1)' }}>{ltr}</span>
              <span style={{ color: 'var(--fg-3)' }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
