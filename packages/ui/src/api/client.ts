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
