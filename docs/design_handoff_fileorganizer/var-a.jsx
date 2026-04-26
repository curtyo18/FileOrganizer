/* Variation A — Dense sidebar layout
 * Linear/TablePlus energy. Left rail nav, top bar, dense data tables.
 * Surfaces: Dashboard, Duplicates, Organize.
 */

const { useState, useMemo, useEffect, useRef } = React;
const D = window.FOData;

// ─────────────────────────────────────────────────────────────
// shared atoms
// ─────────────────────────────────────────────────────────────
const fmtSize = (gb) => {
  if (gb < 0.001) return (gb * 1024 * 1024).toFixed(0) + ' KB';
  if (gb < 1) return (gb * 1024).toFixed(1) + ' MB';
  if (gb < 1000) return gb.toFixed(1) + ' GB';
  return (gb / 1024).toFixed(2) + ' TB';
};
const fmtNum = (n) => n.toLocaleString();
const driveColor = (id) => ({ C: '#a78ce8', D: '#69b8d4', E: '#e89a4d', N: '#d47878', X: '#8a8e96' }[id] || '#888');

const Icon = ({ name, size = 14 }) => {
  const paths = {
    drive: 'M2 4h12v8H2zM4 12v2M12 12v2',
    folder: 'M2 4h4l1 1h7v8H2z',
    search: 'M7 12a5 5 0 100-10 5 5 0 000 10zM14 14l-3.5-3.5',
    scan: 'M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3M5 8h6',
    rules: 'M3 3h10M3 8h10M3 13h6',
    dupes: 'M5 5h7v7H5zM3 3h7v2M3 3v7h2',
    history: 'M8 4v4l2 2M2 8a6 6 0 106-6M2 8H1M2 8l1.5-1.5',
    quarantine: 'M3 6h10v8H3zM5 6V3h6v3',
    settings: 'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1v2M8 13v2M14 8h-2M4 8H2',
    chevron: 'M5 3l5 5-5 5',
    'chevron-d': 'M3 5l5 5 5-5',
    play: 'M4 3l8 5-8 5z',
    pause: 'M4 3h3v10H4zM9 3h3v10H9z',
    plus: 'M8 3v10M3 8h10',
    check: 'M3 8l3 3 7-7',
    x: 'M3 3l10 10M13 3L3 13',
    file: 'M4 2h6l2 2v10H4z',
    image: 'M2 3h12v10H2zM5 8l2 2 3-4 3 4',
    video: 'M2 4h8v8H2zM10 6l4-2v8l-4-2',
    nas: 'M2 4h12v3H2zM2 9h12v3H2zM4 5.5h.5M4 10.5h.5',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] || ''} />
    </svg>
  );
};

const driveIcon = (kind) => kind === 'network' ? 'nas' : 'drive';

