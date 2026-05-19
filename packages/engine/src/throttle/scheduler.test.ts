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

  // --- New tests for injectable now(), boundary alignment, and sleep/wake ---

  it('crossing a window boundary calls setProfile + publishes throttle-changed exactly once with post-boundary profile', () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));

    // Monday at 08:59:30 — before the 09:00 balanced window
    let currentTime = new Date('2024-01-08T08:59:30');
    const nowFn = () => currentTime;

    const monday = new Date('2024-01-08T00:00:00');
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: monday.getDay(), startHour: 9, endHour: 17, profile: 'balanced' },
    ]);

    const scheduler = new ThrottleScheduler({
      manager,
      events: bus,
      intervalMs: 60_000,
      now: nowFn,
    });

    // Start at 08:59:30 — no change yet (still in default 'idle')
    scheduler.start();
    expect(manager.current().name).toBe('idle');

    // Advance injected clock past the 09:00 boundary, then tick
    currentTime = new Date('2024-01-08T09:00:30');
    scheduler.tick();

    expect(manager.current().name).toBe('balanced');
    const changes = events.filter((e): e is ThrottleChangedEvent => e.type === 'throttle-changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.profile).toBe('balanced');

    scheduler.stop();
  });

  it('simulated 8-hour sleep+wake: next tick re-evaluates and matches schedule for current hour', () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));

    // Wednesday schedule:
    //   00:00-06:00 → full-send
    //   06:00-22:00 → balanced
    //   22:00-24:00 → (no entry, falls back to current)
    // Start at 07:00 Wednesday (balanced window).
    let currentTime = new Date('2024-01-10T07:00:00'); // Wednesday
    const nowFn = () => currentTime;

    const wednesday = new Date('2024-01-10T00:00:00');
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: wednesday.getDay(), startHour: 0, endHour: 6, profile: 'full-send' },
      { dayOfWeek: wednesday.getDay(), startHour: 6, endHour: 22, profile: 'balanced' },
    ]);

    const scheduler = new ThrottleScheduler({
      manager,
      events: bus,
      intervalMs: 60_000,
      now: nowFn,
    });

    // Start at 07:00 — balanced window
    scheduler.start();
    expect(manager.current().name).toBe('balanced');

    // Simulate machine sleeping from 20:00 through midnight; wakes at 05:00 Thursday.
    // We fake Thursday 05:00 as still Wednesday for this test by keeping Wed DOW and
    // injecting 05:00 (inside the 00:00-06:00 full-send window on Wednesday).
    currentTime = new Date('2024-01-10T05:00:00');
    scheduler.tick();
    // 05:00 is inside the 00:00-06:00 full-send window → profile should be full-send
    expect(manager.current().name).toBe('full-send');

    // Now advance to 08:00 Wednesday (balanced window again)
    currentTime = new Date('2024-01-10T08:00:00');
    scheduler.tick();
    expect(manager.current().name).toBe('balanced');

    scheduler.stop();
  });

  it('start() performs immediate evaluation so profile is correct at boot without waiting for next tick', () => {
    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));

    // Start at 09:30 Monday, which is inside the balanced window
    const currentTime = new Date('2024-01-08T09:30:00');
    const nowFn = () => currentTime;

    const monday = new Date('2024-01-08T00:00:00');
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: monday.getDay(), startHour: 9, endHour: 17, profile: 'balanced' },
    ]);

    const scheduler = new ThrottleScheduler({
      manager,
      events: bus,
      intervalMs: 60_000,
      now: nowFn,
    });

    // Before start, profile is still 'idle' (initial)
    expect(manager.current().name).toBe('idle');

    // start() should immediately evaluate
    scheduler.start();
    expect(manager.current().name).toBe('balanced');

    const changes = events.filter((e): e is ThrottleChangedEvent => e.type === 'throttle-changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.profile).toBe('balanced');

    scheduler.stop();
  });

  it('tick() respects injected now() — no vi.useFakeTimers needed', () => {
    // This test deliberately uses no fake timer manipulation — it relies purely on the injected clock
    vi.useRealTimers();

    const bus = new EventBus();
    const events: EngineEvent[] = [];
    bus.subscribe((e) => events.push(e));

    let currentTime = new Date('2024-01-08T08:59:00');
    const nowFn = () => currentTime;

    const monday = new Date('2024-01-08T00:00:00');
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: monday.getDay(), startHour: 9, endHour: 17, profile: 'balanced' },
    ]);

    const scheduler = new ThrottleScheduler({
      manager,
      events: bus,
      intervalMs: 60_000,
      now: nowFn,
    });

    // Tick before boundary — no change
    scheduler.tick();
    expect(manager.current().name).toBe('idle');

    // Advance injected clock past boundary
    currentTime = new Date('2024-01-08T09:01:00');
    scheduler.tick();
    expect(manager.current().name).toBe('balanced');

    const changes = events.filter((e): e is ThrottleChangedEvent => e.type === 'throttle-changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.profile).toBe('balanced');
  });
});
