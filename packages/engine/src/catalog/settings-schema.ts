import { z } from 'zod';

// ThrottleProfile schema — mirrors packages/shared/src/throttle.ts ThrottleProfile
export const ThrottleProfileNameSchema = z.enum(['idle', 'balanced', 'full-send']);

export const ThrottleProfileSchema = z.object({
  name: ThrottleProfileNameSchema,
  localHashWorkers: z.number().int().positive(),
  networkHashWorkers: z.number().int().positive(),
  readChunkBytes: z.number().int().positive(),
  interChunkSleepMs: z.number().int().min(0),
  maxOpenFiles: z.number().int().positive(),
});

// ThrottleScheduleEntry schema — mirrors packages/shared/src/throttle.ts
export const ThrottleScheduleEntrySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(24),
  profile: ThrottleProfileNameSchema,
});

// Settings schema — mirrors packages/shared/src/settings.ts Settings
// The settings body from PUT /api/settings is wrapped: { settings: Settings }
export const SettingsSchema = z.object({
  catalogVersion: z.number().int().min(0),
  categoryMap: z.record(z.string(), z.array(z.string())),
  throttleProfiles: z.object({
    idle: ThrottleProfileSchema,
    balanced: ThrottleProfileSchema,
    'full-send': ThrottleProfileSchema,
  }),
  throttleSchedule: z.array(ThrottleScheduleEntrySchema),
  recentArchiveCutoffYears: z.number().int().min(0),
  uiPort: z.number().int().min(0).max(65535),
  userExcluded: z.array(z.string()),
  lastOptimizedAt: z.string().optional(),
});