// ─────────────────────────────────────────────────────────────
// Chrome
// ─────────────────────────────────────────────────────────────
function Sidebar({ active, onNav }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'scan', kbd: 'g d' },
    { id: 'drives', label: 'Drives', icon: 'drive', kbd: 'g v', count: '5' },
    { id: 'scans', label: 'Scans', icon: 'scan', kbd: 'g s', live: true },
    { id: 'browse', label: 'Browse', icon: 'folder', kbd: 'g b' },
    null,
    { id: 'organize', label: 'Organize', icon: 'rules', kbd: 'g o', count: '6' },
    { id: 'duplicates', label: 'Duplicates', icon: 'dupes', kbd: 'g u', count: '412', highlight: true },
    null,
    { id: 'history', label: 'History', icon: 'history', kbd: 'g h' },
    { id: 'quarantine', label: 'Quarantine', icon: 'quarantine', kbd: 'g q', sub: '4.2 GB' },
  ];
  return (
    <aside style={{
      width: 220, background: 'var(--bg-1)',
      borderRight: '1px solid var(--line)',
      display: 'flex', flexDirection: 'column',
      flexShrink: 0,
    }}>
      {/* Brand */}
      <div style={{ padding: '14px 14px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 5,
          background: 'linear-gradient(135deg, var(--accent), oklch(0.58 0.13 50))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 11, color: '#1a120a'
        }}>fo</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>FileOrganizer</div>
          <div style={{ fontSize: 10, color: 'var(--fg-2)', fontFamily: 'var(--mono)' }}>v0.6.2 · localhost:51842</div>
        </div>
      </div>

      <div style={{ padding: '0 8px 8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 8px', background: 'var(--bg-2)',
          border: '1px solid var(--line)', borderRadius: 4,
          color: 'var(--fg-2)', fontSize: 11.5, cursor: 'text'
        }}>
          <Icon name="search" size={12} />
          <span>Search…</span>
          <span style={{ marginLeft: 'auto' }} className="kbd">/</span>
        </div>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        {items.map((it, i) => it === null ? (
          <div key={i} className="div-h" />
        ) : (
          <button key={it.id} onClick={() => onNav(it.id)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 8px', borderRadius: 4,
              background: active === it.id ? 'var(--bg-3)' : 'transparent',
              color: active === it.id ? 'var(--fg-0)' : 'var(--fg-1)',
              border: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'left',
              fontSize: 12, fontWeight: active === it.id ? 500 : 400,
              marginBottom: 1,
            }}
            onMouseEnter={(e) => { if (active !== it.id) e.currentTarget.style.background = 'var(--bg-2)'; }}
            onMouseLeave={(e) => { if (active !== it.id) e.currentTarget.style.background = 'transparent'; }}>
            <Icon name={it.icon} size={13} />
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.live && <span className="dot scanning" />}
            {it.count && <span style={{ fontSize: 10.5, color: 'var(--fg-2)', fontFamily: 'var(--mono)' }}>{it.count}</span>}
            {it.sub && <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{it.sub}</span>}
          </button>
        ))}
      </nav>

      {/* Throttle status */}
      <div style={{ padding: 10, borderTop: '1px solid var(--line)', fontSize: 11 }}>
        <div className="label-cap" style={{ marginBottom: 6 }}>throttle</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {['idle', 'balanced', 'full-send'].map((p) => (
            <div key={p} style={{
              flex: 1, padding: '3px 4px', borderRadius: 3,
              fontSize: 10, textAlign: 'center', cursor: 'pointer',
              background: p === 'balanced' ? 'var(--accent-bg)' : 'var(--bg-2)',
              color: p === 'balanced' ? 'var(--accent)' : 'var(--fg-2)',
              border: p === 'balanced' ? '1px solid var(--accent-line)' : '1px solid transparent',
              fontWeight: p === 'balanced' ? 600 : 400,
            }}>{p}</div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--mono)' }}>
          auto · workday window · until 18:00
        </div>
      </div>
    </aside>
  );
}

