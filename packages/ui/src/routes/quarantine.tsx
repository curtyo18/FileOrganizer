import type { RoutableProps } from 'preact-router';
import { Icon } from '../components/icon.js';

export function Quarantine(_props: RoutableProps) {
  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card">
        <div class="card-hd">
          <Icon name="quarantine" />
          <span>Quarantine</span>
          <span class="pill warn">M4 in progress</span>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)' }}>
          <Icon name="quarantine" size={32} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Quarantine browser is wired up alongside dedup in M4.
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            Files removed by the tool land in <code class="mono">_FileOrganizer_quarantine</code>{' '}
            on each drive and are restorable until purged.
          </div>
        </div>
      </div>
    </div>
  );
}
