import type {
  BatchRecord,
  DriveRecord,
  OperationRecord,
  RoleDefinition,
  Rule,
  Settings,
} from '@fileorganizer/shared';

export interface PlannedOperationUI {
  fileId: number;
  ruleId: string;
  sourceDriveId: string;
  sourcePath: string;
  destDriveId: string;
  destPath: string;
  kind: 'same-drive-move' | 'cross-drive-move' | 'noop';
  estimatedBytes: number;
}

export interface RuleStatUI {
  ruleId: string;
  wouldMatch: number;
  actualMatch: number;
}

export interface OrganizePlanResponse {
  operations: PlannedOperationUI[];
  unmatched: number[];
  unresolvedRoles: { ruleId: string; reason: string; fileCount: number }[];
  ruleStats: RuleStatUI[];
}

export interface ApplyResultUI {
  batchId: string;
  completed: number;
  failed: number;
  emptyDirsRemoved: number;
}

export interface UndoResultUI {
  undoBatchId: string;
  reverted: number;
  skipped: number;
  errors: { operationId: number; reason: string }[];
}

export interface DuplicateCopyUI {
  fileId: number;
  driveId: string;
  path: string;
  sizeBytes: number;
  category: string;
  state: string;
  mtime: string;
}

export interface DuplicateGroupUI {
  sha256: string;
  copies: DuplicateCopyUI[];
  fileSizeBytes: number;
  reclaimableBytes: number;
}

export interface DedupeOperation {
  groupSha256: string;
  keeperFileId: number;
  removeFileId: number;
  reasons: string[];
  reclaimableBytes: number;
}

export interface DedupePlanResponse {
  operations: DedupeOperation[];
  groups: DuplicateGroupUI[];
  total: number;
  hasMore: boolean;
}

export interface QuarantineEntryUI {
  id: number;
  driveId: string;
  originalPath: string;
  originalSize: number;
  originalSha256: string;
  originalMtime: string;
  quarantinePath: string;
  quarantinedAt: string;
  batchId: string;
}

export interface ApiClientOptions {
  baseUrl: string;
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  async listDrives(): Promise<DriveRecord[]> {
    const data = await this.get<{ drives: DriveRecord[] }>('/api/drives');
    return data.drives;
  }

  async listFiles(driveId: string, limit = 100, offset = 0): Promise<unknown[]> {
    const data = await this.get<{ files: unknown[] }>(
      `/api/files?driveId=${encodeURIComponent(driveId)}&limit=${limit}&offset=${offset}`,
    );
    return data.files;
  }

  async listScans(driveId?: string): Promise<unknown[]> {
    const q = driveId ? `?driveId=${encodeURIComponent(driveId)}` : '';
    const data = await this.get<{ scans: unknown[] }>(`/api/scans${q}`);
    return data.scans;
  }

