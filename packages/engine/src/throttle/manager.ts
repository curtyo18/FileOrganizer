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

function hourInWindow(hour: number, start: number, end: number): boolean {
  if (start <= end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}
