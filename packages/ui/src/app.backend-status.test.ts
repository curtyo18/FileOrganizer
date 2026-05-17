/**
 * Unit tests for the backend-reachability tracking logic (Sub-fix A).
 *
 * The logic in app.tsx is: after OFFLINE_THRESHOLD consecutive failures the
 * offline indicator is shown; a single success resets the counter. We test
 * this as a pure state-machine so we can reason about it without mounting
 * the full App component (which would require router, keyboard shortcuts, etc.).
 */
import { describe, it, expect } from 'vitest';

const OFFLINE_THRESHOLD = 3;

/**
 * Pure model of the consecutive-failure counter.
 * Returns { reachable, failures } after applying `events` (true = success, false = failure).
 */
function runBackendStatusMachine(events: boolean[]): { reachable: boolean; failures: number } {
  let failures = 0;
  let reachable = true;

  for (const success of events) {
    if (success) {
      failures = 0;
      reachable = true;
    } else {
      failures += 1;
      if (failures >= OFFLINE_THRESHOLD) {
        reachable = false;
      }
    }
  }

  return { reachable, failures };
}

describe('backend status machine (app.tsx Sub-fix A)', () => {
  it('starts reachable with zero failures', () => {
    expect(runBackendStatusMachine([])).toEqual({ reachable: true, failures: 0 });
  });

  it('stays reachable after fewer than threshold failures', () => {
    const result = runBackendStatusMachine([false, false]);
    expect(result.reachable).toBe(true);
    expect(result.failures).toBe(2);
  });

  it('goes offline exactly at the threshold', () => {
    const result = runBackendStatusMachine([false, false, false]);
    expect(result.reachable).toBe(false);
    expect(result.failures).toBe(3);
  });

  it('stays offline past the threshold', () => {
    const result = runBackendStatusMachine([false, false, false, false]);
    expect(result.reachable).toBe(false);
    expect(result.failures).toBe(4);
  });

  it('recovers immediately on a single success after being offline', () => {
    const result = runBackendStatusMachine([false, false, false, true]);
    expect(result.reachable).toBe(true);
    expect(result.failures).toBe(0);
  });

  it('resets the counter after a success, so failures restart from zero', () => {
    // 2 failures → success (counter resets) → 2 more failures: still reachable
    const result = runBackendStatusMachine([false, false, true, false, false]);
    expect(result.reachable).toBe(true);
    expect(result.failures).toBe(2);
  });

  it('goes offline again after recovery if enough failures accumulate', () => {
    const result = runBackendStatusMachine([false, false, false, true, false, false, false]);
    expect(result.reachable).toBe(false);
    expect(result.failures).toBe(3);
  });
});
