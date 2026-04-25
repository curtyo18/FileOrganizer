import { describe, it, expect } from 'vitest';
import { ThrottleManager } from './manager.js';
import { defaultThrottleProfiles } from '@fileorganizer/shared';

describe('ThrottleManager', () => {
  it('returns the active profile', () => {
    const profiles = defaultThrottleProfiles(4);
    const m = new ThrottleManager(profiles, 'balanced', []);
    expect(m.current().name).toBe('balanced');
  });

  it('switches via setProfile', () => {
    const profiles = defaultThrottleProfiles(4);
    const m = new ThrottleManager(profiles, 'idle', []);
    m.setProfile('full-send');
    expect(m.current().name).toBe('full-send');
  });

  it('uses schedule to pick profile based on time-of-day', () => {
    const profiles = defaultThrottleProfiles(4);
    const m = new ThrottleManager(profiles, 'balanced', [
      { dayOfWeek: 1, startHour: 22, endHour: 6, profile: 'full-send' },
      { dayOfWeek: 1, startHour: 9, endHour: 18, profile: 'idle' },
    ]);
    const monday11 = new Date('2024-01-08T11:00:00');
    expect(m.profileForDate(monday11).name).toBe('idle');
    const monday23 = new Date('2024-01-08T23:00:00');
    expect(m.profileForDate(monday23).name).toBe('full-send');
    const monday03 = new Date('2024-01-08T03:00:00');
    expect(m.profileForDate(monday03).name).toBe('full-send');
  });

  it('falls back to current profile when no schedule entry matches', () => {
    const profiles = defaultThrottleProfiles(4);
    const m = new ThrottleManager(profiles, 'balanced', []);
    expect(m.profileForDate(new Date()).name).toBe('balanced');
  });
});
