import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icon.js';

interface FsEntry {
  name: string;
  kind: 'dir' | 'file';
  path: string;
}

interface FolderPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

interface Crumb {
  label: string;
  path: string;
}

function detectSep(path: string): '\\' | '/' {
  if (path.includes('\\')) return '\\';
  return '/';
}

function buildBreadcrumb(path: string): Crumb[] {
  if (path === '/' || path === '') return [];
  const sep = detectSep(path);
  const parts = path.split(/[/\\]/).filter(Boolean);
  const out: Crumb[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const slice = parts.slice(0, i + 1);
    const built = sep === '\\' ? slice.join('\\') : '/' + slice.join('/');
    out.push({ label: parts[i]!, path: built });
  }
  return out;
}

export function FolderPickerModal({ initialPath, onSelect, onCancel }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath?.trim() || '/');
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/fs/list?path=${encodeURIComponent(currentPath)}`)
      .then(async (r) => {
        const body = (await r.json()) as { entries?: FsEntry[]; error?: string };
        if (cancelled) return;
        if (!r.ok || body.error) {
          setError(body.error ?? `request failed (${r.status})`);
          setEntries([]);
        } else {
          setEntries(body.entries ?? []);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  const crumbs = buildBreadcrumb(currentPath);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <div
        class="card"
        style={{
          width: 640,
          maxWidth: '92vw',
          height: 480,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div class="card-hd">
          <Icon name="folder" />
          <span>Browse folder</span>
          <div style={{ flex: 1 }} />
          <button class="btn ghost sm" onClick={onCancel}>
            <Icon name="x" size={11} />
          </button>
        </div>
        <div
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 4,
            fontSize: 11.5,
          }}
        >
          <span
            onClick={() => setCurrentPath('/')}
            style={{
              cursor: 'pointer',
              color: currentPath === '/' ? 'var(--fg-0)' : 'var(--fg-2)',
              fontWeight: currentPath === '/' ? 600 : 400,
            }}
          >
            Drives
          </span>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--fg-3)' }}>/</span>
              <span
                onClick={() => setCurrentPath(c.path)}
                class="mono"
                style={{
                  cursor: 'pointer',
                  color: i === crumbs.length - 1 ? 'var(--fg-0)' : 'var(--fg-2)',
                  fontWeight: i === crumbs.length - 1 ? 600 : 400,
                }}
              >
                {c.label}
              </span>
            </span>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 14, color: 'var(--fg-3)', fontSize: 11.5 }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: 14, color: 'var(--danger)', fontSize: 11.5 }}>{error}</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 14, color: 'var(--fg-3)', fontSize: 11.5 }}>
              {currentPath === '/'
                ? 'No registered drives yet — type a path below to scan a new location.'
                : 'No entries.'}
            </div>
          ) : (
            entries.map((e) => (
              <div
                key={e.path}
                onClick={() => {
                  if (e.kind === 'dir') setCurrentPath(e.path);
                }}
                style={{
                  padding: '7px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderBottom: '1px solid var(--line)',
                  cursor: e.kind === 'dir' ? 'pointer' : 'default',
                  color: e.kind === 'dir' ? 'var(--fg-1)' : 'var(--fg-3)',
                  fontSize: 12,
                }}
              >
                <Icon name={e.kind === 'dir' ? 'folder' : 'file'} size={13} />
                <span class="mono" style={{ flex: 1 }}>
                  {e.name}
                </span>
                {e.kind === 'dir' ? <Icon name="chevron" size={11} /> : null}
              </div>
            ))
          )}
        </div>
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span class="mono" style={{ fontSize: 11, color: 'var(--fg-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentPath === '/' ? '(no path selected)' : currentPath}
          </span>
          <button class="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            class="btn primary"
            disabled={currentPath === '/' || currentPath.trim() === ''}
            onClick={() => onSelect(currentPath)}
          >
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
