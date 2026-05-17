import type {
  ThrottleProfile,
  ThrottleProfileName,
  ThrottleScheduleEntry,
} from '@fileorganizer/shared';

export class ThrottleManager {
  private active: ThrottleProfileName;

  constructor(
    private readonly profiles: Record<ThrottleProfileName, ThrottleProfile>,
    initial: ThrottleProfileName,
    private readonly schedule: ThrottleScheduleEntry[],
  ) {
    this.active = initial;
  }

  current(): ThrottleProfile {
    return this.profiles[this.active];
  }

  setProfile(name: ThrottleProfileName): void {
    this.active = name;
  }

  profileForDate(date: Date): ThrottleProfile {
    const dow = date.getDay();
    const hour = date.getHours();
    for (const entry of this.schedule) {
      if (entry.dayOfWeek !== dow) continue;
      if (hourInWindow(hour, entry.startHour, entry.endHour)) {
        return this.profiles[entry.profile];
      }
    }
    return this.current();
  }
}

/**
 * A stable wrapper around ThrottleManager that allows the active manager to
 * be swapped at runtime (e.g. when settings change) without invalidating
 * references held by in-flight scans.
 *
 * Running scans capture the ref once and call its forwarding methods on every
 * chunk. When cli/serve.ts receives onSettingsChanged it calls replace() and
 * subsequent chunk accesses immediately see the new profile.
 */
export class ThrottleManagerRef {
  private manager: ThrottleManager;

  constructor(initial: ThrottleManager) {
    this.manager = initial;
  }

  /** Replace the inner manager. In-flight scans observe the new profile at
   * the next chunk boundary because they read through this ref. */
  replace(next: ThrottleManager): void {
    this.manager = next;
  }

  current(): ThrottleProfile {
    return this.manager.current();
  }

  setProfile(name: ThrottleProfileName): void {
    this.manager.setProfile(name);
  }

  profileForDate(date: Date): ThrottleProfile {
    return this.manager.profileForDate(date);
  }
}

export function createThrottleManagerRef(initial: ThrottleManager): ThrottleManagerRef {
  return new ThrottleManagerRef(initial);
}

function hourInWindow(hour: number, start: number, end: number): boolean {
  if (start <= end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}
