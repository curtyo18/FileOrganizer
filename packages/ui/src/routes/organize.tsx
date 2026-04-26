import type { RoutableProps } from 'preact-router';
import { Icon } from '../components/icon.js';

export function Organize(_props: RoutableProps) {
  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card">
        <div class="card-hd">
          <Icon name="rules" />
          <span>Organize</span>
          <span class="pill warn">M5 not yet built</span>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)' }}>
          <Icon name="rules" size={32} />
          <div style={{ marginTop: 10, fontSize: 13 }}>
            Rules editor and plan/review queue are landing in milestone M5.
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            You'll define rules like "photos older than 2 years → media-archive role", run the
            planner, and approve cross-drive moves with full undo.
          </div>
        </div>
      </div>
    </div>
  );
}
