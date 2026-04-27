import type { DriveRecord, RoleDefinition } from '@fileorganizer/shared';

export interface ResolveOptions {
  role: RoleDefinition;
  drives: Map<string, DriveRecord>;
}

export interface ResolveResult {
  driveId: string | null;
  reason: string;
}

export function resolveRole(opts: ResolveOptions): ResolveResult {
  for (const driveId of opts.role.drivePriority) {
    const drive = opts.drives.get(driveId);
    if (!drive) continue;
    if (!drive.connected) continue;
    const usedPct =
      drive.totalBytes > 0
        ? ((drive.totalBytes - drive.freeBytes) / drive.totalBytes) * 100
        : 0;
    if (usedPct >= opts.role.fillThresholdPercent) continue;
    return { driveId: drive.id, reason: `selected ${drive.label}` };
  }
  return {
    driveId: null,
    reason: `no drive in role "${opts.role.name}" available`,
  };
}
