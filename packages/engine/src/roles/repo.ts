import type { Catalog } from '../catalog/connection.js';
import { RuleError, type RoleDefinition } from '@fileorganizer/shared';
import { DriveRepo } from '../drives/repo.js';

export type CreateRoleInput = RoleDefinition;

export interface UpdateRoleInput {
  drivePriority?: string[];
  fillThresholdPercent?: number;
}

export class RolesRepo {
  private readonly drives: DriveRepo;

  constructor(private readonly db: Catalog) {
    this.drives = new DriveRepo(db);
  }

  create(input: CreateRoleInput): RoleDefinition {
    this.validateDrives(input.drivePriority);
    const existing = this.findByName(input.name);
    if (existing) {
      throw new RuleError('ROLE_EXISTS', `role ${input.name} already exists`);
    }
    this.db
      .prepare(
        `INSERT INTO roles (name, drive_priority, fill_threshold_percent, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.name,
        JSON.stringify(input.drivePriority),
        input.fillThresholdPercent,
        new Date().toISOString(),
      );
    return this.findByName(input.name)!;
  }

  update(name: string, patch: UpdateRoleInput): RoleDefinition {
    const existing = this.findByName(name);
    if (!existing) {
      throw new RuleError('ROLE_NOT_FOUND', `role ${name} not found`);
    }
    if (patch.drivePriority) this.validateDrives(patch.drivePriority);
    const next: RoleDefinition = {
      name: existing.name,
      drivePriority: patch.drivePriority ?? existing.drivePriority,
      fillThresholdPercent: patch.fillThresholdPercent ?? existing.fillThresholdPercent,
    };
    this.db
      .prepare(
        `UPDATE roles SET drive_priority = ?, fill_threshold_percent = ? WHERE name = ?`,
      )
      .run(JSON.stringify(next.drivePriority), next.fillThresholdPercent, name);
    return next;
  }

  delete(name: string): void {
    this.db.prepare(`DELETE FROM roles WHERE name = ?`).run(name);
  }

  list(): RoleDefinition[] {
    const rows = this.db
      .prepare(`SELECT name, drive_priority, fill_threshold_percent FROM roles ORDER BY created_at ASC, name ASC`)
      .all() as Array<{
        name: string;
        drive_priority: string;
        fill_threshold_percent: number;
      }>;
    return rows.map(toRole);
  }

  findByName(name: string): RoleDefinition | null {
    const row = this.db
      .prepare(`SELECT name, drive_priority, fill_threshold_percent FROM roles WHERE name = ?`)
      .get(name) as
      | { name: string; drive_priority: string; fill_threshold_percent: number }
      | undefined;
    return row ? toRole(row) : null;
  }

  private validateDrives(driveIds: string[]): void {
    if (driveIds.length === 0) return;
    const known = new Set(this.drives.list().map((d) => d.id));
    for (const id of driveIds) {
      if (!known.has(id)) {
        throw new RuleError('UNKNOWN_DRIVE_IN_ROLE', `unknown drive id ${id}`);
      }
    }
  }
}

function toRole(row: {
  name: string;
  drive_priority: string;
  fill_threshold_percent: number;
}): RoleDefinition {
  return {
    name: row.name,
    drivePriority: JSON.parse(row.drive_priority) as string[],
    fillThresholdPercent: row.fill_threshold_percent,
  };
}
