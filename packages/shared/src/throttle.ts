import type { ThrottleProfileName } from './types.js';

export interface ThrottleProfile {
  name: ThrottleProfileName;
  localHashWorkers: number;
  networkHashWorkers: number;
  readChunkBytes: number;
  interChunkSleepMs: number;
  maxOpenFiles: number;
}

export interface ThrottleScheduleEntry {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  profile: ThrottleProfileName;
}

export function defaultThrottleProfiles(cpuCount: number): Record<ThrottleProfileName, ThrottleProfile> {
  return {
    idle: {
      name: 'idle',
      localHashWorkers: 1,
      networkHashWorkers: 1,
      readChunkBytes: 256 * 1024,
      interChunkSleepMs: 5,
      maxOpenFiles: 4,
    },
    balanced: {
      name: 'balanced',
      localHashWorkers: Math.max(1, Math.floor(cpuCount / 2)),
      networkHashWorkers: 1,
      readChunkBytes: 1024 * 1024,
      interChunkSleepMs: 1,
      maxOpenFiles: 16,
    },
    'full-send': {
      name: 'full-send',
      localHashWorkers: Math.max(1, cpuCount),
      networkHashWorkers: 2,
      readChunkBytes: 4 * 1024 * 1024,
      interChunkSleepMs: 0,
      maxOpenFiles: 64,
    },
  };
}
