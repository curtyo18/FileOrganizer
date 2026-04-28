import type { ThrottleProfileName } from '@fileorganizer/shared';
import type { ThrottleManager } from './manager.js';
import type { EventBus } from '../api/events.js';

export interface SchedulerOptions {
  manager: ThrottleManager;
  events: EventBus;
  intervalMs: number;
}

export class ThrottleScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: SchedulerOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick(): void {
    const before: ThrottleProfileName = this.opts.manager.current().name;
    const next = this.opts.manager.profileForDate(new Date()).name;
    if (next !== before) {
      this.opts.manager.setProfile(next);
      this.opts.events.publish({ type: 'throttle-changed', profile: next });
    }
  }
}
