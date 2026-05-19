import { z } from 'zod';

// SettingsSchema lives in the catalog layer to keep the dependency flow
// catalog → api (not the other way). Re-export here so callers importing
// from api/validators.ts continue to work without changes.
export { SettingsSchema } from '../catalog/settings-schema.js';

// CreateRoleInput schema — mirrors packages/engine/src/roles/repo.ts CreateRoleInput
// which is just RoleDefinition from shared/settings.ts
export const CreateRoleInputSchema = z.object({
  name: z.string().min(1),
  drivePriority: z.array(z.string()),
  fillThresholdPercent: z.number().min(0).max(100),
});

// UpdateRoleInput schema — mirrors packages/engine/src/roles/repo.ts UpdateRoleInput
export const UpdateRoleInputSchema = z.object({
  drivePriority: z.array(z.string()).optional(),
  fillThresholdPercent: z.number().min(0).max(100).optional(),
});
