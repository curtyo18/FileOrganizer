import type { DriveRecord } from '@fileorganizer/shared';

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

  async listDuplicates(minSize = 1): Promise<DedupePlanResponse> {
    return this.get<DedupePlanResponse>(`/api/duplicates?minSize=${minSize}`);
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
