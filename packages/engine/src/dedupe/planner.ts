import { detectDuplicates, type DuplicateGroup } from './detect.js';
import { scoreCopies, type DriveContext } from './scorer.js';
import type { Catalog } from '../catalog/connection.js';

export interface DedupeOperation {
  groupSha256: string;
  keeperFileId: number;
  removeFileId: number;
  reasons: string[];
  reclaimableBytes: number;
}

export interface PlanDedupeOptions {
  minSizeBytes: number;
}

export interface DedupePlan {
  operations: DedupeOperation[];
  groups: DuplicateGroup[];
}

export function planDedupe(db: Catalog, opts: PlanDedupeOptions): DedupePlan {
  const groups = detectDuplicates(db, { minSizeBytes: opts.minSizeBytes });
  const driveRows = db
    .prepare(`SELECT id, kind, roles FROM drives`)
    .all() as { id: string; kind: 'local' | 'external' | 'network'; roles: string }[];
  const drives = new Map<string, DriveContext>();
  for (const r of driveRows) {
    drives.set(r.id, { kind: r.kind, roles: JSON.parse(r.roles || '[]') });
  }
  const operations: DedupeOperation[] = [];
  for (const group of groups) {
    const score = scoreCopies(group.copies, {
      drives,
      ruleRole: null,
      destinationTemplates: [],
    });
    for (const copy of group.copies) {
      if (copy.fileId === score.keeperFileId) continue;
      operations.push({
        groupSha256: group.sha256,
        keeperFileId: score.keeperFileId,
        removeFileId: copy.fileId,
        reasons: score.reasons,
        reclaimableBytes: group.fileSizeBytes,
      });
    }
  }
  return { operations, groups };
}
