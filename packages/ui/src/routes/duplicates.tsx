import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord } from '@fileorganizer/shared';
import {
  defaultApiClient,
  type DedupePlanResponse,
  type DuplicateGroupUI,
  type DuplicateCopyUI,
  type DedupeOperation,
} from '../api/client.js';
import { Icon } from '../components/icon.js';
import { DriveRootsPrompt } from '../components/drive-roots-prompt.js';
import { formatBytes, driveColor, driveLetter } from '../lib/format.js';

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

interface DuplicatesProps extends RoutableProps {}

export function Duplicates(_props: DuplicatesProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [plan, setPlan] = useState<DedupePlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedOps, setSelectedOps] = useState<Set<number>>(new Set());
  const [showRoots, setShowRoots] = useState(false);
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'document'>('all');

  const reload = () => {
    Promise.all([api.listDrives(), api.listDuplicates({ minSize: 1024 })])
      .then(([d, p]) => {
        setDrives(d);
        setPlan(p);
        if (!selectedHash && p.groups.length > 0) {
          setSelectedHash(p.groups[0]!.sha256);
        }
        setSelectedOps(new Set(p.operations.map((o) => o.removeFileId)));
      })
      .catch((e) => setError((e as Error).message));
  };

  useEffect(reload, []);

  const driveById = new Map(drives.map((d) => [d.id, d]));

  const groups = (plan?.groups ?? []).filter((g) => filter === 'all' || g.copies[0]?.category === filter);
  const selectedGroup = groups.find((g) => g.sha256 === selectedHash) ?? groups[0];

  const totalReclaim = (plan?.operations ?? [])
    .filter((o) => selectedOps.has(o.removeFileId))
    .reduce((sum, o) => sum + o.reclaimableBytes, 0);

  const involvedDrives = (() => {
    if (!plan) return [];
    const ids = new Set<string>();
    for (const op of plan.operations) {
      if (selectedOps.has(op.removeFileId)) {
        const file = plan.groups.flatMap((g) => g.copies).find((c) => c.fileId === op.removeFileId);
        if (file) ids.add(file.driveId);
      }
    }
    return [...ids];
  })();

  const onApprove = async () => {
    if (selectedOps.size === 0 || !plan) return;
    // Drives that don't have a stored mount path need a manual prompt.
    const missingMounts = involvedDrives.filter((id) => !driveById.get(id)?.mountPath);
    if (missingMounts.length > 0) {
      setShowRoots(true);
      return;
    }
    try {
      const ops = plan.operations.filter((o) => selectedOps.has(o.removeFileId));
      await api.applyDedupe({ operations: ops, driveRoots: {} });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onConfirmRoots = async (roots: Record<string, string>) => {
    setShowRoots(false);
    if (!plan) return;
    try {
      const ops = plan.operations.filter((o) => selectedOps.has(o.removeFileId));
      await api.applyDedupe({ operations: ops, driveRoots: roots });
      reload();
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

  if (!plan) {
    return (
      <div style={{ padding: 16, color: 'var(--fg-3)' }}>
        Loading duplicates…
      </div>
    );
  }

  if (plan.groups.length === 0) {
    return (
      <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
        <div class="card">
          <div class="card-hd">
            <Icon name="dupes" />
            <span>Duplicates</span>
          </div>
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)' }}>
            <Icon name="dupes" size={32} />
            <div style={{ marginTop: 10, fontSize: 13 }}>No duplicates found.</div>
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
              Either nothing's been scanned yet, or every indexed file is unique.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', height: '100%', minHeight: 0 }}>
      <div style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
          <span style={{ fontWeight: 600 }}>{plan.groups.length} groups</span>
          <span class="pill warn">
            {formatBytes(plan.groups.reduce((s, g) => s + g.reclaimableBytes, 0))}
          </span>
          <div style={{ flex: 1 }} />
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
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {groups.map((g) => {
            const cat = g.copies[0]?.category ?? 'file';
            const driveLetters = [
              ...new Set(
                g.copies.map((c) => {
                  const d = driveById.get(c.driveId);
                  return d ? driveLetter(d.currentLetter, d.label.charAt(0).toUpperCase()) : '?';
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span class="mono" style={{ color: 'var(--fg-2)', fontSize: 10 }}>
                    {shortHash(g.sha256)}
                  </span>
                  <span class="pill" style={{ fontSize: 9.5 }}>{cat}</span>
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
                        (d) => driveLetter(d.currentLetter, d.label.charAt(0).toUpperCase()) === dr,
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
        </div>
      </div>

      {selectedGroup ? (
        <DupDetail
          group={selectedGroup}
          plan={plan}
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

interface DupDetailProps {
  group: DuplicateGroupUI;
  plan: DedupePlanResponse;
  drives: DriveRecord[];
  selectedOps: Set<number>;
  onToggle: (fileId: number, want: boolean) => void;
  totalReclaim: number;
  onApprove: () => void;
}

function DupDetail({
  group,
  plan,
  drives,
  selectedOps,
  onToggle,
  totalReclaim: _totalReclaim,
  onApprove,
}: DupDetailProps) {
  const driveById = new Map(drives.map((d) => [d.id, d]));
  const opsForGroup = plan.operations.filter((o) => o.groupSha256 === group.sha256);
  const keeperOp = opsForGroup[0];
  const keeperId = keeperOp?.keeperFileId ?? null;
  const reasons = keeperOp?.reasons ?? [];
  const groupSelectedCount = opsForGroup.filter((o) => selectedOps.has(o.removeFileId)).length;
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
            reclaim <span style={{ color: 'var(--accent)' }}>{formatBytes(group.reclaimableBytes)}</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          class="btn primary sm"
          disabled={groupSelectedCount === 0}
          onClick={onApprove}
        >
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
                    <span class="pill ok" style={{ marginBottom: 6 }}>✓ keeper</span>
                  ) : (
                    <span class="pill" style={{ marginBottom: 6 }}>candidate</span>
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
                          onChange={(e) => onToggle(c.fileId, (e.target as HTMLInputElement).checked)}
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
                      <span
                        class={`pill ${isKeeper ? 'ok' : ''}`}
                        style={{ fontSize: 9.5 }}
                      >
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
