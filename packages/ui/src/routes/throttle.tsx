import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type {
  Settings,
  ThrottleProfile,
  ThrottleProfileName,
  ThrottleScheduleEntry,
} from '@fileorganizer/shared';
import { defaultApiClient } from '../api/client.js';
import { Icon } from '../components/icon.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const PROFILE_ORDER: ThrottleProfileName[] = ['idle', 'balanced', 'full-send'];

const PROFILE_BG: Record<ThrottleProfileName, string> = {
  idle: 'oklch(0.50 0.04 240 / 0.45)',
  balanced: 'oklch(0.74 0.10 230 / 0.55)',
  'full-send': 'oklch(0.70 0.18 25 / 0.55)',
};

export function Throttle(_props: RoutableProps) {
  const api = defaultApiClient();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setOriginal(JSON.stringify(s));
      })
      .catch((e) => setError((e as Error).message));
  };

  useEffect(load, []);

  const dirty = useMemo(() => {
    if (!settings || !original) return false;
    return JSON.stringify(settings) !== original;
  }, [settings, original]);

  if (!settings) {
    return (
      <div style={{ padding: 16 }}>
        <div class="card">
          <div class="card-hd">
            <Icon name="scan" />
            <span>Throttle</span>
          </div>
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 11.5 }}>
            {error ?? 'Loading…'}
          </div>
        </div>
      </div>
    );
  }

  const updateProfile = (
    name: ThrottleProfileName,
    patch: Partial<ThrottleProfile>,
  ) => {
    setSettings({
      ...settings,
      throttleProfiles: {
        ...settings.throttleProfiles,
        [name]: { ...settings.throttleProfiles[name], ...patch, name },
      },
    });
  };

  const profileAt = (day: number, hour: number): ThrottleProfileName | null => {
    for (const e of settings.throttleSchedule) {
      if (e.dayOfWeek !== day) continue;
      const inWindow =
        e.startHour <= e.endHour
          ? hour >= e.startHour && hour < e.endHour
          : hour >= e.startHour || hour < e.endHour;
      if (inWindow) return e.profile;
    }
    return null;
  };

  const cycle = (day: number, hour: number) => {
    const current = profileAt(day, hour);
    const next: ThrottleProfileName | null =
      current === null
        ? 'idle'
        : current === 'idle'
          ? 'balanced'
          : current === 'balanced'
            ? 'full-send'
            : null;

    const filtered = settings.throttleSchedule.filter(
      (e) =>
        !(
          e.dayOfWeek === day &&
          e.startHour <= hour &&
          (e.startHour <= e.endHour
            ? hour < e.endHour
            : hour < e.endHour || hour >= e.startHour)
        ),
    );
    const nextSchedule: ThrottleScheduleEntry[] = filtered;
    if (next) {
      nextSchedule.push({
        dayOfWeek: day,
        startHour: hour,
        endHour: hour + 1,
        profile: next,
      });
    }
    setSettings({ ...settings, throttleSchedule: nextSchedule });
  };

  const fillDay = (day: number, profile: ThrottleProfileName | null) => {
    const others = settings.throttleSchedule.filter((e) => e.dayOfWeek !== day);
    const next: ThrottleScheduleEntry[] = others;
    if (profile) {
      next.push({ dayOfWeek: day, startHour: 0, endHour: 24, profile });
    }
    setSettings({ ...settings, throttleSchedule: next });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      setOriginal(JSON.stringify(saved));
      setInfo('Saved.');
      setTimeout(() => setInfo(null), 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revert = () => {
    if (!original) return;
    setSettings(JSON.parse(original) as Settings);
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card" style={{ marginBottom: 12 }}>
        <div class="card-hd">
          <Icon name="scan" />
          <span>Throttle</span>
          {dirty ? <span class="pill warn">unsaved</span> : <span class="pill ok">saved</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button class="btn ghost sm" onClick={revert} disabled={busy || !dirty}>
              Revert
            </button>
            <button class="btn primary sm" onClick={save} disabled={busy || !dirty}>
              Save
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

      <div class="card" style={{ marginBottom: 12 }}>
        <div class="card-hd">
          <span>Profiles</span>
          <span class="pill info">3 fixed profiles · scan picks one</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 12,
            padding: 12,
          }}
        >
          {PROFILE_ORDER.map((name) => (
            <ProfileCard
              key={name}
              profile={settings.throttleProfiles[name]}
              onChange={(patch) => updateProfile(name, patch)}
            />
          ))}
        </div>
      </div>

      <div class="card">
        <div class="card-hd">
          <span>Weekly schedule</span>
          <span class="pill info">click an hour to cycle profile</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, fontSize: 11 }}>
            <Legend name="idle" />
            <Legend name="balanced" />
            <Legend name="full-send" />
          </div>
        </div>
        <div style={{ padding: 12, overflowX: 'auto' }}>
          <table
            class="tbl"
            style={{
              borderSpacing: 0,
              borderCollapse: 'separate',
              fontSize: 10.5,
              tableLayout: 'fixed',
            }}
          >
            <thead>
              <tr>
                <th style={{ width: 60, textAlign: 'left' }}></th>
                {HOURS.map((h) => (
                  <th key={h} style={{ width: 22, textAlign: 'center', fontWeight: 400 }}>
                    {h}
                  </th>
                ))}
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, di) => (
                <tr key={day}>
                  <td style={{ fontWeight: 600 }}>{day}</td>
                  {HOURS.map((h) => {
                    const p = profileAt(di, h);
                    const bg = p ? PROFILE_BG[p] : 'transparent';
                    return (
                      <td
                        key={h}
                        title={`${day} ${h}:00 — ${p ?? 'inherit'}`}
                        style={{
                          height: 22,
                          background: bg,
                          cursor: 'pointer',
                          borderRight: '1px solid var(--bd)',
                          borderBottom: '1px solid var(--bd)',
                        }}
                        onClick={() => cycle(di, h)}
                      />
                    );
                  })}
                  <td style={{ textAlign: 'right', paddingLeft: 6 }}>
                    <select
                      style={{ fontSize: 10.5 }}
                      value=""
                      onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        if (v === 'clear') fillDay(di, null);
                        else if (v) fillDay(di, v as ThrottleProfileName);
                        (e.target as HTMLSelectElement).value = '';
                      }}
                    >
                      <option value="">fill day…</option>
                      {PROFILE_ORDER.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                      <option value="clear">clear</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 8 }}>
            Empty cells fall back to whatever profile the engine is running. The scheduler
            re-evaluates every minute, and changes take effect immediately on save.
          </p>
        </div>
      </div>
    </div>
  );
}

