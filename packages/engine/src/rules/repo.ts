import { randomUUID } from 'node:crypto';
import type { Catalog } from '../catalog/connection.js';
import type { MovePolicy, QuarantinePolicy, Rule, RuleMatch } from '@fileorganizer/shared';

export interface CreateRuleInput {
  name: string;
  priority: number;
  match: RuleMatch;
  destinationRole: string;
  destinationTemplate: string;
  movePolicy: MovePolicy;
  quarantinePolicy: QuarantinePolicy;
  enabled?: boolean;
}

export type UpdateRuleInput = Partial<CreateRuleInput>;

export class RulesRepo {
  constructor(private readonly db: Catalog) {}

  create(input: CreateRuleInput): Rule {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO rules (id, name, priority, enabled, match_json, destination_role, destination_template, move_policy, quarantine_policy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.priority,
        input.enabled === false ? 0 : 1,
        JSON.stringify(input.match),
        input.destinationRole,
        input.destinationTemplate,
        input.movePolicy,
        input.quarantinePolicy,
      );
    return this.findById(id)!;
  }

  update(id: string, patch: UpdateRuleInput): Rule {
    const existing = this.findById(id);
    if (!existing) throw new Error(`rule ${id} not found`);
    const next: Rule = {
      ...existing,
      ...patch,
      match: patch.match ?? existing.match,
    };
    this.db
      .prepare(
        `UPDATE rules SET name = ?, priority = ?, enabled = ?, match_json = ?, destination_role = ?, destination_template = ?, move_policy = ?, quarantine_policy = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.priority,
        next.enabled ? 1 : 0,
        JSON.stringify(next.match),
        next.destinationRole,
        next.destinationTemplate,
        next.movePolicy,
        next.quarantinePolicy,
        id,
      );
    return this.findById(id)!;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM rules WHERE id = ?`).run(id);
  }

  list(): Rule[] {
    const rows = this.db
      .prepare(`SELECT * FROM rules ORDER BY priority ASC, created_at ASC, name ASC`)
      .all() as Record<string, unknown>[];
    return rows.map(toRule);
  }

  findById(id: string): Rule | null {
    const row = this.db.prepare(`SELECT * FROM rules WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toRule(row) : null;
  }
}

function toRule(row: Record<string, unknown>): Rule {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    priority: row['priority'] as number,
    enabled: (row['enabled'] as number) === 1,
    match: JSON.parse(row['match_json'] as string) as RuleMatch,
    destinationRole: row['destination_role'] as string,
    destinationTemplate: row['destination_template'] as string,
    movePolicy: row['move_policy'] as MovePolicy,
    quarantinePolicy: row['quarantine_policy'] as QuarantinePolicy,
  };
}
