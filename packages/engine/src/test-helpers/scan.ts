import type { Catalog } from '../catalog/connection.js';

export interface ScanRow {
  id: string;
  status: string;
  drive_id: string;
  started_at: string;
  finished_at: string | null;
  throttle_profile: string;
  progress: string;
}

export async function waitForScanStatus(
  db: Catalog,
  scanId: string,
  target: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ScanRow> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 50;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = db.prepare(`SELECT * FROM scans WHERE id = ?`).get(scanId) as ScanRow | undefined;
    if (row && row.status === target) return row;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `timed out waiting for scan ${scanId} to reach status ${target} after ${timeoutMs} ms`,
  );
}
