import { useEffect, useMemo, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord, RoleDefinition } from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';
import { Icon } from '../components/icon.js';

export function Roles(_props: RoutableProps) {
  const api = defaultApiClient();
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    setError(null);
    Promise.all([api.listRoles(), api.listDrives()])
      .then(([r, d]) => {
        setRoles(r);
        setDrives(d);
      })
      .catch((e) => setError((e as Error).message));
  };

  useEffect(reload, []);

  const driveById = useMemo(() => new Map(drives.map((d) => [d.id, d])), [drives]);
  const driveLabel = (id: string) => driveById.get(id)?.label ?? id;

  const persist = async (
    op: () => Promise<unknown>,
    successMessage?: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await op();
      if (successMessage) {
        setInfo(successMessage);
        setTimeout(() => setInfo(null), 1500);
      }
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reorder = (role: RoleDefinition, from: number, to: number) => {
    if (to < 0 || to >= role.drivePriority.length) return;
    const next = [...role.drivePriority];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    return persist(() => api.updateRole(role.name, { drivePriority: next }));
  };

  const removeDrive = (role: RoleDefinition, driveId: string) =>
    persist(() =>
      api.updateRole(role.name, {
        drivePriority: role.drivePriority.filter((id) => id !== driveId),
      }),
    );

  const addDrive = (role: RoleDefinition, driveId: string) => {
    if (role.drivePriority.includes(driveId)) return;
    return persist(() =>
      api.updateRole(role.name, {
        drivePriority: [...role.drivePriority, driveId],
      }),
    );
  };

  const setThreshold = (role: RoleDefinition, value: number) =>
    persist(() => api.updateRole(role.name, { fillThresholdPercent: value }));

  const remove = (role: RoleDefinition) => {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    return persist(
      () => api.deleteRole(role.name),
      `Deleted role ${role.name}`,
    );
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card" style={{ marginBottom: 12 }}>
        <div class="card-hd">
          <Icon name="rules" />
          <span>Roles</span>
          <span class="pill info mono">{roles.length} defined</span>
          <span class="pill mono">{drives.length} drives</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button class="btn primary sm" onClick={() => setCreating(true)} disabled={busy}>
              New role
            </button>
          </div>
        </div>
        {error ? (
          <div style={{ padding: '8px 12px', color: 'var(--danger)', fontSize: 11.5 }}>
            {error}
          </div>
        ) : null}
        {info ? (
          <div style={{ padding: '8px 12px', color: 'var(--ok)', fontSize: 11.5 }}>{info}</div>
        ) : null}
      </div>

      {roles.length === 0 ? (
        <div
          class="card"
          style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 11.5 }}
        >
          No roles defined yet. Click "New role" to add one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {roles.map((role) => (
            <RoleCard
              key={role.name}
              role={role}
              drives={drives}
              driveLabel={driveLabel}
              busy={busy}
              onReorder={(from, to) => reorder(role, from, to)}
              onRemoveDrive={(driveId) => removeDrive(role, driveId)}
              onAddDrive={(driveId) => addDrive(role, driveId)}
              onSetThreshold={(v) => setThreshold(role, v)}
              onDelete={() => remove(role)}
            />
          ))}
        </div>
      )}

      {creating ? (
        <RoleForm
          drives={drives}
          existingNames={roles.map((r) => r.name)}
          onCancel={() => setCreating(false)}
          onSubmit={async (input) => {
            await api.createRole(input);
            setCreating(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

interface RoleCardProps {
  role: RoleDefinition;
  drives: DriveRecord[];
  driveLabel: (id: string) => string;
  busy: boolean;
  onReorder: (from: number, to: number) => Promise<void> | void;
  onRemoveDrive: (driveId: string) => Promise<void> | void;
  onAddDrive: (driveId: string) => Promise<void> | void;
  onSetThreshold: (value: number) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

function RoleCard({
  role,
  drives,
  driveLabel,
  busy,
  onReorder,
  onRemoveDrive,
  onAddDrive,
  onSetThreshold,
  onDelete,
}: RoleCardProps) {
  const [thresholdInput, setThresholdInput] = useState<string>(
    String(role.fillThresholdPercent),
  );
  const [pendingDrive, setPendingDrive] = useState<string>('');

  const candidateDrives = drives.filter((d) => !role.drivePriority.includes(d.id));

  const commitThreshold = () => {
    const n = Number.parseInt(thresholdInput, 10);
    if (Number.isFinite(n) && n !== role.fillThresholdPercent) {
      void onSetThreshold(n);
    } else {
      setThresholdInput(String(role.fillThresholdPercent));
    }
  };

  return (
    <div class="card">
      <div class="card-hd">
        <span class="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {role.name}
        </span>
        <span class="pill mono">
          {role.drivePriority.length} {role.drivePriority.length === 1 ? 'drive' : 'drives'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span class="label-cap">fill threshold</span>
          <input
            type="number"
            min={1}
            max={100}
            style={{ width: 70 }}
            value={thresholdInput}
            onInput={(e) => setThresholdInput((e.target as HTMLInputElement).value)}
            onBlur={commitThreshold}
            disabled={busy}
          />
          <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>%</span>
          <button class="btn danger sm" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        </div>
      </div>

      {role.drivePriority.length === 0 ? (
        <div style={{ padding: 14, color: 'var(--fg-3)', fontSize: 11.5 }}>
          No drives assigned. The planner will report this role as unresolved
          until at least one drive is added.
        </div>
      ) : (
        <table class="tbl">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Drive</th>
              <th style={{ width: 120 }}>Volume</th>
              <th style={{ width: 200 }}>Order</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {role.drivePriority.map((id, i) => {
              const d = drives.find((x) => x.id === id);
              return (
                <tr key={id}>
                  <td class="mono" style={{ color: 'var(--fg-2)' }}>{i + 1}</td>
                  <td>{driveLabel(id)}</td>
                  <td class="mono" style={{ color: 'var(--fg-2)', fontSize: 11 }}>
                    {d?.volumeSerial ?? '—'}
                  </td>
                  <td>
                    <button
                      class="btn ghost sm"
                      onClick={() => onReorder(i, i - 1)}
                      disabled={busy || i === 0}
                      title="Move up"
                    >
                      ↑
                    </button>{' '}
                    <button
                      class="btn ghost sm"
                      onClick={() => onReorder(i, i + 1)}
                      disabled={busy || i === role.drivePriority.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </td>
                  <td>
                    <button
                      class="btn ghost sm"
                      onClick={() => onRemoveDrive(id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {candidateDrives.length > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderTop: '1px solid var(--line)',
          }}
        >
          <span class="label-cap">add drive</span>
          <select
            value={pendingDrive}
            onChange={(e) => setPendingDrive((e.target as HTMLSelectElement).value)}
            disabled={busy}
          >
            <option value="">— select —</option>
            {candidateDrives.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <button
            class="btn sm"
            disabled={busy || !pendingDrive}
            onClick={() => {
              if (pendingDrive) {
                void onAddDrive(pendingDrive);
                setPendingDrive('');
              }
            }}
          >
            Add
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface RoleFormProps {
  drives: DriveRecord[];
  existingNames: string[];
  onCancel: () => void;
  onSubmit: (input: RoleDefinition) => Promise<void>;
}

function RoleForm({ drives, existingNames, onCancel, onSubmit }: RoleFormProps) {
  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState(90);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const togglePick = (driveId: string) => {
    setPicked(
      picked.includes(driveId)
        ? picked.filter((id) => id !== driveId)
        : [...picked, driveId],
    );
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    if (existingNames.includes(trimmed)) {
      setError(`Role "${trimmed}" already exists.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: trimmed,
        drivePriority: picked,
        fillThresholdPercent: threshold,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
        style={{ width: 520, maxWidth: '92vw', maxHeight: '90vh', overflow: 'auto', padding: 20 }}
      >
        <div class="card-hd" style={{ marginBottom: 14 }}>
          <span>New role</span>
        </div>

        <div style={{ margin: '8px 0' }}>
          <div class="label-cap" style={{ marginBottom: 4 }}>Name</div>
          <input
            class="mono"
            style={{ width: '100%' }}
            placeholder="media-archive"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>

        <div style={{ margin: '8px 0' }}>
          <div class="label-cap" style={{ marginBottom: 4 }}>Fill threshold (%)</div>
          <input
            type="number"
            min={1}
            max={100}
            style={{ width: 100 }}
            value={threshold}
            onInput={(e) => {
              const v = Number.parseInt((e.target as HTMLInputElement).value, 10);
              if (Number.isFinite(v)) setThreshold(v);
            }}
          />
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--fg-3)' }}>
            Drives that hit this fill % are skipped during planning.
          </span>
        </div>

        <div style={{ margin: '8px 0' }}>
          <div class="label-cap" style={{ marginBottom: 4 }}>Drive priority (select in order)</div>
          {drives.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
              No drives registered yet. You can save the role with no drives and add them later.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {drives.map((d) => {
                const idx = picked.indexOf(d.id);
                const on = idx >= 0;
                return (
                  <button
                    key={d.id}
                    type="button"
                    class={`btn sm ${on ? 'primary' : 'ghost'}`}
                    onClick={() => togglePick(d.id)}
                  >
                    {on ? `${idx + 1}. ` : ''}{d.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error ? (
          <div style={{ color: 'var(--danger)', fontSize: 11.5, marginTop: 10 }}>{error}</div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button class="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button class="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Create role'}
          </button>
        </div>
      </div>
    </div>
  );
}
