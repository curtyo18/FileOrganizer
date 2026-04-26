import type { RoutableProps } from 'preact-router';
import { Icon } from '../components/icon.js';

export function Duplicates(_props: RoutableProps) {
  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card">
        <div class="card-hd">
          <Icon name="dupes" />
          <span>Duplicates</span>
          <span class="pill warn">M4 in progress</span>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)' }}>
          <Icon name="dupes" size={32} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Duplicate detection is shipping in milestone M4.
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            The detection engine is built (byte-identical hash matching across drives). The UI for
            reviewing groups, scoring keepers, and approving quarantine batches lands next.
          </div>
        </div>
      </div>
    </div>
  );
}
