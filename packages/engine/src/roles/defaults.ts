import type { Catalog } from '../catalog/connection.js';
import { RolesRepo } from './repo.js';

export const DEFAULT_ROLE_NAMES = [
  'media-archive',
  'active-documents',
  'document-archive',
] as const;

const DEFAULT_FILL_THRESHOLD_PERCENT = 90;

export function seedDefaultRoles(db: Catalog): number {
  const repo = new RolesRepo(db);
  if (repo.list().length > 0) return 0;
  for (const name of DEFAULT_ROLE_NAMES) {
    repo.create({ name, drivePriority: [], fillThresholdPercent: DEFAULT_FILL_THRESHOLD_PERCENT });
  }
  return DEFAULT_ROLE_NAMES.length;
}
