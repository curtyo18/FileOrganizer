import { useEffect, useMemo, useState } from 'preact/hooks';
import type { RoutableProps } from 'preact-router';
import type { DriveRecord, Rule } from '@fileorganizer/shared';
import {
  defaultApiClient,
  type OrganizePlanResponse,
  type RuleStatUI,
} from '../api/client.js';
import { Icon } from '../components/icon.js';
import { DriveRootsPrompt } from '../components/drive-roots-prompt.js';
import { RuleForm } from '../components/rule-form.js';
import { formatBytes } from '../lib/format.js';

type Tab = 'rules' | 'plan';

export function Organize(_props: RoutableProps) {
  const api = defaultApiClient();
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState<Rule[]>([]);
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);

  const [plan, setPlan] = useState<OrganizePlanResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [planRoots, setPlanRoots] = useState<Record<string, string>>({});
  const [showRoots, setShowRoots] = useState<null | 'plan' | 'apply' | 'dryrun'>(null);
  const [busy, setBusy] = useState(false);
  const [removeEmptySourceDirs, setRemoveEmptySourceDirs] = useState(false);
  const [pageOffset, setPageOffset] = useState(0);
  const PAGE_SIZE = 200;

  const reload = () => {
    setError(null);
    Promise.all([api.listRules(), api.listDrives()])
      .then(([r, d]) => {
        setRules(r);
        setDrives(d);
      })
      .catch((e) => setError((e as Error).message));
  };

  useEffect(reload, []);

  const driveById = useMemo(() => new Map(drives.map((d) => [d.id, d])), [drives]);

  const operationsForDrive = useMemo(() => {
    if (!plan) return new Set<string>();
    const ids = new Set<string>();
    for (const op of plan.operations) {
      ids.add(op.sourceDriveId);
      ids.add(op.destDriveId);
    }
    return ids;
  }, [plan]);

  const driveRootsFromCatalog = useMemo(() => {
    const out: Record<string, string> = {};
    for (const d of drives) {
      if (d.mountPath) out[d.id] = d.mountPath;
    }
    return out;
  }, [drives]);

  const missingMountDrives = (driveIds: string[]) =>
    driveIds.filter((id) => !driveById.get(id)?.mountPath);

  const onPlanClicked = () => {
    setError(null);
    setInfo(null);
    const involved = drives.map((d) => d.id);
    const missing = missingMountDrives(involved);
    if (missing.length === 0) {
      void runPlan(driveRootsFromCatalog);
    } else {
      setShowRoots('plan');
    }
  };

  const runPlan = async (overrides: Record<string, string>, offset = 0) => {
    setBusy(true);
    try {
      const merged = { ...driveRootsFromCatalog, ...overrides };
      setPlanRoots(merged);
      const result = await api.planOrganize(merged, { limit: PAGE_SIZE, offset });
      setPlan(result);
      setPageOffset(offset);
      // Per-page selection only — bulk selection across pages is a follow-up.
      setSelected(
        new Set(
          result.operations
            .filter((o) => o.kind !== 'noop')
            .map((o) => o.fileId),
        ),
      );
      setTab('plan');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const goToPage = (offset: number) => {
    if (busy) return;
    void runPlan(planRoots, offset);
  };

  const onApplyClicked = (kind: 'apply' | 'dryrun') => {
    if (!plan || selected.size === 0) return;
    const involved = [...new Set(plan.operations
      .filter((o) => selected.has(o.fileId))
      .flatMap((o) => [o.sourceDriveId, o.destDriveId]))];
    const missing = missingMountDrives(involved);
    if (missing.length === 0) {
      void runApply(kind, planRoots);
    } else {
      setShowRoots(kind);
    }
  };

  const runApply = async (
    kind: 'apply' | 'dryrun',
    overrides: Record<string, string>,
  ) => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const merged = { ...planRoots, ...overrides };
      const ops = plan.operations.filter((o) => selected.has(o.fileId));
      const result = await api.organizeApply({
        description: kind === 'dryrun' ? 'dry-run preview' : 'manual approval',
        operations: ops,
        driveRoots: merged,
        dryRun: kind === 'dryrun',
        removeEmptySourceDirs: kind === 'apply' && removeEmptySourceDirs,
      });
      const verb = kind === 'dryrun' ? 'previewed' : 'applied';
      const sweepNote =
        kind === 'apply' && result.emptyDirsRemoved > 0
          ? ` · removed ${result.emptyDirsRemoved} empty folder${result.emptyDirsRemoved === 1 ? '' : 's'}`
          : '';
      setInfo(
        `${verb} ${result.completed}/${ops.length}` +
          (result.failed > 0 ? ` · ${result.failed} failed` : '') +
          sweepNote +
          (result.batchId ? ` · batch ${result.batchId.slice(0, 8)}` : ''),
      );
      if (kind === 'apply') {
        setPlan(null);
        setSelected(new Set());
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onApplyAllClicked = async (kind: 'apply' | 'dryrun') => {
    if (!plan || plan.total === 0 || busy) return;
    if (
      kind === 'apply' &&
      (plan.total > 1000 || plan.totalBytes > 1_000_000_000) &&
      !confirm(`Apply all ${plan.total} operations (${formatBytes(plan.totalBytes)})?`)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.applyAllOrganize({
        description: 'apply all',
        driveRoots: planRoots,
        dryRun: kind === 'dryrun',
        removeEmptySourceDirs: kind === 'apply' && removeEmptySourceDirs,
      });
      const verb = kind === 'dryrun' ? 'previewed' : 'applied';
      const sweepNote =
        kind === 'apply' && result.emptyDirsRemoved > 0
          ? ` · removed ${result.emptyDirsRemoved} empty folder${result.emptyDirsRemoved === 1 ? '' : 's'}`
          : '';
      setInfo(
        `${verb} ${result.completed}/${plan.total}` +
          (result.failed > 0 ? ` · ${result.failed} failed` : '') +
          sweepNote +
          (result.batchId ? ` · batch ${result.batchId.slice(0, 8)}` : ''),
      );
      if (kind === 'apply') {
        setPlan(null);
        setSelected(new Set());
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enabledRules = rules.filter((r) => r.enabled);

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div class="card" style={{ marginBottom: 12 }}>
        <div class="card-hd">
          <Icon name="rules" />
          <span>Organize</span>
          <span class="pill info mono">{rules.length} rules · {enabledRules.length} on</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              class={`btn ${tab === 'rules' ? 'primary' : 'ghost'} sm`}
              onClick={() => setTab('rules')}
            >
              Rules
            </button>
            <button
              class={`btn ${tab === 'plan' ? 'primary' : 'ghost'} sm`}
              onClick={() => setTab('plan')}
            >
              Plan {plan ? `(${plan.total})` : ''}
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

      {tab === 'rules' ? (
        <RulesPanel
          rules={rules}
          onCreate={() => setCreating(true)}
          onEdit={(r) => setEditing(r)}
          onDelete={async (r) => {
            if (!confirm(`Delete rule "${r.name}"?`)) return;
            try {
              await api.deleteRule(r.id);
              reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          onToggle={async (r) => {
            try {
              await api.updateRule(r.id, { enabled: !r.enabled });
              reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          onPlan={onPlanClicked}
          busy={busy}
        />
      ) : (
        <PlanPanel
          plan={plan}
          drives={drives}
          rules={rules}
          selected={selected}
          setSelected={setSelected}
          onPlan={onPlanClicked}
          onApply={() => onApplyClicked('apply')}
          onDryRun={() => onApplyClicked('dryrun')}
          onApplyAll={() => onApplyAllClicked('apply')}
          onDryRunAll={() => onApplyAllClicked('dryrun')}
          busy={busy}
          removeEmptySourceDirs={removeEmptySourceDirs}
          setRemoveEmptySourceDirs={setRemoveEmptySourceDirs}
          pageOffset={pageOffset}
          pageSize={PAGE_SIZE}
          onPageChange={goToPage}
        />
      )}

      {creating ? (
        <RuleForm
          onCancel={() => setCreating(false)}
          onSubmit={async (r) => {
            await api.createRule(r);
            setCreating(false);
            reload();
          }}
        />
      ) : null}
      {editing ? (
        <RuleForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSubmit={async (r) => {
            await api.updateRule(editing.id, r);
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      {showRoots ? (
        <DriveRootsPrompt
          driveIds={
            showRoots === 'plan'
              ? drives.filter((d) => !d.mountPath).map((d) => d.id)
              : missingMountDrives([...operationsForDrive])
          }
          title={
            showRoots === 'plan'
              ? 'Confirm drive roots before planning'
              : showRoots === 'dryrun'
                ? 'Confirm drive roots for dry-run'
                : 'Confirm drive roots before applying'
          }
          onCancel={() => setShowRoots(null)}
          onResolve={(roots) => {
            setShowRoots(null);
            if (showRoots === 'plan') void runPlan(roots);
            else void runApply(showRoots, roots);
          }}
        />
      ) : null}
    </div>
  );
}

interface RulesPanelProps {
  rules: Rule[];
  onCreate: () => void;
  onEdit: (r: Rule) => void;
  onDelete: (r: Rule) => void;
  onToggle: (r: Rule) => void;
  onPlan: () => void;
  busy: boolean;
}

function RulesPanel({ rules, onCreate, onEdit, onDelete, onToggle, onPlan, busy }: RulesPanelProps) {
  return (
    <div class="card">
      <div class="card-hd">
        <span>Rules</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button class="btn primary sm" onClick={onCreate}>
            New rule
          </button>
          <button class="btn ghost sm" onClick={onPlan} disabled={busy || rules.length === 0}>
            Run planner
          </button>
        </div>
      </div>
      {rules.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 11.5 }}>
          No rules yet. Click "New rule" to add one.
        </div>
      ) : (
        <table class="tbl">
          <thead>
            <tr>
              <th style={{ width: 48 }}>Pri</th>
              <th>Name</th>
              <th>Match</th>
              <th>Destination</th>
              <th>Policy</th>
              <th style={{ width: 200, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} style={r.enabled ? undefined : { opacity: 0.5 }}>
                <td class="mono tnum">{r.priority}</td>
                <td>{r.name}</td>
                <td class="mono" style={{ fontSize: 10.5, color: 'var(--fg-2)' }}>
                  {summarizeMatch(r)}
                </td>
                <td class="mono" style={{ fontSize: 10.5, color: 'var(--fg-2)' }}>
                  <span class="pill accent">{r.destinationRole}</span> {r.destinationTemplate}
                </td>
                <td>{r.movePolicy}</td>
                <td style={{ textAlign: 'right' }}>
                  <button class="btn ghost sm" onClick={() => onToggle(r)}>
                    {r.enabled ? 'Disable' : 'Enable'}
                  </button>{' '}
                  <button class="btn ghost sm" onClick={() => onEdit(r)}>
                    Edit
                  </button>{' '}
                  <button class="btn ghost sm danger" onClick={() => onDelete(r)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface PlanPanelProps {
  plan: OrganizePlanResponse | null;
  drives: DriveRecord[];
  rules: Rule[];
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  onPlan: () => void;
  onApply: () => void;
  onDryRun: () => void;
  onApplyAll: () => void;
  onDryRunAll: () => void;
  busy: boolean;
  removeEmptySourceDirs: boolean;
  setRemoveEmptySourceDirs: (v: boolean) => void;
  pageOffset: number;
  pageSize: number;
  onPageChange: (offset: number) => void;
}

function PlanPanel({
  plan,
  drives,
  rules,
  selected,
  setSelected,
  onPlan,
  onApply,
  onDryRun,
  onApplyAll,
  onDryRunAll,
  busy,
  removeEmptySourceDirs,
  setRemoveEmptySourceDirs,
  pageOffset,
  pageSize,
  onPageChange,
}: PlanPanelProps) {
  if (!plan) {
    return (
      <div class="card">
        <div class="card-hd">
          <span>Plan</span>
          <div style={{ marginLeft: 'auto' }}>
            <button class="btn primary sm" onClick={onPlan} disabled={busy}>
              Run planner
            </button>
          </div>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 11.5 }}>
          {busy ? 'Planning…' : 'Click "Run planner" to evaluate rules against the catalog.'}
        </div>
      </div>
    );
  }

  const driveById = new Map(drives.map((d) => [d.id, d]));
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const movableOps = plan.operations.filter((o) => o.kind !== 'noop');
  const totalSelectedBytes = movableOps
    .filter((o) => selected.has(o.fileId))
    .reduce((sum, o) => sum + o.estimatedBytes, 0);

  const toggle = (fileId: number) => {
    const next = new Set(selected);
    if (next.has(fileId)) next.delete(fileId);
    else next.add(fileId);
    setSelected(next);
  };

  const allOn = movableOps.length > 0 && movableOps.every((o) => selected.has(o.fileId));
  const toggleAll = () => {
    if (allOn) setSelected(new Set());
    else setSelected(new Set(movableOps.map((o) => o.fileId)));
  };

  const totalPages = Math.max(1, Math.ceil(plan.total / pageSize));
  const currentPage = Math.floor(pageOffset / pageSize) + 1;
  const canPrev = !busy && pageOffset > 0;
  const canNext = !busy && plan.hasMore;

  return (
    <div class="card">
      <div class="card-hd">
        <span>Plan</span>
        <span class="pill info">
          {plan.total} ops · {plan.unmatched.length} unmatched
        </span>
        <span class="pill" title="Selected on this page">
          {selected.size} selected · {formatBytes(totalSelectedBytes)}
        </span>
        {plan.unresolvedRoles.length ? (
          <span class="pill warn">{plan.unresolvedRoles.length} unresolved</span>
        ) : null}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: 'var(--fg-2)',
              cursor: 'pointer',
            }}
            title="After applying, remove any source folders that have become empty"
          >
            <input
              type="checkbox"
              checked={removeEmptySourceDirs}
              onChange={(e) =>
                setRemoveEmptySourceDirs((e.target as HTMLInputElement).checked)
              }
            />
            Also remove source folders that become empty
          </label>
          <button class="btn ghost sm" onClick={onPlan} disabled={busy}>
            Re-plan
          </button>
          <button class="btn ghost sm" onClick={onDryRun} disabled={busy || selected.size === 0}>
            Dry-run ({selected.size})
          </button>
          <button
            class="btn primary sm"
            onClick={onApply}
            disabled={busy || selected.size === 0}
          >
            Apply ({selected.size}) · {formatBytes(totalSelectedBytes)}
          </button>
          <button
            class="btn ghost sm"
            onClick={onDryRunAll}
            disabled={busy || plan.total === 0}
            title="Dry-run every operation in the plan, across all pages"
          >
            Dry-run all ({plan.total})
          </button>
          <button
            class="btn primary sm"
            onClick={onApplyAll}
            disabled={busy || plan.total === 0}
            title="Apply every operation in the plan, across all pages"
          >
            Apply all ({plan.total} · {formatBytes(plan.totalBytes)})
          </button>
        </div>
      </div>

      {plan.total > pageSize ? (
        <div
          style={{
            padding: '6px 12px',
            borderTop: '1px solid var(--bd)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 11,
            color: 'var(--fg-2)',
          }}
        >
          <button
            class="btn ghost sm"
            onClick={() => onPageChange(Math.max(pageOffset - pageSize, 0))}
            disabled={!canPrev}
          >
            Prev
          </button>
          <button
            class="btn ghost sm"
            onClick={() => onPageChange(pageOffset + pageSize)}
            disabled={!canNext}
          >
            Next
          </button>
          <span class="mono tnum">
            Page {currentPage} of {totalPages}
          </span>
          <span style={{ color: 'var(--fg-3)' }}>
            (selection resets on page change — apply this page first)
          </span>
        </div>
      ) : null}

      {plan.unresolvedRoles.length ? (
        <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--warn)' }}>
          Unresolved roles:{' '}
          {plan.unresolvedRoles
            .map((u) => {
              const r = ruleById.get(u.ruleId);
              return `${r?.name ?? u.ruleId}: ${u.reason} (×${u.fileCount})`;
            })
            .join('; ')}
        </div>
      ) : null}

      <RuleStatsRow stats={plan.ruleStats} ruleById={ruleById} />


      {movableOps.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 11.5 }}>
          Nothing to move. Either every file already lives at its rule destination, or no rule
          matched.
        </div>
      ) : (
        <table class="tbl">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={toggleAll}
                  aria-label="select all"
                />
              </th>
              <th>Source</th>
              <th>Destination</th>
              <th style={{ width: 110 }}>Kind</th>
              <th style={{ width: 90 }}>Rule</th>
              <th style={{ width: 90, textAlign: 'right' }}>Size</th>
            </tr>
          </thead>
          <tbody>
            {movableOps.map((op) => {
              const sd = driveById.get(op.sourceDriveId);
              const dd = driveById.get(op.destDriveId);
              const rule = ruleById.get(op.ruleId);
              return (
                <tr
                  key={op.fileId}
                  class={selected.has(op.fileId) ? 'selected' : undefined}
                  onClick={() => toggle(op.fileId)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(op.fileId)}
                      onChange={() => toggle(op.fileId)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td class="mono" style={{ fontSize: 10.5 }}>
                    <span class="pill mono">{sd?.label ?? op.sourceDriveId.slice(0, 6)}</span>{' '}
                    {op.sourcePath}
                  </td>
                  <td class="mono" style={{ fontSize: 10.5 }}>
                    <span class="pill accent mono">{dd?.label ?? op.destDriveId.slice(0, 6)}</span>{' '}
                    {op.destPath}
                  </td>
                  <td class="mono" style={{ fontSize: 10.5 }}>
                    {op.kind === 'cross-drive-move' ? (
                      <span class="pill warn">cross</span>
                    ) : (
                      <span class="pill ok">same</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11 }}>{rule?.name ?? op.ruleId.slice(0, 8)}</td>
                  <td class="mono tnum" style={{ textAlign: 'right' }}>
                    {formatBytes(op.estimatedBytes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RuleStatsRow({
  stats,
  ruleById,
}: {
  stats: RuleStatUI[];
  ruleById: Map<string, Rule>;
}) {
  const interesting = stats.filter((s) => s.wouldMatch > 0);
  if (interesting.length === 0) return null;
  return (
    <div
      style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--bd)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        fontSize: 11,
      }}
    >
      <span class="label-cap" style={{ alignSelf: 'center' }}>
        Rule reach
      </span>
      {interesting.map((s) => {
        const rule = ruleById.get(s.ruleId);
        const shadowed = s.actualMatch < s.wouldMatch;
        const fully = s.wouldMatch > 0 && s.actualMatch === 0;
        const pillClass = fully ? 'pill warn' : shadowed ? 'pill info' : 'pill ok';
        const tip = fully
          ? 'Fully shadowed — every file this rule would match is being claimed by a higher-priority rule.'
          : shadowed
            ? `${s.wouldMatch - s.actualMatch} of ${s.wouldMatch} files were claimed by a higher-priority rule.`
            : 'Every file this rule would match is being claimed by it.';
        return (
          <span key={s.ruleId} class={pillClass} title={tip}>
            {rule?.name ?? s.ruleId.slice(0, 8)}: {s.actualMatch}/{s.wouldMatch}
          </span>
        );
      })}
    </div>
  );
}

function summarizeMatch(r: Rule): string {
  const parts: string[] = [];
  if (r.match.category && r.match.category.length) parts.push(r.match.category.join('|'));
  if (r.match.dateBefore) parts.push(`<${r.match.dateBefore}`);
  if (r.match.dateAfter) parts.push(`>${r.match.dateAfter}`);
  if (r.match.pathGlob) parts.push(`glob:${r.match.pathGlob}`);
  if (r.match.minSizeBytes != null) parts.push(`>=${r.match.minSizeBytes}b`);
  if (r.match.maxSizeBytes != null) parts.push(`<=${r.match.maxSizeBytes}b`);
  return parts.join(' · ') || '*';
}
