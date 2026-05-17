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

  describe('listDuplicates AbortSignal plumbing', () => {
    it('passes the signal to fetch when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ groups: [], operations: [], total: 0, hasMore: false }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = new ApiClient({ baseUrl: 'http://localhost:1234' });
      const controller = new AbortController();
      await client.listDuplicates({ signal: controller.signal });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/duplicates'),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('does NOT include signal key when no signal is passed', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ groups: [], operations: [], total: 0, hasMore: false }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = new ApiClient({ baseUrl: 'http://localhost:1234' });
      await client.listDuplicates();
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(init ?? {}).not.toHaveProperty('signal');
    });

    it('rejects with AbortError when the signal is already aborted before the call', async () => {
      // Simulate fetch throwing DOMException(AbortError) on an aborted signal.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      ));
      const client = new ApiClient({ baseUrl: 'http://localhost:1234' });
      const controller = new AbortController();
      controller.abort();
      await expect(client.listDuplicates({ signal: controller.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });
});
