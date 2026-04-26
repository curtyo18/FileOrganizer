import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from './client.js';

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listDrives calls /api/drives and returns drives array', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ drives: [{ id: '1', label: 'X' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ baseUrl: 'http://localhost:1234' });
    const result = await client.listDrives();
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:1234/api/drives',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws on non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'oops' }),
    );
    const client = new ApiClient({ baseUrl: 'http://localhost:1234' });
    await expect(client.listDrives()).rejects.toThrow(/500/);
  });
});