function TopBar({ section }) {
  return (
    <div style={{
      height: 38, padding: '0 14px',
      display: 'flex', alignItems: 'center', gap: 14,
      borderBottom: '1px solid var(--line)',
      background: 'var(--bg-1)', flexShrink: 0,
      fontSize: 11.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-2)' }}>
        <span>FileOrganizer</span>
        <Icon name="chevron" size={10} />
        <span style={{ color: 'var(--fg-0)', textTransform: 'capitalize' }}>{section}</span>
      </div>
      <div style={{ flex: 1 }} />
      {/* Live drive status pills */}
      <div style={{ display: 'flex', gap: 6 }}>
        {D.drives.map((d) => (
          <div key={d.id} title={`${d.label} · ${d.letter}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 7px', borderRadius: 3,
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              fontSize: 10.5, fontFamily: 'var(--mono)',
              opacity: d.status === 'disconnected' ? 0.5 : 1,
            }}>
            <span className={`dot ${d.status === 'connected' ? 'ok' : d.status === 'scanning' ? 'scanning' : 'muted'}`} />
            <span style={{ color: 'var(--fg-1)' }}>{d.letter}</span>
            <span style={{ color: 'var(--fg-3)' }}>{((d.used/d.total)*100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
      <div className="div-v" style={{ height: 18 }} />
      <button className="btn ghost"><Icon name="settings" size={13} /></button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────
function Dashboard() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflowY: 'auto' }}>
      {/* Action strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <ActionCard kind="warn" title="412 duplicate groups" sub="28.4 GB reclaimable" cta="Review" />
        <ActionCard kind="info" title="2,103 cross-drive moves" sub="from current plan" cta="Open queue" />
        <ActionCard kind="muted" title="24,102 unsorted files" sub="no rule matches" cta="Triage" />
        <ActionCard kind="ok" title="Quarantine: 4.2 GB" sub="1,284 files · 30d retention" cta="Manage" />
      </div>

      {/* 2-col below */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
        <DriveCardGrid />
        <ActivityFeed />
      </div>

      <CategoryBreakdown />
    </div>
  );
}

function ActionCard({ kind, title, sub, cta }) {
  return (
    <div className="card" style={{ padding: 12, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span className={`dot ${kind}`} style={{ marginTop: 5 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{sub}</div>
        </div>
      </div>
      <button className="btn sm" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>{cta} →</button>
    </div>
  );
}

function DriveCardGrid() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="card-hd">
        <Icon name="drive" />
        <span>Drives</span>
        <span className="pill">{D.drives.length}</span>
        <div style={{ flex: 1 }} />
        <button className="btn sm ghost"><Icon name="plus" size={11} /> Add</button>
      </div>
      <div style={{ padding: 4 }}>
        {D.drives.map((d) => <DriveRow key={d.id} d={d} />)}
      </div>
    </div>
  );
}

function DriveRow({ d }) {
  const pct = (d.used / d.total) * 100;
  return (
    <div style={{
      padding: '10px 10px',
      display: 'grid', gridTemplateColumns: '32px 1fr auto auto', gap: 12, alignItems: 'center',
      borderRadius: 4,
    }}>
      <div className="drive-glyph" style={{ borderColor: driveColor(d.id), color: driveColor(d.id), borderLeft: `3px solid ${driveColor(d.id)}` }}>
        <Icon name={driveIcon(d.kind)} size={13} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span className={`dot ${d.status === 'connected' ? 'ok' : d.status === 'scanning' ? 'scanning' : 'muted'}`} />
          <span style={{ fontWeight: 500, fontSize: 12 }}>{d.label}</span>
          <span className="mono" style={{ color: 'var(--fg-3)' }}>{d.letter}</span>
          <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>· {d.kind.replace('-', ' ')}</span>
          {d.status === 'scanning' && <span className="pill accent">scanning · {(d.scanProgress * 100).toFixed(0)}%</span>}
          {d.status === 'disconnected' && <span className="pill danger">offline</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="bar" style={{ flex: 1, maxWidth: 280 }}>
            <i style={{ width: pct + '%', background: pct > 90 ? 'var(--danger)' : pct > 75 ? 'var(--warn)' : driveColor(d.id) }} />
          </div>
          <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--fg-2)', minWidth: 110 }}>
            {(d.used/1024).toFixed(2)} / {(d.total/1024).toFixed(1)} TB
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
        {d.roles.slice(0, 2).map((r) => <span key={r} className="pill" style={{ fontSize: 9.5 }}>{r}</span>)}
        {d.roles.length > 2 && <span style={{ fontSize: 9.5, color: 'var(--fg-3)' }}>+{d.roles.length - 2}</span>}
      </div>
      <div style={{ fontSize: 10, color: 'var(--fg-2)', textAlign: 'right' }}>
        <div className="label-cap" style={{ marginBottom: 2, fontSize: 9 }}>scanned</div>
        <div className="mono">{d.lastScan}</div>
      </div>
    </div>
  );
}

function ActivityFeed() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-hd">
        <Icon name="history" />
        <span>Activity</span>
        <span className="dot scanning" style={{ marginLeft: 4 }} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>live</span>
      </div>
      <div style={{ padding: '4px 0', flex: 1, overflowY: 'auto' }}>
        {D.activity.map((a, i) => (
          <div key={i} style={{
            padding: '8px 14px',
            display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: 10, alignItems: 'baseline',
            borderBottom: i < D.activity.length - 1 ? '1px solid var(--line)' : 'none',
          }}>
            <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 10 }}>{a.t}</span>
            <span className="pill" style={{
              background: { scan: 'var(--accent-bg)', dedupe: 'oklch(0.74 0.10 230 / 0.14)', apply: 'oklch(0.78 0.13 155 / 0.14)', throttle: 'var(--bg-3)' }[a.kind],
              color: { scan: 'var(--accent)', dedupe: 'var(--info)', apply: 'var(--ok)', throttle: 'var(--fg-1)' }[a.kind],
              fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>{a.kind}</span>
            <span style={{ fontSize: 11.5, color: 'var(--fg-1)' }}>{a.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryBreakdown() {
  const cats = [
    { name: 'Photos', size: 4820, color: 'oklch(0.74 0.14 70)', count: 218401 },
    { name: 'Video', size: 6210, color: 'oklch(0.70 0.13 30)', count: 8412 },
    { name: 'Audio', size: 821, color: 'oklch(0.78 0.13 155)', count: 24102 },
    { name: 'Documents', size: 412, color: 'oklch(0.74 0.10 230)', count: 80821 },
    { name: 'Code', size: 184, color: 'oklch(0.66 0.14 290)', count: 412821 },
    { name: 'Archives', size: 1820, color: 'oklch(0.70 0.05 60)', count: 1241 },
    { name: 'Other', size: 283, color: 'oklch(0.55 0 0)', count: 540123 },
  ];
  const total = cats.reduce((a, c) => a + c.size, 0);
  return (
    <div className="card">
      <div className="card-hd">
        <Icon name="rules" />
        <span>Library by category</span>
        <span className="pill">{fmtNum(D.summary.totalFiles)} files · {(total/1024).toFixed(2)} TB</span>
      </div>
      <div style={{ padding: 14 }}>
        <div className="seg-bar" style={{ marginBottom: 12 }}>
          {cats.map((c) => <span key={c.name} title={c.name} style={{ width: `${(c.size/total)*100}%`, background: c.color }} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
          {cats.map((c) => (
            <div key={c.name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                <span style={{ fontSize: 11, fontWeight: 500 }}>{c.name}</span>
              </div>
              <div className="mono tnum" style={{ fontSize: 11, color: 'var(--fg-1)' }}>{(c.size/1024).toFixed(2)} TB</div>
              <div className="mono tnum" style={{ fontSize: 9.5, color: 'var(--fg-3)' }}>{fmtNum(c.count)} files</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Duplicates
// ─────────────────────────────────────────────────────────────
function DuplicatesView() {
  const [selected, setSelected] = useState('g1');
  const group = D.dupGroups.find((g) => g.id === selected);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', height: '100%', minHeight: 0 }}>
      {/* Left: groups list */}
      <div style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="dupes" />
          <span style={{ fontWeight: 600 }}>{D.dupGroups.length} groups</span>
          <span className="pill warn">{D.summary.duplicatesReclaimable.toFixed(1)} GB</span>
          <div style={{ flex: 1 }} />
          <button className="btn sm ghost">filters</button>
        </div>
        <div style={{ padding: '6px 10px', display: 'flex', gap: 6, borderBottom: '1px solid var(--line)', fontSize: 11 }}>
          {['all', 'image', 'video', 'document'].map((f, i) => (
            <span key={f} style={{
              padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
              background: i === 0 ? 'var(--bg-3)' : 'transparent',
              color: i === 0 ? 'var(--fg-0)' : 'var(--fg-2)',
            }}>{f}</span>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ color: 'var(--fg-3)' }}>sort: reclaim ↓</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {D.dupGroups.map((g) => (
            <div key={g.id} onClick={() => setSelected(g.id)}
              style={{
                padding: '10px 14px', borderBottom: '1px solid var(--line)',
                cursor: 'pointer',
                background: selected === g.id ? 'var(--accent-bg)' : 'transparent',
                borderLeft: selected === g.id ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className="mono" style={{ color: 'var(--fg-2)', fontSize: 10 }}>{g.hash}</span>
                <span className={`pill`} style={{ fontSize: 9.5 }}>{g.category}</span>
                <div style={{ flex: 1 }} />
                <span className="mono tnum" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>+{fmtSize(g.reclaim/1024)}</span>
              </div>
              <div style={{ fontSize: 11.5, marginBottom: 4 }}>{g.copies[0].path.split('\\').pop()}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--fg-2)' }}>
                <span>{g.count} copies</span>
                <span>·</span>
                <span>{fmtSize(g.size/1024)} each</span>
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', gap: 2 }}>
                  {[...new Set(g.copies.map(c => c.drive))].map((dr) => (
                    <span key={dr} style={{
                      width: 14, height: 14, borderRadius: 2,
                      background: driveColor(dr), color: '#000',
                      fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{dr}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* Bulk bar */}
        <div style={{ padding: 10, borderTop: '1px solid var(--line)', background: 'var(--bg-1)', display: 'flex', gap: 6 }}>
          <button className="btn sm">approve all keepers</button>
          <button className="btn sm ghost">exclude NAS</button>
          <button className="btn sm ghost">&lt;100 KB</button>
        </div>
      </div>

      {/* Right: detail */}
      <DupDetail group={group} />
    </div>
  );
}

function DupDetail({ group }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Group · <span className="mono">{group.hash}</span></div>
          <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2 }}>
            {group.count} byte-identical copies · {fmtSize(group.size/1024)} each · reclaim <span style={{ color: 'var(--accent)' }}>{fmtSize(group.reclaim/1024)}</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn sm ghost">exclude group</button>
        <button className="btn sm ghost">change keeper…</button>
        <button className="btn primary sm">approve · quarantine {group.count - 1}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Preview row */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(group.copies.length, 4)}, 1fr)`, gap: 10 }}>
          {group.copies.slice(0, 4).map((c, i) => (
            <div key={i} className="card" style={{ overflow: 'hidden', position: 'relative' }}>
              <div className="stripe" style={{
                aspectRatio: '4/3',
                background: c.keeper ? `linear-gradient(135deg, oklch(0.74 0.14 70 / 0.4), oklch(0.5 0.08 50 / 0.4))` : 'var(--bg-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--fg-3)', fontSize: 11, fontFamily: 'var(--mono)',
              }}>
                {group.category === 'image' ? <Icon name="image" size={28} /> : group.category === 'video' ? <Icon name="video" size={28} /> : <Icon name="file" size={28} />}
              </div>
              <div style={{ padding: 10 }}>
                {c.keeper && <span className="pill ok" style={{ marginBottom: 6 }}>✓ keeper · score {c.score}</span>}
                {!c.keeper && <span className="pill" style={{ marginBottom: 6 }}>score {c.score}</span>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, marginBottom: 4 }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: 2, background: driveColor(c.drive),
                    fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, color: '#000',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{c.drive}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.path}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)' }} className="mono">mtime {c.mtime}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Score breakdown */}
        <div className="card">
          <div className="card-hd">
            <span>Why this keeper?</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: 'var(--fg-2)' }}>tiebreaker order</span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {[
              { name: 'Drive role priority', val: 'media-archive on E:', win: true, weight: '1.0' },
              { name: 'Most-organized location', val: 'matches Photos/{year}/{month:02} template', win: true, weight: '0.8' },
              { name: 'Path depth', val: 'depth 3', win: true, weight: '0.5' },
              { name: 'Drive kind', val: 'local-hdd > nas > external', win: true, weight: '0.3' },
              { name: 'Filesystem mtime', val: '2019-06-14 (oldest)', win: true, weight: '0.2' },
              { name: 'Lexicographic', val: '— stable —', win: false, weight: '0.1' },
            ].map((r, i) => (
              <div key={i} style={{ padding: '7px 14px', display: 'grid', gridTemplateColumns: '160px 1fr 60px', gap: 12, fontSize: 11.5, alignItems: 'center', borderBottom: i < 5 ? '1px solid var(--line)' : 'none' }}>
                <span style={{ color: r.win ? 'var(--fg-0)' : 'var(--fg-3)' }}>
                  {r.win ? <span style={{ color: 'var(--ok)', marginRight: 6 }}>✓</span> : <span style={{ marginRight: 6, color: 'var(--fg-3)' }}>·</span>}
                  {r.name}
                </span>
                <span className="mono" style={{ color: 'var(--fg-2)', fontSize: 10.5 }}>{r.val}</span>
                <span className="mono tnum" style={{ color: 'var(--fg-3)', textAlign: 'right' }}>{r.weight}</span>
              </div>
            ))}
          </div>
        </div>

        {/* All copies table */}
        <div className="card">
          <div className="card-hd"><span>All copies ({group.count})</span></div>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Drive</th>
                <th>Path</th>
                <th style={{ width: 100 }}>Mtime</th>
                <th style={{ width: 60, textAlign: 'right' }}>Score</th>
                <th style={{ width: 90 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {group.copies.map((c, i) => (
                <tr key={i} className={c.keeper ? 'selected' : ''}>
                  <td>{c.keeper ? <span style={{ color: 'var(--ok)' }}>★</span> : <input type="checkbox" defaultChecked />}</td>
                  <td>
                    <span style={{
                      width: 16, height: 16, borderRadius: 2, background: driveColor(c.drive),
                      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: '#000',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>{c.drive}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 10.5 }}>{c.path}</td>
                  <td className="mono tnum" style={{ color: 'var(--fg-2)' }}>{c.mtime}</td>
                  <td className="mono tnum" style={{ textAlign: 'right', color: c.keeper ? 'var(--ok)' : 'var(--fg-2)', fontWeight: c.keeper ? 600 : 400 }}>{c.score}</td>
                  <td><span className="pill" style={{ fontSize: 9.5 }}>{c.keeper ? 'keep' : '→ quarantine'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Organize
// ─────────────────────────────────────────────────────────────
function OrganizeView() {
  const [tab, setTab] = useState('rules');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: '0 14px', display: 'flex', alignItems: 'center', gap: 4,
        borderBottom: '1px solid var(--line)', flexShrink: 0,
      }}>
        {[
          { id: 'rules', label: 'Rules', count: D.rules.length },
          { id: 'plan', label: 'Plan / Review', count: D.summary.pendingReview },
          { id: 'unsorted', label: 'Unsorted', count: D.summary.unsorted },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '10px 12px', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--fg-0)' : 'var(--fg-2)',
              cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            {t.label}
            <span className="pill" style={{ fontSize: 9.5 }}>{fmtNum(t.count)}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {tab === 'rules' && <button className="btn primary sm"><Icon name="plus" size={11} /> New rule</button>}
        {tab === 'plan' && <>
          <button className="btn sm ghost">dry run</button>
          <button className="btn primary sm">approve {fmtNum(D.summary.pendingReview)}</button>
        </>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'rules' && <RulesEditor />}
        {tab === 'plan' && <PlanReview />}
        {tab === 'unsorted' && <UnsortedView />}
      </div>
    </div>
  );
}

function RulesEditor() {
  const [selected, setSelected] = useState('r1');
  const rule = D.rules.find((r) => r.id === selected);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', height: '100%' }}>
      <div style={{ borderRight: '1px solid var(--line)', overflowY: 'auto' }}>
        {D.rules.map((r) => (
          <div key={r.id} onClick={() => setSelected(r.id)}
            style={{
              padding: '10px 14px',
              display: 'grid', gridTemplateColumns: '20px 24px 1fr auto', gap: 8, alignItems: 'center',
              borderBottom: '1px solid var(--line)',
              cursor: 'pointer',
              background: selected === r.id ? 'var(--accent-bg)' : 'transparent',
              borderLeft: selected === r.id ? '2px solid var(--accent)' : '2px solid transparent',
              opacity: r.enabled ? 1 : 0.5,
            }}>
            <span style={{ color: 'var(--fg-3)', cursor: 'grab' }}>⋮⋮</span>
            <span className="mono tnum" style={{ color: 'var(--fg-2)', fontSize: 10 }}>{String(r.priority).padStart(2, '0')}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{r.name}</span>
                {r.shadow && <span className="pill warn" style={{ fontSize: 9 }}>shadowed</span>}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--fg-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.category} → {r.dest} · {r.template}
              </div>
              <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 3, display: 'flex', gap: 8 }}>
                <span>matches <span style={{ color: 'var(--fg-1)' }}>{fmtNum(r.matches)}</span></span>
                <span>· planned <span style={{ color: 'var(--accent)' }}>{fmtNum(r.plannedOps)}</span></span>
              </div>
            </div>
            <div style={{
              width: 24, height: 14, borderRadius: 7,
              background: r.enabled ? 'var(--accent)' : 'var(--bg-3)',
              position: 'relative',
            }}>
              <span style={{
                position: 'absolute', top: 1, left: r.enabled ? 11 : 1,
                width: 12, height: 12, borderRadius: 6,
                background: r.enabled ? '#1a120a' : 'var(--fg-3)',
                transition: 'left .15s',
              }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span className="label-cap">priority {rule.priority}</span>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{rule.name}</h2>
          {rule.shadow && <span className="pill warn">would match {fmtNum(rule.wouldMatch)}, actually matches 0 — shadowed by earlier rule</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <Section title="Match">
            <Field label="Category"><span className="pill accent">{rule.category}</span></Field>
            <Field label="Date source min">any</Field>
            <Field label="Source drives">all connected</Field>
            <Field label="Path glob">—</Field>
            <Field label="Size range">—</Field>
          </Section>
          <Section title="Destination">
            <Field label="Role">
              <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{rule.dest}</span>
            </Field>
            <Field label="Template">
              <code className="mono" style={{ background: 'var(--bg-2)', padding: '2px 5px', borderRadius: 3, fontSize: 11 }}>
                {rule.template.replace(/\{(\w+(?::\d+)?)\}/g, (m) => `«${m.slice(1,-1)}»`)}
              </code>
            </Field>
            <Field label="Move policy"><span className="pill warn">{rule.policy}</span></Field>
            <Field label="Quarantine">default</Field>
          </Section>
        </div>

        {/* Live planner output */}
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-hd">
            <Icon name="rules" />
            <span>Live planner</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-2)' }}>recomputed 0.4s ago</span>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 24, marginBottom: 14, fontSize: 11.5 }}>
              <Stat label="would match" value={fmtNum(rule.wouldMatch)} />
              <Stat label="actually matches" value={fmtNum(rule.matches)} accent />
              <Stat label="planned ops" value={fmtNum(rule.plannedOps)} />
              <Stat label="cross-drive" value={fmtNum(Math.floor(rule.plannedOps * 0.7))} />
              <Stat label="estimated bytes" value="184 GB" />
            </div>
            <div className="seg-bar" style={{ height: 8 }}>
              <span style={{ width: '14%', background: 'var(--ok)' }} title="auto-applied" />
              <span style={{ width: '67%', background: 'var(--accent)' }} title="cross-drive review" />
              <span style={{ width: '19%', background: 'var(--fg-3)' }} title="no-op" />
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10.5, color: 'var(--fg-2)' }}>
              <span><span style={{ color: 'var(--ok)' }}>●</span> auto 14%</span>
              <span><span style={{ color: 'var(--accent)' }}>●</span> review 67%</span>
              <span><span style={{ color: 'var(--fg-3)' }}>●</span> no-op 19%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="label-cap" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 4 }}>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ padding: '8px 12px', display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, alignItems: 'center', borderBottom: '1px solid var(--line)', fontSize: 11.5 }}>
      <span style={{ color: 'var(--fg-2)' }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}
function Stat({ label, value, accent }) {
  return (
    <div>
      <div className="label-cap" style={{ marginBottom: 2 }}>{label}</div>
      <div className="mono tnum" style={{ fontSize: 18, fontWeight: 600, color: accent ? 'var(--accent)' : 'var(--fg-0)' }}>{value}</div>
    </div>
  );
}

function PlanReview() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, background: 'var(--bg-1)' }}>
        <span style={{ color: 'var(--fg-2)' }}>filter</span>
        <span className="pill accent">all rules</span>
        <span className="pill">cross-drive only</span>
        <span className="pill">size &gt; 100 MB</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'var(--fg-2)' }}>showing 1–{D.planSample.length} of {fmtNum(D.summary.pendingReview)}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 24 }}><input type="checkbox" defaultChecked /></th>
              <th>Source</th>
              <th style={{ width: 24 }}></th>
              <th>Destination</th>
              <th style={{ width: 130 }}>Rule</th>
              <th style={{ width: 90 }}>Kind</th>
              <th style={{ width: 70, textAlign: 'right' }}>Size</th>
            </tr>
          </thead>
          <tbody>
            {D.planSample.map((p, i) => {
              const srcDrive = p.src[0];
              const dstDrive = p.dest[0];
              return (
                <tr key={i}>
                  <td><input type="checkbox" defaultChecked /></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: 2, background: driveColor(srcDrive === 'C' ? 'C' : srcDrive),
                        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: '#000',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>{srcDrive}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-1)' }}>{p.src.slice(2)}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--fg-3)' }}>→</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: 2, background: driveColor(dstDrive === 'Z' ? 'N' : dstDrive),
                        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: '#000',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>{dstDrive === 'Z' ? 'N' : dstDrive}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent)' }}>{p.dest.slice(2)}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--fg-1)' }}>{p.rule}</td>
                  <td>
                    <span className={`pill ${p.kind === 'cross-drive-move' ? 'warn' : 'ok'}`} style={{ fontSize: 9.5 }}>
                      {p.kind === 'cross-drive-move' ? 'cross-drive' : 'same-drive'}
                    </span>
                  </td>
                  <td className="mono tnum" style={{ textAlign: 'right', color: 'var(--fg-2)' }}>{fmtSize(p.size/1024)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnsortedView() {
  return (
    <div style={{ padding: 18, color: 'var(--fg-2)' }}>
      <div className="card" style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 32, color: 'var(--accent)', fontWeight: 600 }} className="mono tnum">{fmtNum(D.summary.unsorted)}</div>
        <div style={{ fontSize: 12, marginBottom: 16 }}>files match no rule</div>
        <button className="btn primary sm">create rule from filter</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// App shell
// ─────────────────────────────────────────────────────────────
function VarA() {
  const [section, setSection] = useState('dashboard');
  return (
    <div className="fo-root" style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <Sidebar active={section} onNav={setSection} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <TopBar section={section} />
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {section === 'dashboard' && <Dashboard />}
          {section === 'duplicates' && <DuplicatesView />}
          {section === 'organize' && <OrganizeView />}
          {!['dashboard', 'duplicates', 'organize'].includes(section) && (
            <div style={{ padding: 40, color: 'var(--fg-2)', textAlign: 'center' }}>
              <Icon name="folder" size={32} />
              <div style={{ marginTop: 10, fontSize: 13 }}>«{section}» not built in this prototype</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>try Dashboard, Organize, or Duplicates</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.VarA = VarA;
window.VarADashboard = Dashboard;
window.VarADuplicates = DuplicatesView;
window.VarAOrganize = OrganizeView;
window.VarASidebar = Sidebar;
window.VarATopBar = TopBar;
window.VarAIcon = Icon;
window.VarAFmtSize = fmtSize;
window.VarAFmtNum = fmtNum;
window.VarADriveColor = driveColor;
