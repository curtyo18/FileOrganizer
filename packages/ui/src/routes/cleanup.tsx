import { useEffect, useMemo, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord } from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';
import { Icon } from '../components/icon.js';
import { driveColor, driveLetter } from '../lib/format.js';

interface CleanupProps extends RoutableProps {}

interface DriveScanState {
  loading: boolean;
  paths: string[];
  totalEmpty: number;
  truncated: boolean;
  error: string | null;
}

export function Cleanup(_props: CleanupProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [byDrive, setByDrive] = useState<Record<string, DriveScanState>>({});
  const [activeDriveId, setActiveDriveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    api
      .listDrives()
      .then((d) => {
        const reachable = d.filter((dd) => !!dd.mountPath);
        setDrives(reachable);
        if (reachable.length > 0) {
          const first = reachable[0]!;
          setActiveDriveId(first.id);
          void scanDrive(first.id);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const scanDrive = async (driveId: string) => {
    setByDrive((prev) => ({
      ...prev,
      [driveId]: {
        loading: true,
        paths: prev[driveId]?.paths ?? [],
        totalEmpty: prev[driveId]?.totalEmpty ?? 0,
        truncated: prev[driveId]?.truncated ?? false,
        error: null,
      },
    }));
    try {
      const result = await api.listEmptyDirs(driveId);
      setByDrive((prev) => ({
        ...prev,
        [driveId]: {
          loading: false,
          paths: result.paths,
          totalEmpty: result.totalEmpty,
          truncated: result.truncated,
          error: null,
        },
      }));
    } catch (e) {
      setByDrive((prev) => ({
        ...prev,
        [driveId]: {
          loading: false,
          paths: [],
          totalEmpty: 0,
          truncated: false,
          error: (e as Error).message,
        },
      }));
    }
  };

  const onSelectDrive = (driveId: string) => {
    setActiveDriveId(driveId);
    setSelected(new Set());
    setExpanded(new Set());
    if (!byDrive[driveId]) {
      void scanDrive(driveId);
    }
  };

  const activeState = activeDriveId ? byDrive[activeDriveId] : null;

  const groupedByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!activeState) return map;
    for (const p of activeState.paths) {
      const parent = parentOf(p);
      const list = map.get(parent) ?? [];
      list.push(p);
      map.set(parent, list);
    }
    return map;
  }, [activeState]);

  const toggle = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelected(next);
  };

  const toggleAllVisible = () => {
    if (!activeState) return;
    if (selected.size === activeState.paths.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(activeState.paths));
    }
  };

  const onApply = async () => {
    if (!activeDriveId || selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} empty folder${selected.size === 1 ? '' : 's'}?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.applyCleanupEmptyDirs({
        driveId: activeDriveId,
        paths: [...selected],
      });
      setInfo(
        `Removed ${result.removed} folder${result.removed === 1 ? '' : 's'}` +
          (result.failed.length > 0 ? ` · ${result.failed.length} failed` : '') +
          ` · batch ${result.batchId.slice(0, 8)}`,
      );
      setSelected(new Set());
      await scanDrive(activeDriveId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div class="card" style={{ padding: 14, color: 'var(--danger)' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        style={{
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="folder" />
          <span style={{ fontWeight: 600 }}>Cleanup</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {drives.length === 0 ? (
            <div style={{ padding: 14, color: 'var(--fg-3)', fontSize: 11.5 }}>
              No reachable drives.
            </div>
          ) : (
            drives.map((d) => {
              const ltr = driveLetter(d.currentLetter, d.label.charAt(0).toUpperCase());
              const color = driveColor(d.currentLetter ?? d.label);
              const state = byDrive[d.id];
              const isActive = d.id === activeDriveId;
              return (
                <div
                  key={d.id}
                  onClick={() => onSelectDrive(d.id)}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    background: isActive ? 'var(--accent-bg)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 3,
                      background: color,
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {ltr}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{d.label}</div>
                    <div
                      class="mono"
                      style={{
                        fontSize: 10,
                        color: 'var(--fg-3)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {d.mountPath}
                    </div>
                  </div>
                  <span class="pill" style={{ fontSize: 9.5 }}>
                    {state?.loading ? '…' : state ? state.totalEmpty : '—'}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Empty folders</div>
            <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2 }}>
              {activeState?.loading
                ? 'scanning…'
                : activeState
                  ? `${activeState.totalEmpty} found${activeState.truncated ? ' (truncated, showing first 5000)' : ''}`
                  : 'pick a drive'}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <label
            style={{
              fontSize: 11,
              color: 'var(--fg-2)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={
                !!activeState &&
                activeState.paths.length > 0 &&
                selected.size === activeState.paths.length
              }
              onChange={toggleAllVisible}
            />
            Select all visible
          </label>
          <button
            class="btn primary sm"
            onClick={onApply}
            disabled={busy || selected.size === 0}
          >
            Delete {selected.size}
          </button>
        </div>
        {info ? (
          <div style={{ padding: '8px 18px', color: 'var(--ok)', fontSize: 11.5 }}>{info}</div>
        ) : null}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!activeState ? (
            <div style={{ padding: 18, color: 'var(--fg-3)', fontSize: 11.5 }}>
              Select a drive to scan.
            </div>
          ) : activeState.error ? (
            <div style={{ padding: 18, color: 'var(--danger)', fontSize: 11.5 }}>
              {activeState.error}
            </div>
          ) : activeState.paths.length === 0 && !activeState.loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>
              <Icon name="folder" size={28} />
              <div style={{ marginTop: 10, fontSize: 12 }}>No long-existing empty folders.</div>
            </div>
          ) : (
            [...groupedByParent.entries()].map(([parent, paths]) => {
              const isOpen = expanded.has(parent);
              return (
                <div key={parent}>
                  <div
                    onClick={() => {
                      const next = new Set(expanded);
                      if (next.has(parent)) next.delete(parent);
                      else next.add(parent);
                      setExpanded(next);
                    }}
                    style={{
                      padding: '7px 14px',
                      borderBottom: '1px solid var(--line)',
                      background: 'var(--bg-2)',
                      cursor: 'pointer',
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Icon name="folder" size={11} />
                    <span class="mono" style={{ flex: 1, fontSize: 10.5, color: 'var(--fg-1)' }}>
                      {parent}
                    </span>
                    <span class="pill" style={{ fontSize: 9.5 }}>
                      {paths.length}
                    </span>
                    <span style={{ color: 'var(--fg-3)', fontSize: 10 }}>
                      {isOpen ? '−' : '+'}
                    </span>
                  </div>
                  {isOpen
                    ? paths.map((p) => (
                        <div
                          key={p}
                          style={{
                            padding: '5px 14px 5px 30px',
                            borderBottom: '1px solid var(--line)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 11,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(p)}
                            onChange={() => toggle(p)}
                          />
                          <span class="mono" style={{ color: 'var(--fg-2)', fontSize: 10.5 }}>
                            {p.slice(parent.length + 1) || p}
                          </span>
                        </div>
                      ))
                    : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function parentOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : path;
}
