import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defaultThrottleProfiles } from '@fileorganizer/shared';
import { ThrottleManager } from './manager.js';
import { ThrottleScheduler } from './scheduler.js';
import { EventBus, type EngineEvent, type ThrottleChangedEvent } from '../api/events.js';

describe('ThrottleScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits throttle-changed when the schedule swaps the profile', () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const monday = new Date('2024-01-08T01:00:00');
    vi.setSystemTime(monday);
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: monday.getDay(), startHour: 0, endHour: 6, profile: 'full-send' },
    ]);
    const scheduler = new ThrottleScheduler({ manager, events: bus, intervalMs: 60_000 });
    scheduler.tick();
    expect(manager.current().name).toBe('full-send');
    const changes = events.filter((e): e is ThrottleChangedEvent => e.type === 'throttle-changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.profile).toBe('full-send');
  });

  it('does not emit when the profile is unchanged', () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));
    vi.setSystemTime(new Date('2024-01-08T12:00:00'));
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'balanced', []);
    const scheduler = new ThrottleScheduler({ manager, events: bus, intervalMs: 60_000 });
    scheduler.tick();
    scheduler.tick();
    expect(events.filter((e) => e.type === 'throttle-changed')).toHaveLength(0);
    expect(manager.current().name).toBe('balanced');
  });

  it('emits once per actual transition across multiple ticks', () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const monday = new Date('2024-01-08T01:00:00');
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: monday.getDay(), startHour: 0, endHour: 6, profile: 'full-send' },
      { dayOfWeek: monday.getDay(), startHour: 9, endHour: 17, profile: 'balanced' },
    ]);
    const scheduler = new ThrottleScheduler({ manager, events: bus, intervalMs: 60_000 });

    vi.setSystemTime(new Date('2024-01-08T01:00:00'));
    scheduler.tick();
    vi.setSystemTime(new Date('2024-01-08T02:00:00'));
    scheduler.tick();
    vi.setSystemTime(new Date('2024-01-08T08:00:00'));
    scheduler.tick();
    vi.setSystemTime(new Date('2024-01-08T10:00:00'));
    scheduler.tick();

    const changes = events.filter((e): e is ThrottleChangedEvent => e.type === 'throttle-changed');
    expect(changes.map((c) => c.profile)).toEqual(['full-send', 'balanced']);
  });

  it('start() schedules a recurring tick and stop() clears it', () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const monday = new Date('2024-01-08T05:00:00');
    vi.setSystemTime(monday);
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: monday.getDay(), startHour: 0, endHour: 6, profile: 'full-send' },
    ]);
    const scheduler = new ThrottleScheduler({ manager, events: bus, intervalMs: 60_000 });
    scheduler.start();
    vi.advanceTimersByTime(60_000);
    scheduler.stop();
    vi.advanceTimersByTime(60_000 * 5);
    const changes = events.filter((e) => e.type === 'throttle-changed');
    expect(changes).toHaveLength(1);
  });

  it('start() is idempotent', () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));
    vi.setSystemTime(new Date('2024-01-08T05:00:00'));
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: 1, startHour: 0, endHour: 6, profile: 'full-send' },
    ]);
    const scheduler = new ThrottleScheduler({ manager, events: bus, intervalMs: 60_000 });
    scheduler.start();
    scheduler.start();
    vi.advanceTimersByTime(60_000);
    scheduler.stop();
    const changes = events.filter((e) => e.type === 'throttle-changed');
    expect(changes).toHaveLength(1);
  });
});
