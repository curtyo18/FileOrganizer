import { useEffect, useMemo, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type {
  BatchKind,
  BatchRecord,
  DriveRecord,
  OperationRecord,
  OperationStatus,
} from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';
import { Icon } from '../components/icon.js';
import { DriveRootsPrompt } from '../components/drive-roots-prompt.js';

const KIND_FILTERS: Array<'all' | BatchKind> = [
  'all',
  'scan',
  'move',
  'dedupe',
  'undo',
  'restore',
  'one-off-move',
  'quarantine-empty',
  'cleanup-empty-dirs',
];

const STATUS_FILTERS: Array<'all' | OperationStatus> = [
  'all',
  'in-progress',
  'completed',
  'completed-via-existing',
  'failed',
  'reverted',
  'dry-run',
];

export function History(_props: RoutableProps) {
  const api = defaultApiClient();
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [opsByBatch, setOpsByBatch] = useState<Record<string, OperationRecord[]>>({});
  const [filterKind, setFilterKind] = useState<'all' | BatchKind>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | OperationStatus>('all');
  const [undoFor, setUndoFor] = useState<{ batchId: string; driveIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setError(null);
    Promise.all([api.listBatches(200), api.listDrives()])
      .then(([b, d]) => {
        setBatches(b);
        setDrives(d);
      })
      .catch((e) => setError((e as Error).message));
  };

  useEffect(reload, []);

  const driveById = useMemo(() => new Map(drives.map((d) => [d.id, d])), [drives]);

  const expand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!opsByBatch[id]) {
      try {
        const data = await api.getBatch(id);
        setOpsByBatch({ ...opsByBatch, [id]: data.operations });
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };

  const filtered = batches.filter(
    (b) =>
      (filterKind === 'all' || b.kind === filterKind) &&
      (filterStatus === 'all' || b.status === filterStatus),
  );

  const onUndoClicked = async (b: BatchRecord) => {
    setError(null);
    setMessage(null);
    let ops = opsByBatch[b.id];
    if (!ops) {
      try {
        const data = await api.getBatch(b.id);
        ops = data.operations;
        setOpsByBatch({ ...opsByBatch, [b.id]: ops });
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    const driveIds = [
      ...new Set(
        ops.flatMap((o) =>
          [o.sourceDriveId, o.destDriveId].filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    const missing = driveIds.filter((id) => !driveById.get(id)?.mountPath);
    if (missing.length === 0) {
      runUndo(b.id, {});
    } else {
      setUndoFor({ batchId: b.id, driveIds: missing });
    }
  };

  const runUndo = async (batchId: string, overrides: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const stored: Record<string, string> = {};
      for (const d of drives) {
        if (d.mountPath) stored[d.id] = d.mountPath;
      }
      const result = await api.organizeUndo(batchId, { ...stored, ...overrides });
      setMessage(
        `Undo of ${batchId.slice(0, 8)}: reverted ${result.reverted}, skipped ${result.skipped}` +
          (result.errors.length ? ` · ${result.errors.length} errors` : ''),
      );
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card" style={{ marginBottom: 12 }}>
        <div class="card-hd">
          <Icon name="history" />
          <span>History</span>
          <span class="pill info">{filtered.length} of {batches.length}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
              <span class="label-cap">Kind</span>
              <select
                value={filterKind}
                onChange={(e) =>
                  setFilterKind(
                    (e.target as HTMLSelectElement).value as 'all' | BatchKind,
                  )
                }
              >
                {KIND_FILTERS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
              <span class="label-cap">Status</span>
              <select
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(
                    (e.target as HTMLSelectElement).value as 'all' | OperationStatus,
                  )
                }
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {error ? (
          <div style={{ padding: '8px 12px', color: 'var(--danger)', fontSize: 11.5 }}>
            {error}
          </div>
        ) : null}
        {message ? (
          <div style={{ padding: '8px 12px', color: 'var(--ok)', fontSize: 11.5 }}>{message}</div>
        ) : null}
      </div>

      <div class="card">
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 11.5 }}>
            No batches match the current filters.
          </div>
        ) : (
          <table class="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th style={{ width: 180 }}>Started</th>
                <th style={{ width: 100 }}>Kind</th>
                <th>Description</th>
                <th style={{ width: 140 }}>Status</th>
                <th style={{ width: 130, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const isOpen = expanded === b.id;
                const canUndo = b.kind !== 'undo' && b.status === 'completed';
                return (
                  <BatchRow
                    key={b.id}
                    batch={b}
                    isOpen={isOpen}
                    canUndo={canUndo}
                    busy={busy}
                    ops={opsByBatch[b.id] ?? null}
                    onToggle={() => expand(b.id)}
                    onUndo={() => onUndoClicked(b)}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {undoFor ? (
        <DriveRootsPrompt
          driveIds={undoFor.driveIds}
          title="Confirm drive roots before undo"
          description="Undo needs each affected drive's root to find files for re-verification and restoration."
          onCancel={() => setUndoFor(null)}
          onResolve={(roots) => {
            const target = undoFor;
            setUndoFor(null);
            runUndo(target.batchId, roots);
          }}
        />
      ) : null}
    </div>
  );
}

interface BatchRowProps {
  batch: BatchRecord;
  isOpen: boolean;
  canUndo: boolean;
  busy: boolean;
  ops: OperationRecord[] | null;
  onToggle: () => void;
  onUndo: () => void;
}

function BatchRow({ batch, isOpen, canUndo, busy, ops, onToggle, onUndo }: BatchRowProps) {
  const summary = formatSummary(batch);
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ textAlign: 'center' }}>{isOpen ? '−' : '+'}</td>
        <td class="mono" style={{ fontSize: 10.5 }}>
          {formatDate(batch.startedAt)}
        </td>
        <td>
          <span class="pill mono">{batch.kind}</span>
        </td>
        <td style={{ fontSize: 11.5, color: 'var(--fg-1)' }}>
          {batch.description || '—'}
          {summary ? (
            <span style={{ color: 'var(--fg-3)', marginLeft: 8 }}>· {summary}</span>
          ) : null}
        </td>
        <td>
          <StatusPill status={batch.status} />
        </td>
        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
          {canUndo ? (
            <button class="btn ghost sm" disabled={busy} onClick={onUndo}>
              Undo
            </button>
          ) : null}
        </td>
      </tr>
      {isOpen ? (
        <tr>
          <td colspan={6} style={{ background: 'var(--bg-2)', padding: 0 }}>
            {ops === null ? (
              <div style={{ padding: 12, fontSize: 11, color: 'var(--fg-3)' }}>Loading…</div>
            ) : ops.length === 0 ? (
              <div style={{ padding: 12, fontSize: 11, color: 'var(--fg-3)' }}>
                No operations recorded for this batch.
              </div>
            ) : (
              <table class="tbl" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Kind</th>
                    <th>Source</th>
                    <th>Destination</th>
                    <th style={{ width: 160 }}>Status</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map((o) => (
                    <tr key={o.id}>
                      <td class="mono" style={{ fontSize: 10.5 }}>
                        {o.kind}
                      </td>
                      <td class="mono" style={{ fontSize: 10.5 }}>
                        {o.sourcePath ?? '—'}
                      </td>
                      <td class="mono" style={{ fontSize: 10.5 }}>
                        {o.destPath ?? o.quarantinePath ?? '—'}
                      </td>
                      <td>
                        <StatusPill status={o.status} />
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--danger)' }}>
                        {o.errorMessage ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StatusPill({ status }: { status: OperationStatus }) {
  const variant =
    status === 'completed'
      ? 'ok'
      : status === 'completed-via-existing'
        ? 'ok'
        : status === 'failed'
          ? 'danger'
          : status === 'reverted'
            ? 'warn'
            : status === 'dry-run'
              ? 'info'
              : 'info';
  return <span class={`pill ${variant} mono`}>{status}</span>;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function formatSummary(batch: BatchRecord): string {
  const s = batch.summary as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof s['completed'] === 'number' && s['completed'] > 0) {
    bits.push(`${s['completed']} ok`);
  }
  if (typeof s['failed'] === 'number' && s['failed'] > 0) {
    bits.push(`${s['failed']} failed`);
  }
  if (typeof s['reverted'] === 'number' && s['reverted'] > 0) {
    bits.push(`${s['reverted']} reverted`);
  }
  if (typeof s['skipped'] === 'number' && s['skipped'] > 0) {
    bits.push(`${s['skipped']} skipped`);
  }
  if (typeof s['count'] === 'number' && bits.length === 0) {
    bits.push(`${s['count']} ops`);
  }
  return bits.join(', ');
}