function Legend({ name }: { name: ThrottleProfileName }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          width: 10,
          height: 10,
          background: PROFILE_BG[name],
          border: '1px solid var(--bd)',
        }}
      />
      <span class="mono" style={{ fontSize: 10 }}>
        {name}
      </span>
    </span>
  );
}

interface ProfileCardProps {
  profile: ThrottleProfile;
  onChange: (patch: Partial<ThrottleProfile>) => void;
}

function ProfileCard({ profile, onChange }: ProfileCardProps) {
  const num = (e: Event) => {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    return Number.isFinite(v) ? v : 0;
  };
  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--bd)',
        borderRadius: 6,
        padding: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: PROFILE_BG[profile.name],
          }}
        />
        <strong>{profile.name}</strong>
      </div>
      <ProfileField label="Local workers">
        <input
          type="number"
          min={1}
          max={64}
          value={profile.localHashWorkers}
          onInput={(e) => onChange({ localHashWorkers: num(e) })}
        />
      </ProfileField>
      <ProfileField label="Network workers">
        <input
          type="number"
          min={1}
          max={32}
          value={profile.networkHashWorkers}
          onInput={(e) => onChange({ networkHashWorkers: num(e) })}
        />
      </ProfileField>
      <ProfileField label="Read chunk (KB)">
        <input
          type="number"
          min={64}
          max={16384}
          step={64}
          value={Math.floor(profile.readChunkBytes / 1024)}
          onInput={(e) => onChange({ readChunkBytes: num(e) * 1024 })}
        />
      </ProfileField>
      <ProfileField label="Inter-chunk sleep (ms)">
        <input
          type="number"
          min={0}
          max={500}
          value={profile.interChunkSleepMs}
          onInput={(e) => onChange({ interChunkSleepMs: num(e) })}
        />
      </ProfileField>
      <ProfileField label="Max open files">
        <input
          type="number"
          min={1}
          max={512}
          value={profile.maxOpenFiles}
          onInput={(e) => onChange({ maxOpenFiles: num(e) })}
        />
      </ProfileField>
    </div>
  );
}

function ProfileField({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div class="label-cap" style={{ marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}
