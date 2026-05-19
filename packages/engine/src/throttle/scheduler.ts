import type { ThrottleProfileName } from '@fileorganizer/shared';
import type { ThrottleManager, ThrottleManagerRef } from './manager.js';
import type { EventBus } from '../api/events.js';

export interface SchedulerOptions {
  manager: ThrottleManager | ThrottleManagerRef;
  events: EventBus;
  intervalMs: number;
  now?: () => Date;
}

export class ThrottleScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => Date;

  constructor(private readonly opts: SchedulerOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    // Immediate evaluation so the profile is correct at boot.
    this.tick();
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  tick(): void {
    const now = this.now();
    this.evaluate(now);
  }

  private evaluate(now: Date): void {
    const before: ThrottleProfileName = this.opts.manager.current().name;
    const next = this.opts.manager.profileForDate(now).name;
    if (next !== before) {
      this.opts.manager.setProfile(next);
      this.opts.events.publish({ type: 'throttle-changed', profile: next });
    }
  }

  private scheduleNext(): void {
    const now = this.now();
    const ms = this.opts.intervalMs - (now.getTime() % this.opts.intervalMs);
    this.timer = setTimeout(() => {
      this.tick();
      this.scheduleNext();
    }, ms);
  }
}
