import { useEffect, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord } from '@fileorganizer/shared';
import { defaultApiClient, type QuarantineEntryUI } from '../api/client.js';
import { Icon } from '../components/icon.js';
import { DriveRootsPrompt } from '../components/drive-roots-prompt.js';
import { formatBytes, driveColor, driveLetter, relativeTime } from '../lib/format.js';

export function Quarantine(_props: RoutableProps) {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [entries, setEntries] = useState<QuarantineEntryUI[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showRoots, setShowRoots] = useState(false);

  const reload = () => {
    Promise.all([api.listDrives(), api.listQuarantine()])
      .then(([d, e]) => {
        setDrives(d);
        setEntries(e);
      })
      .catch((err) => setError((err as Error).message));
  };

  useEffect(reload, []);

  const driveById = new Map(drives.map((d) => [d.id, d]));

  // Group entries by batch for the design's batched display.
  const batches = (() => {
    const map = new Map<string, QuarantineEntryUI[]>();
    for (const e of entries) {
      const list = map.get(e.batchId) ?? [];
      list.push(e);
      map.set(e.batchId, list);
    }
    return [...map.entries()].sort((a, b) => {
      const aTime = a[1][0]?.quarantinedAt ?? '';
      const bTime = b[1][0]?.quarantinedAt ?? '';
      return aTime < bTime ? 1 : -1;
    });
  })();

  const totalBytes = entries.reduce((s, e) => s + e.originalSize, 0);
  const involvedDrives = (() => {
    const ids = new Set<string>();
    for (const e of entries) {
      if (selected.has(e.id)) ids.add(e.driveId);
    }
    return [...ids];
  })();

  const doRestore = async (driveRoots: Record<string, string>) => {
    try {
      const result = await api.restoreQuarantine({
        quarantineIds: [...selected],
        driveRoots,
      });
      setInfo(
        `Restored ${result.restored} file${result.restored === 1 ? '' : 's'}` +
          (result.errors.length > 0 ? `; ${result.errors.length} errors` : ''),
      );
      setSelected(new Set());
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onRestore = async () => {
    if (selected.size === 0) return;
    const missingMounts = involvedDrives.filter((id) => !driveById.get(id)?.mountPath);
    if (missingMounts.length > 0) {
      setShowRoots(true);
      return;
    }
    await doRestore({});
  };

  const onConfirmRoots = async (roots: Record<string, string>) => {
    setShowRoots(false);
    await doRestore(roots);
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div class="card">
        <div class="card-hd">
          <Icon name="quarantine" />
          <span>Quarantine</span>
          <span class="pill">{entries.length} files</span>
          <span class="pill warn">{formatBytes(totalBytes)}</span>
          <div style={{ flex: 1 }} />
          <button class="btn primary sm" disabled={selected.size === 0} onClick={onRestore}>
            restore {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
        <div style={{ padding: 14, color: 'var(--fg-2)', fontSize: 11.5 }}>
          Files moved here by dedup or organize batches. They stay until you explicitly restore or
          empty (purge feature lands in M7).
        </div>
      </div>

      {error ? (
        <div class="card" style={{ padding: 14, color: 'var(--danger)' }}>
          {error}
        </div>
      ) : null}
      {info ? (
        <div class="card" style={{ padding: 14, color: 'var(--fg-2)' }}>
          {info}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div class="card">
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 11.5 }}>
            Quarantine is empty.
          </div>
        </div>
      ) : (
        batches.map(([batchId, batchEntries]) => {
          const sample = batchEntries[0]!;
          const drive = driveById.get(sample.driveId);
          const ltr = drive
            ? driveLetter(drive.currentLetter, drive.label.charAt(0).toUpperCase())
            : '?';
          const color = drive ? driveColor(drive.currentLetter ?? drive.label) : '#888';
          const allSelected = batchEntries.every((e) => selected.has(e.id));
          return (
            <div class="card" key={batchId}>
              <div class="card-hd">
                <span class="mono" style={{ fontSize: 10.5, color: 'var(--fg-2)' }}>
                  batch {batchId.slice(0, 8)}…
                </span>
                <span class="pill">{batchEntries.length} files</span>
                <span class="pill">
                  {formatBytes(batchEntries.reduce((s, e) => s + e.originalSize, 0))}
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>
                  {relativeTime(sample.quarantinedAt)}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  class="btn sm ghost"
                  onClick={() => {
                    const next = new Set(selected);
                    if (allSelected) {
                      for (const e of batchEntries) next.delete(e.id);
                    } else {
                      for (const e of batchEntries) next.add(e.id);
                    }
                    setSelected(next);
                  }}
                >
                  {allSelected ? 'deselect' : 'select'} batch
                </button>
              </div>
              <table class="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 24 }}></th>
                    <th style={{ width: 40 }}>Drive</th>
                    <th>Original path</th>
                    <th style={{ width: 100, textAlign: 'right' }}>Size</th>
                    <th style={{ width: 110 }}>Mtime</th>
                  </tr>
                </thead>
                <tbody>
                  {batchEntries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          onChange={(ev) => {
                            const next = new Set(selected);
                            if ((ev.target as HTMLInputElement).checked) next.add(e.id);
                            else next.delete(e.id);
                            setSelected(next);
                          }}
                        />
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
                        {e.originalPath}
                      </td>
                      <td class="mono tnum" style={{ textAlign: 'right', color: 'var(--fg-2)' }}>
                        {formatBytes(e.originalSize)}
                      </td>
                      <td class="mono" style={{ color: 'var(--fg-2)' }}>
                        {e.originalMtime.slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}

      {showRoots ? (
        <DriveRootsPrompt
          driveIds={involvedDrives}
          onResolve={onConfirmRoots}
          onCancel={() => setShowRoots(false)}
          title={`Restore ${selected.size} files`}
          description="Each affected drive needs its absolute root path so the engine can move files back to their original locations."
        />
      ) : null}
    </div>
  );
}
