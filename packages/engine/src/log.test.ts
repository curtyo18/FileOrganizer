import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from './log.js';

describe('createLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('emits structured JSON lines', () => {
    const writes: string[] = [];
    const log = createLogger({ level: 'info', write: (line) => writes.push(line) });
    log.info('hello', { k: 1 });
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.k).toBe(1);
    expect(typeof parsed.ts).toBe('string');
  });

  it('respects level filtering', () => {
    const writes: string[] = [];
    const log = createLogger({ level: 'warn', write: (line) => writes.push(line) });
    log.debug('skip');
    log.info('skip');
    log.warn('keep');
    log.error('keep');
    expect(writes).toHaveLength(2);
  });

  it('child logger merges base context', () => {
    const writes: string[] = [];
    const log = createLogger({ level: 'info', write: (line) => writes.push(line) });
    const child = log.child({ scanId: 'abc' });
    child.info('x', { y: 2 });
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.scanId).toBe('abc');
    expect(parsed.y).toBe(2);
  });
});
