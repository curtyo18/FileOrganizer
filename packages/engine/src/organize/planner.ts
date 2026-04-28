import { isAbsolute, resolve } from 'node:path';
import type {
  DriveRecord,
  FileRecord,
  RoleDefinition,
} from '@fileorganizer/shared';
import type { Catalog } from '../catalog/connection.js';
import { DriveRepo } from '../drives/repo.js';
import { RulesRepo } from '../rules/repo.js';
import { RolesRepo } from '../roles/repo.js';
import { firstMatch, matches } from '../rules/matcher.js';
import { renderTemplate } from '../rules/template.js';
import { resolveRole } from '../rules/role-resolver.js';

export type OperationKindPlanned = 'same-drive-move' | 'cross-drive-move' | 'noop';

export interface PlannedOperation {
  fileId: number;
  ruleId: string;
  sourceDriveId: string;
  sourcePath: string;
  destDriveId: string;
  destPath: string;
  kind: OperationKindPlanned;
  estimatedBytes: number;
}

export interface UnresolvedRole {
  ruleId: string;
  reason: string;
}

export interface RuleStat {
  ruleId: string;
  wouldMatch: number;
  actualMatch: number;
}

export interface OrganizePlan {
  operations: PlannedOperation[];
  unmatched: number[];
  unresolvedRoles: UnresolvedRole[];
  ruleStats: RuleStat[];
}

export interface PlanInput {
  db: Catalog;
  driveRoots: Map<string, string>;
  roles?: RoleDefinition[];
}

export function planOrganize(input: PlanInput): OrganizePlan {
  const rules = new RulesRepo(input.db).list();
  const drives = new DriveRepo(input.db).list();
  const drivesById = new Map<string, DriveRecord>(
    drives.map((d) => [d.id, { ...d, connected: input.driveRoots.has(d.id) }]),
  );
  const roles = input.roles ?? new RolesRepo(input.db).list();
  const roleByName = new Map<string, RoleDefinition>(roles.map((r) => [r.name, r]));

  const operations: PlannedOperation[] = [];
  const unmatched: number[] = [];
  const unresolvedRoles: UnresolvedRole[] = [];
  const wouldMatchCounts = new Map<string, number>(rules.map((r) => [r.id, 0]));
  const actualMatchCounts = new Map<string, number>(rules.map((r) => [r.id, 0]));

  const rows = input.db
    .prepare(`SELECT * FROM files WHERE state = 'indexed' ORDER BY id`)
    .all() as Record<string, unknown>[];

  for (const row of rows) {
    const file = rowToFileRecord(row);
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (matches(file, rule)) {
        wouldMatchCounts.set(rule.id, (wouldMatchCounts.get(rule.id) ?? 0) + 1);
      }
    }
    const rule = firstMatch(file, rules);
    if (!rule) {
      unmatched.push(file.id);
      continue;
    }
    actualMatchCounts.set(rule.id, (actualMatchCounts.get(rule.id) ?? 0) + 1);

    const role = roleByName.get(rule.destinationRole);
    if (!role) {
      unresolvedRoles.push({
        ruleId: rule.id,
        reason: `unknown role "${rule.destinationRole}"`,
      });
      continue;
    }

    const resolved = resolveRole({ role, drives: drivesById });
    if (!resolved.driveId) {
      unresolvedRoles.push({ ruleId: rule.id, reason: resolved.reason });
      continue;
    }

    const destDrive = drivesById.get(resolved.driveId)!;
    const destDriveRoot = input.driveRoots.get(resolved.driveId);
    if (!destDriveRoot) {
      unresolvedRoles.push({
        ruleId: rule.id,
        reason: `no drive root supplied for drive ${resolved.driveId}`,
      });
      continue;
    }

    const rendered = renderTemplate(rule.destinationTemplate, file, destDrive.label);
    const destPath = isAbsolute(rendered) ? rendered : resolve(destDriveRoot, rendered);

    let kind: OperationKindPlanned;
    if (destPath === file.path) {
      kind = 'noop';
    } else if (file.driveId === resolved.driveId) {
      kind = 'same-drive-move';
    } else {
      kind = 'cross-drive-move';
    }

    operations.push({
      fileId: file.id,
      ruleId: rule.id,
      sourceDriveId: file.driveId,
      sourcePath: file.path,
      destDriveId: resolved.driveId,
      destPath,
      kind,
      estimatedBytes: file.sizeBytes,
    });
  }

  const ruleStats: RuleStat[] = rules.map((r) => ({
    ruleId: r.id,
    wouldMatch: wouldMatchCounts.get(r.id) ?? 0,
    actualMatch: actualMatchCounts.get(r.id) ?? 0,
  }));

  return { operations, unmatched, unresolvedRoles, ruleStats };
}

function rowToFileRecord(row: Record<string, unknown>): FileRecord {
  return {
    id: row['id'] as number,
    driveId: row['drive_id'] as string,
    path: row['path'] as string,
    name: row['name'] as string,
    extension: row['extension'] as string,
    sizeBytes: row['size_bytes'] as number,
    category: row['category'] as FileRecord['category'],
    sha256: row['sha256'] as string,
    mtime: row['mtime'] as string,
    ctime: row['ctime'] as string,
    exifDate: (row['exif_date'] as string | null) ?? null,
    dateSource: row['date_source'] as FileRecord['dateSource'],
    width: (row['width'] as number | null) ?? null,
    height: (row['height'] as number | null) ?? null,
    durationSeconds: (row['duration_seconds'] as number | null) ?? null,
    ntfsFileId: (row['ntfs_file_id'] as string | null) ?? null,
    state: row['state'] as FileRecord['state'],
    lastVerifiedAt: row['last_verified_at'] as string,
    scanId: row['scan_id'] as string,
  };
}
