import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Category, Rule } from '@fileorganizer/shared';
import { CATEGORIES } from '@fileorganizer/shared';

interface Props {
  initial?: Rule | null;
  onSubmit: (rule: Omit<Rule, 'id'>) => Promise<void> | void;
  onCancel: () => void;
}

const MOVE_POLICIES: Rule['movePolicy'][] = [
  'same-drive-auto',
  'cross-drive-review',
  'always-review',
];

export function RuleForm({ initial, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [priority, setPriority] = useState<number>(initial?.priority ?? 100);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [categories, setCategories] = useState<Category[]>(initial?.match.category ?? []);
  const [dateBefore, setDateBefore] = useState(initial?.match.dateBefore ?? '');
  const [dateAfter, setDateAfter] = useState(initial?.match.dateAfter ?? '');
  const [pathGlob, setPathGlob] = useState(initial?.match.pathGlob ?? '');
  const [minSize, setMinSize] = useState<string>(
    initial?.match.minSizeBytes != null ? String(initial.match.minSizeBytes) : '',
  );
  const [destinationRole, setDestinationRole] = useState(initial?.destinationRole ?? '');
  const [destinationTemplate, setDestinationTemplate] = useState(
    initial?.destinationTemplate ?? '',
  );
  const [movePolicy, setMovePolicy] = useState<Rule['movePolicy']>(
    initial?.movePolicy ?? 'cross-drive-review',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = (c: Category) => {
    setCategories(
      categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c],
    );
  };

  const submit = async () => {
    if (!name.trim() || !destinationRole.trim() || !destinationTemplate.trim()) {
      setError('Name, role, and template are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const match: Rule['match'] = {};
      if (categories.length) match.category = categories;
      if (dateBefore) match.dateBefore = dateBefore;
      if (dateAfter) match.dateAfter = dateAfter;
      if (pathGlob) match.pathGlob = pathGlob;
      if (minSize.trim()) {
        const n = Number.parseInt(minSize, 10);
        if (Number.isFinite(n)) match.minSizeBytes = n;
      }
      await onSubmit({
        name: name.trim(),
        priority,
        enabled,
        match,
        destinationRole: destinationRole.trim(),
        destinationTemplate: destinationTemplate.trim(),
        movePolicy,
        quarantinePolicy: 'default',
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
      <div class="card" style={{ width: 640, maxWidth: '92vw', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
        <div class="card-hd" style={{ marginBottom: 14 }}>
          <span>{initial?.id ? 'Edit rule' : 'New rule'}</span>
          {initial?.id ? <span class="pill info mono">{initial.id.slice(0, 8)}</span> : null}
        </div>

        <Field label="Name">
          <input
            style={{ width: '100%' }}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </Field>

        <Row>
          <Field label="Priority (lower wins)">
            <input
              type="number"
              style={{ width: 100 }}
              value={priority}
              onInput={(e) =>
                setPriority(Number.parseInt((e.target as HTMLInputElement).value, 10) || 0)
              }
            />
          </Field>
          <Field label="Enabled">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
              />
              <span style={{ fontSize: 11.5, color: 'var(--fg-1)' }}>
                {enabled ? 'on' : 'off'}
              </span>
            </label>
          </Field>
        </Row>

        <Section title="Match" />
        <Field label="Categories">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIES.map((c) => {
              const on = categories.includes(c);
              return (
                <button
                  key={c}
                  class={`btn sm ${on ? 'primary' : 'ghost'}`}
                  onClick={() => toggleCategory(c)}
                  type="button"
                >
                  {c}
                </button>
              );
            })}
          </div>
        </Field>
        <Row>
          <Field label="Date after (YYYY-MM-DD)">
            <input
              style={{ width: 200 }}
              placeholder="2024-01-01"
              value={dateAfter}
              onInput={(e) => setDateAfter((e.target as HTMLInputElement).value)}
            />
          </Field>
          <Field label="Date before (YYYY-MM-DD)">
            <input
              style={{ width: 200 }}
              placeholder="2024-01-01"
              value={dateBefore}
              onInput={(e) => setDateBefore((e.target as HTMLInputElement).value)}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Path glob">
            <input
              style={{ width: '100%' }}
              placeholder="**/Downloads/**"
              value={pathGlob}
              onInput={(e) => setPathGlob((e.target as HTMLInputElement).value)}
            />
          </Field>
          <Field label="Min size (bytes)">
            <input
              style={{ width: 140 }}
              placeholder="0"
              value={minSize}
              onInput={(e) => setMinSize((e.target as HTMLInputElement).value)}
            />
          </Field>
        </Row>

        <Section title="Destination" />
        <Row>
          <Field label="Role">
            <input
              style={{ width: 220 }}
              placeholder="media-archive"
              value={destinationRole}
              onInput={(e) => setDestinationRole((e.target as HTMLInputElement).value)}
            />
          </Field>
          <Field label="Move policy">
            <select
              value={movePolicy}
              onChange={(e) =>
                setMovePolicy((e.target as HTMLSelectElement).value as Rule['movePolicy'])
              }
            >
              {MOVE_POLICIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        </Row>
        <Field label="Template">
          <input
            class="mono"
            style={{ width: '100%' }}
            placeholder="Photos/{year}/{month:02}/{filename}"
            value={destinationTemplate}
            onInput={(e) => setDestinationTemplate((e.target as HTMLInputElement).value)}
          />
        </Field>
        <p style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: -2 }}>
          Available fields: {'{year}'}, {'{month:02}'}, {'{day:02}'}, {'{category}'},{' '}
          {'{filename}'}, {'{stem}'}, {'{ext}'}, {'{drive_label}'}.
        </p>

        {error ? (
          <div style={{ color: 'var(--danger)', fontSize: 11.5, marginTop: 10 }}>{error}</div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button class="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button class="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div style={{ margin: '8px 0' }}>
      <div class="label-cap" style={{ marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ children }: { children: ComponentChildren }) {
  return <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{children}</div>;
}

function Section({ title }: { title: string }) {
  return (
    <div
      class="label-cap"
      style={{
        marginTop: 14,
        paddingTop: 10,
        borderTop: '1px solid var(--bd)',
        color: 'var(--fg-2)',
      }}
    >
      {title}
    </div>
  );
}
