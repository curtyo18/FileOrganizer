import { useEffect, useState } from 'preact/hooks';
import type { DriveRecord } from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';

interface Props {
  driveIds: string[];
  onResolve: (roots: Record<string, string>) => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

export function DriveRootsPrompt({ driveIds, onResolve, onCancel, title, description }: Props) {
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [roots, setRoots] = useState<Record<string, string>>({});

  useEffect(() => {
    defaultApiClient().listDrives().then(setDrives).catch(() => {});
  }, []);

  const required = drives.filter((d) => driveIds.includes(d.id));
  const allFilled = required.length > 0 && required.every((d) => roots[d.id]?.trim().length);

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
      <div class="card" style={{ width: 540, maxWidth: '90vw', padding: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>{title ?? 'Confirm drive roots'}</h3>
        <p style={{ margin: '0 0 14px', color: 'var(--fg-2)', fontSize: 11.5 }}>
          {description ??
            'Enter the absolute path on this machine for each drive root. The engine uses these to read and write files.'}
        </p>
        {required.length === 0 ? (
          <div style={{ color: 'var(--fg-3)', fontSize: 11.5 }}>No drives needed.</div>
        ) : (
          required.map((d) => (
            <div key={d.id} style={{ margin: '10px 0' }}>
              <div class="label-cap" style={{ marginBottom: 4 }}>
                {d.label} {d.currentLetter ? `· ${d.currentLetter}` : ''}
              </div>
              <input
                style={{ width: '100%' }}
                placeholder={d.currentLetter ? `${d.currentLetter}\\` : '/path/to/drive'}
                value={roots[d.id] ?? ''}
                onInput={(e) => setRoots({ ...roots, [d.id]: (e.target as HTMLInputElement).value })}
              />
            </div>
          ))
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button class="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button class="btn primary" disabled={!allFilled} onClick={() => onResolve(roots)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
