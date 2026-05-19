import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord } from '@fileorganizer/shared';
import {
  defaultApiClient,
  type DedupeOperation,
  type DuplicateCopyUI,
  type DuplicateGroupUI,
} from '../api/client.js';
import { Icon } from '../components/icon.js';
import { DriveRootsPrompt } from '../components/drive-roots-prompt.js';
import { formatBytes, driveColor, driveLetter } from '../lib/format.js';

const PAGE_SIZE = 50;

const MIN_SIZE_OPTIONS: { label: string; bytes: number }[] = [
  { label: '1 KB', bytes: 1024 },
  { label: '1 MB', bytes: 1024 * 1024 },
  { label: '10 MB', bytes: 10 * 1024 * 1024 },
  { label: '100 MB', bytes: 100 * 1024 * 1024 },
  { label: '1 GB', bytes: 1024 * 1024 * 1024 },
];

const DEFAULT_MIN_SIZE = 1024 * 1024;

function shortHash(h: string): string {
  return h.length > 12 ? h.slice(0, 10) + '…' : h;
}

function basenameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function categoryIcon(cat: string): string {
  if (cat === 'image') return 'image';
  if (cat === 'video') return 'video';
  return 'file';
}

type DuplicatesProps = RoutableProps;

export function Duplicates(_props: DuplicatesProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [groups, setGroups] = useState<DuplicateGroupUI[]>([]);
  const [operations, setOperations] = useState<DedupeOperation[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedOps, setSelectedOps] = useState<Set<number>>(new Set());
  const [showRoots, setShowRoots] = useState(false);
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'document'>('all');
  const [minSize, setMinSize] = useState<number>(DEFAULT_MIN_SIZE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const initialLoadRef = useRef(false);
  // Each loadPage call gets its own AbortController. When a new call starts,
  // the previous in-flight request is aborted so stale responses never overwrite
  // state from a newer minSize filter selection.
  const abortRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (offset: number, reset: boolean) => {
    if (!reset && loadingRef.current) return;
    // Abort any in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    loadingRef.current = true;
    setLoading(true);
    try {
      const [d, plan] = await Promise.all([
        offset === 0 ? api.listDrives() : Promise.resolve(null),
        api.listDuplicates({ minSize, limit: PAGE_SIZE, offset, signal: controller.signal }),
      ]);
      // Belt-and-suspenders: if aborted after the await, don't touch state.
      if (controller.signal.aborted) return;
      if (d) setDrives(d);
      if (reset) {
        setGroups(plan.groups);
        setOperations(plan.operations);
        setSelectedOps(new Set(plan.operations.map((o) => o.removeFileId)));
        setSelectedHash(plan.groups[0]?.sha256 ?? null);
      } else {
        setGroups((prev) => [...prev, ...plan.groups]);
        setOperations((prev) => [...prev, ...plan.operations]);
        setSelectedOps((prev) => {
          const next = new Set(prev);
          for (const op of plan.operations) next.add(op.removeFileId);
          return next;
        });
      }
      setTotal(plan.total);
      setHasMore(plan.hasMore);
    } catch (e) {
      // AbortError is expected when a newer loadPage call supersedes this one.
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [minSize]);

  useEffect(() => {
    initialLoadRef.current = true;
    void loadPage(0, true);
  }, [loadPage]);

  const driveById = new Map(drives.map((d) => [d.id, d]));

  const visibleGroups = groups.filter(
    (g) => filter === 'all' || g.copies[0]?.category === filter,
  );
  const selectedGroup =
    visibleGroups.find((g) => g.sha256 === selectedHash) ?? visibleGroups[0];

  const totalReclaim = operations
    .filter((o) => selectedOps.has(o.removeFileId))
    .reduce((sum, o) => sum + o.reclaimableBytes, 0);

  const involvedDrives = (() => {
    const ids = new Set<string>();
    const copyById = new Map<number, DuplicateCopyUI>();
    for (const g of groups) for (const c of g.copies) copyById.set(c.fileId, c);
    for (const op of operations) {
      if (selectedOps.has(op.removeFileId)) {
        const file = copyById.get(op.removeFileId);
        if (file) ids.add(file.driveId);
      }
    }
    return [...ids];
  })();

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLDivElement;
    if (!hasMore || loadingRef.current) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < 240) {
      void loadPage(groups.length, false);
    }

  };

  const onApprove = async () => {
    if (selectedOps.size === 0) return;
    const missingMounts = involvedDrives.filter((id) => !driveById.get(id)?.mountPath);
    if (missingMounts.length > 0) {
      setShowRoots(true);
      return;
    }
    try {
      const ops = operations.filter((o) => selectedOps.has(o.removeFileId));
      await api.applyDedupe({ operations: ops, driveRoots: {} });
      await loadPage(0, true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onConfirmRoots = async (roots: Record<string, string>) => {
    setShowRoots(false);
    try {
      const ops = operations.filter((o) => selectedOps.has(o.removeFileId));
      await api.applyDedupe({ operations: ops, driveRoots: roots });
      await loadPage(0, true);
    } catch (e) {
      setError((e as Error).message);
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

  if (!initialLoadRef.current && loading) {
    return (
      <div style={{ padding: 16, color: 'var(--fg-3)' }}>
        Loading duplicates…
      </div>
    );
  }

  if (groups.length === 0 && !loading) {
    return (
      <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
        <div class="card">
          <div class="card-hd">
            <Icon name="dupes" />
            <span>Duplicates</span>
            <div style={{ flex: 1 }} />
            <MinSizeSelect value={minSize} onChange={setMinSize} />
          </div>
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)' }}>
            <Icon name="dupes" size={32} />
            <div style={{ marginTop: 10, fontSize: 13 }}>No duplicates above this size threshold.</div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
              Try lowering the minimum size, or scan more drives.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalReclaimableBytes = groups.reduce((s, g) => s + g.reclaimableBytes, 0);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '380px 1fr',
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
            gap: 10,
          }}
        >
          <Icon name="dupes" />
          <span style={{ fontWeight: 600 }}>
            {groups.length} of {total} groups
          </span>
          <span class="pill warn">{formatBytes(totalReclaimableBytes)}</span>
          <div style={{ flex: 1 }} />
          <MinSizeSelect value={minSize} onChange={setMinSize} />
        </div>
        <div
          style={{
            padding: '6px 10px',
            display: 'flex',
            gap: 6,
            borderBottom: '1px solid var(--line)',
            fontSize: 11,
          }}
        >
          {(['all', 'image', 'video', 'document'] as const).map((f) => (
            <span
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '2px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                background: filter === f ? 'var(--bg-3)' : 'transparent',
                color: filter === f ? 'var(--fg-0)' : 'var(--fg-2)',
              }}
            >
              {f}
            </span>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ color: 'var(--fg-3)' }}>sort: reclaim ↓</span>
        </div>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          style={{ flex: 1, overflowY: 'auto' }}
        >
          {visibleGroups.map((g) => {
            const cat = g.copies[0]?.category ?? 'file';
            const driveLetters = [
              ...new Set(
                g.copies.map((c) => {
                  const d = driveById.get(c.driveId);
                  return d
                    ? driveLetter(d.currentLetter, d.label.charAt(0).toUpperCase())
                    : '?';
                }),
              ),
            ];
            const isSel = selectedGroup?.sha256 === g.sha256;
            return (
              <div
                key={g.sha256}
                onClick={() => setSelectedHash(g.sha256)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--line)',
                  cursor: 'pointer',
                  background: isSel ? 'var(--accent-bg)' : 'transparent',
                  borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span class="mono" style={{ color: 'var(--fg-2)', fontSize: 10 }}>
                    {shortHash(g.sha256)}
                  </span>
                  <span class="pill" style={{ fontSize: 9.5 }}>
                    {cat}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span
                    class="mono tnum"
                    style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}
                  >
                    +{formatBytes(g.reclaimableBytes)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {basenameOf(g.copies[0]?.path ?? '')}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 10.5,
                    color: 'var(--fg-2)',
                  }}
                >
                  <span>{g.copies.length} copies</span>
                  <span>·</span>
                  <span>{formatBytes(g.fileSizeBytes)} each</span>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: 'flex', gap: 2 }}>
                    {driveLetters.map((dr, i) => {
                      const driveRec = drives.find(
                        (d) =>
                          driveLetter(d.currentLetter, d.label.charAt(0).toUpperCase()) ===
                          dr,
                      );
                      return (
                        <span
                          key={i}
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 2,
                            background: driveColor(driveRec?.currentLetter ?? dr),
                            color: '#000',
                            fontFamily: 'var(--mono)',
                            fontSize: 9,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {dr}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          {hasMore ? (
            <div
              style={{
                padding: 14,
                textAlign: 'center',
                color: 'var(--fg-3)',
                fontSize: 11,
              }}
            >
              {loading ? 'Loading more…' : 'Scroll to load more'}
            </div>
          ) : groups.length > 0 ? (
            <div
              style={{
                padding: 14,
                textAlign: 'center',
                color: 'var(--fg-3)',
                fontSize: 11,
              }}
            >
              All {total} groups loaded.
            </div>
          ) : null}
        </div>
      </div>

      {selectedGroup ? (
        <DupDetail
          group={selectedGroup}
          operations={operations}
          drives={drives}
          selectedOps={selectedOps}
          onToggle={(fileId, want) => {
            const next = new Set(selectedOps);
            if (want) next.add(fileId);
            else next.delete(fileId);
            setSelectedOps(next);
          }}
          totalReclaim={totalReclaim}
          onApprove={onApprove}
        />
      ) : null}

      {showRoots ? (
        <DriveRootsPrompt
          driveIds={involvedDrives}
          onResolve={onConfirmRoots}
          onCancel={() => setShowRoots(false)}
          title={`Approve quarantine of ${selectedOps.size} files`}
          description="Each affected drive needs its absolute root path so the engine can move files into the per-drive quarantine folder."
        />
      ) : null}
    </div>
  );
}

interface MinSizeSelectProps {
  value: number;
  onChange: (bytes: number) => void;
}

function MinSizeSelect({ value, onChange }: MinSizeSelectProps) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--fg-2)' }}>min size</span>
      <select
        value={String(value)}
        onChange={(e) =>
          onChange(parseInt((e.currentTarget as HTMLSelectElement).value, 10))
        }
        style={{
          background: 'var(--bg-2)',
          color: 'var(--fg-0)',
          border: '1px solid var(--line)',
          borderRadius: 3,
          padding: '2px 6px',
          fontSize: 11,
          fontFamily: 'inherit',
        }}
      >
        {MIN_SIZE_OPTIONS.map((o) => (
          <option key={o.bytes} value={String(o.bytes)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface DupDetailProps {
  group: DuplicateGroupUI;
  operations: DedupeOperation[];
  drives: DriveRecord[];
  selectedOps: Set<number>;
  onToggle: (fileId: number, want: boolean) => void;
  totalReclaim: number;
  onApprove: () => void;
}

function DupDetail({
  group,
  operations,
  drives,
  selectedOps,
  onToggle,
  totalReclaim: _totalReclaim,
  onApprove,
}: DupDetailProps) {
  const driveById = new Map(drives.map((d) => [d.id, d]));
  const opsForGroup = operations.filter((o) => o.groupSha256 === group.sha256);
  const keeperOp = opsForGroup[0];
  const keeperId = keeperOp?.keeperFileId ?? null;
  const reasons = keeperOp?.reasons ?? [];
  const groupSelectedCount = opsForGroup.filter((o) => selectedOps.has(o.removeFileId))
    .length;
  const cat = group.copies[0]?.category ?? 'file';

  return (
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
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Group · <span class="mono">{shortHash(group.sha256)}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 2 }}>
            {group.copies.length} byte-identical copies · {formatBytes(group.fileSizeBytes)} each ·
            reclaim{' '}
            <span style={{ color: 'var(--accent)' }}>
              {formatBytes(group.reclaimableBytes)}
            </span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button class="btn primary sm" disabled={groupSelectedCount === 0} onClick={onApprove}>
          approve · quarantine {groupSelectedCount}
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(group.copies.length, 4)}, 1fr)`,
            gap: 10,
          }}
        >
          {group.copies.slice(0, 4).map((c, i) => {
            const drive = driveById.get(c.driveId);
            const ltr = drive
              ? driveLetter(drive.currentLetter, drive.label.charAt(0).toUpperCase())
              : '?';
            const color = drive ? driveColor(drive.currentLetter ?? drive.label) : '#888';
            const isKeeper = c.fileId === keeperId;
            return (
              <div key={i} class="card" style={{ overflow: 'hidden', position: 'relative' }}>
                <div
                  class="stripe"
                  style={{
                    aspectRatio: '4/3',
                    background: isKeeper
                      ? 'linear-gradient(135deg, oklch(0.74 0.14 70 / 0.4), oklch(0.5 0.08 50 / 0.4))'
                      : 'var(--bg-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--fg-3)',
                    overflow: 'hidden',
                  }}
                >
                  {cat === 'image' ? (
                    <img
                      src={`/api/preview/${c.fileId}?max=192`}
                      loading="lazy"
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <Icon name={categoryIcon(cat)} size={28} />
                  )}
                </div>
                <div style={{ padding: 10 }}>
                  {isKeeper ? (
                    <span class="pill ok" style={{ marginBottom: 6 }}>
                      ✓ keeper
                    </span>
                  ) : (
                    <span class="pill" style={{ marginBottom: 6 }}>
                      candidate
                    </span>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      marginTop: 5,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 2,
                        background: color,
                        fontFamily: 'var(--mono)',
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {ltr}
                    </span>
                    <span
                      class="mono"
                      style={{
                        fontSize: 10.5,
                        color: 'var(--fg-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.path}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fg-3)' }} class="mono">
                    mtime {c.mtime.slice(0, 10)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div class="card">
          <div class="card-hd">
            <span>Why this keeper?</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: 'var(--fg-2)' }}>tiebreaker order</span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {reasons.length === 0 ? (
              <div style={{ padding: 14, color: 'var(--fg-3)', fontSize: 11.5 }}>
                Only one copy or scoring not yet computed.
              </div>
            ) : (
              reasons.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: '7px 14px',
                    fontSize: 11.5,
                    borderBottom: i < reasons.length - 1 ? '1px solid var(--line)' : 'none',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span style={{ color: 'var(--ok)' }}>✓</span>
                  <span>{r}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div class="card">
          <div class="card-hd">
            <span>All copies ({group.copies.length})</span>
          </div>
          <table class="tbl">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th style={{ width: 60 }}>Drive</th>
                <th>Path</th>
                <th style={{ width: 100 }}>Mtime</th>
                <th style={{ width: 100 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {group.copies.map((c) => {
                const drive = driveById.get(c.driveId);
                const ltr = drive
                  ? driveLetter(drive.currentLetter, drive.label.charAt(0).toUpperCase())
                  : '?';
                const color = drive ? driveColor(drive.currentLetter ?? drive.label) : '#888';
                const isKeeper = c.fileId === keeperId;
                const op = opsForGroup.find((o) => o.removeFileId === c.fileId);
                return (
                  <tr key={c.fileId} class={isKeeper ? 'selected' : ''}>
                    <td>
                      {isKeeper ? (
                        <span style={{ color: 'var(--ok)' }}>★</span>
                      ) : op ? (
                        <input
                          type="checkbox"
                          checked={selectedOps.has(c.fileId)}
                          onChange={(e) =>
                            onToggle(c.fileId, (e.target as HTMLInputElement).checked)
                          }
                        />
                      ) : null}
                    </td>
                    <td>
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 2,
                          background: color,
                          fontFamily: 'var(--mono)',
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#000',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {ltr}
                      </span>
                    </td>
                    <td class="mono" style={{ fontSize: 10.5 }}>
                      {c.path}
                    </td>
                    <td class="mono" style={{ color: 'var(--fg-2)' }}>
                      {c.mtime.slice(0, 10)}
                    </td>
                    <td>
                      <span class={`pill ${isKeeper ? 'ok' : ''}`} style={{ fontSize: 9.5 }}>
                        {isKeeper ? 'keep' : '→ quarantine'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