  async listDuplicates(input: {
    minSize?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<DedupePlanResponse> {
    const minSize = input.minSize ?? 1;
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    return this.get<DedupePlanResponse>(
      `/api/duplicates?minSize=${minSize}&limit=${limit}&offset=${offset}`,
    );
  }

  async applyDedupe(input: {
    operations: DedupeOperation[];
    driveRoots: Record<string, string>;
  }): Promise<{ batchId: string; completed: number; failed: number; reclaimedBytes: number }> {
    const res = await fetch(`${this.opts.baseUrl}/api/duplicates/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`apply failed: ${res.status}`);
    return res.json() as Promise<{
      batchId: string;
      completed: number;
      failed: number;
      reclaimedBytes: number;
    }>;
  }

  async listQuarantine(driveId?: string): Promise<QuarantineEntryUI[]> {
    const q = driveId ? `?driveId=${encodeURIComponent(driveId)}` : '';
    const data = await this.get<{ entries: QuarantineEntryUI[] }>(`/api/quarantine${q}`);
    return data.entries;
  }

  async restoreQuarantine(input: {
    quarantineIds: number[];
    driveRoots: Record<string, string>;
  }): Promise<{ restored: number; errors: string[] }> {
    const res = await fetch(`${this.opts.baseUrl}/api/quarantine/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`restore failed: ${res.status}`);
    return res.json() as Promise<{ restored: number; errors: string[] }>;
  }

  async getSettings(): Promise<Settings> {
    const data = await this.get<{ settings: Settings }>('/api/settings');
    return data.settings;
  }

  async saveSettings(settings: Settings): Promise<Settings> {
    const res = await fetch(`${this.opts.baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`saveSettings: ${res.status} ${body}`);
    }
    const body = (await res.json()) as { settings: Settings };
    return body.settings;
  }

  async listRoles(): Promise<RoleDefinition[]> {
    const data = await this.get<{ roles: RoleDefinition[] }>('/api/roles');
    return data.roles;
  }

  async createRole(input: RoleDefinition): Promise<RoleDefinition> {
    const res = await fetch(`${this.opts.baseUrl}/api/roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`createRole: ${res.status} ${body}`);
    }
    const body = (await res.json()) as { role: RoleDefinition };
    return body.role;
  }

  async updateRole(name: string, patch: Partial<Omit<RoleDefinition, 'name'>>): Promise<RoleDefinition> {
    const res = await fetch(
      `${this.opts.baseUrl}/api/roles/${encodeURIComponent(name)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`updateRole: ${res.status} ${body}`);
    }
    const body = (await res.json()) as { role: RoleDefinition };
    return body.role;
  }

  async deleteRole(name: string): Promise<void> {
    const res = await fetch(
      `${this.opts.baseUrl}/api/roles/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 204) throw new Error(`deleteRole: ${res.status}`);
  }

  async listRules(): Promise<Rule[]> {
    const data = await this.get<{ rules: Rule[] }>('/api/rules');
    return data.rules;
  }

  async createRule(input: Omit<Rule, 'id'>): Promise<Rule> {
    const res = await fetch(`${this.opts.baseUrl}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`createRule: ${res.status}`);
    const body = (await res.json()) as { rule: Rule };
    return body.rule;
  }

  async updateRule(id: string, patch: Partial<Omit<Rule, 'id'>>): Promise<Rule> {
    const res = await fetch(`${this.opts.baseUrl}/api/rules/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`updateRule: ${res.status}`);
    const body = (await res.json()) as { rule: Rule };
    return body.rule;
  }

  async deleteRule(id: string): Promise<void> {
    const res = await fetch(`${this.opts.baseUrl}/api/rules/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`deleteRule: ${res.status}`);
  }

  async planOrganize(driveRoots: Record<string, string>): Promise<OrganizePlanResponse> {
    const res = await fetch(`${this.opts.baseUrl}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveRoots }),
    });
    if (!res.ok) throw new Error(`planOrganize: ${res.status}`);
    return (await res.json()) as OrganizePlanResponse;
  }

  async organizeApply(input: {
    description: string;
    operations: PlannedOperationUI[];
    driveRoots: Record<string, string>;
    dryRun?: boolean;
    removeEmptySourceDirs?: boolean;
  }): Promise<ApplyResultUI> {
    const res = await fetch(`${this.opts.baseUrl}/api/organize/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`organizeApply: ${res.status}`);
    return (await res.json()) as ApplyResultUI;
  }

  async organizeUndo(
    batchId: string,
    driveRoots: Record<string, string>,
  ): Promise<UndoResultUI> {
    const res = await fetch(`${this.opts.baseUrl}/api/organize/undo/${encodeURIComponent(batchId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveRoots }),
    });
    if (!res.ok) throw new Error(`organizeUndo: ${res.status}`);
    return (await res.json()) as UndoResultUI;
  }

  async listBatches(limit = 100): Promise<BatchRecord[]> {
    const data = await this.get<{ batches: BatchRecord[] }>(`/api/batches?limit=${limit}`);
    return data.batches;
  }

  async getBatch(id: string): Promise<{ batch: BatchRecord; operations: OperationRecord[] }> {
    return this.get<{ batch: BatchRecord; operations: OperationRecord[] }>(
      `/api/batches/${encodeURIComponent(id)}`,
    );
  }

  async startScan(input: {
    driveId?: string;
    rootPath?: string;
    rootPaths?: string[];
    profile?: string;
  }): Promise<unknown> {
    const res = await fetch(`${this.opts.baseUrl}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API /api/scans failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { scan: unknown };
    return data.scan;
  }

  async listEmptyDirs(driveId: string): Promise<{
    driveId: string;
    paths: string[];
    totalEmpty: number;
    truncated: boolean;
  }> {
    return this.get<{
      driveId: string;
      paths: string[];
      totalEmpty: number;
      truncated: boolean;
    }>(`/api/cleanup/empty-dirs?driveId=${encodeURIComponent(driveId)}`);
  }

  async applyCleanupEmptyDirs(input: {
    driveId: string;
    paths: string[];
  }): Promise<{
    batchId: string;
    removed: number;
    failed: { path: string; reason: string }[];
  }> {
    const res = await fetch(`${this.opts.baseUrl}/api/cleanup/empty-dirs/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`applyCleanupEmptyDirs: ${res.status} ${body}`);
    }
    return res.json() as Promise<{
      batchId: string;
      removed: number;
      failed: { path: string; reason: string }[];
    }>;
  }

  async cancelScan(scanId: string): Promise<unknown> {
    const res = await fetch(
      `${this.opts.baseUrl}/api/scans/${encodeURIComponent(scanId)}/cancel`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`cancelScan: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { scan: unknown };
    return data.scan;
  }

  protected get baseUrl(): string {
    return this.opts.baseUrl;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${path} failed: ${res.status} ${body}`);
    }
    return (await res.json()) as T;
  }
}

export function defaultApiClient(): ApiClient {
  return new ApiClient({ baseUrl: '' });
}
