import type { DriveRecord } from '@fileorganizer/shared';

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
