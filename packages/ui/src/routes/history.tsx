import type { RoutableProps } from 'preact-router';
import { Icon } from '../components/icon.js';

export function History(_props: RoutableProps) {
  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card">
        <div class="card-hd">
          <Icon name="history" />
          <span>History</span>
          <span class="pill warn">M5 not yet built</span>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)' }}>
          <Icon name="history" size={32} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Batch history with per-batch undo lands with the rules engine in M5.
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            For now, scan history is on the Scans page.
          </div>
        </div>
      </div>
    </div>
  );
}
