import { detectDuplicates, countDuplicateGroups, type DuplicateGroup } from './detect.js';
import { scoreCopies, type DriveContext } from './scorer.js';
import type { Catalog } from '../catalog/connection.js';
import { RulesRepo } from '../rules/repo.js';
import { firstMatch } from '../rules/matcher.js';
import type { FileRecord } from '@fileorganizer/shared';
import { toFileRecord } from '../catalog/files-repo.js';

export interface DedupeOperation {
  groupSha256: string;
  keeperFileId: number;
  removeFileId: number;
  reasons: string[];
  reclaimableBytes: number;
}

export interface PlanDedupeOptions {
  minSizeBytes: number;
  limit?: number;
  offset?: number;
}

export interface DedupePlan {
  operations: DedupeOperation[];
  groups: DuplicateGroup[];
  total: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export function planDedupe(db: Catalog, opts: PlanDedupeOptions): DedupePlan {
  const offset = Math.max(opts.offset ?? 0, 0);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const total = countDuplicateGroups(db, { minSizeBytes: opts.minSizeBytes });
  const groups = detectDuplicates(db, {
    minSizeBytes: opts.minSizeBytes,
    limit,
    offset,
  });
  const driveRows = db
    .prepare(`SELECT id, kind, roles FROM drives`)
    .all() as { id: string; kind: 'local' | 'external' | 'network'; roles: string }[];
  const drives = new Map<string, DriveContext>();
  for (const r of driveRows) {
    drives.set(r.id, { kind: r.kind, roles: JSON.parse(r.roles || '[]') });
  }
  const rules = new RulesRepo(db).list();
  const fileCache = new Map<number, FileRecord>();
  const getFileRecord = (fileId: number): FileRecord | null => {
    if (fileCache.has(fileId)) return fileCache.get(fileId)!;
    const row = db
      .prepare(`SELECT * FROM files WHERE id = ?`)
      .get(fileId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const rec = toFileRecord(row);
    fileCache.set(fileId, rec);
    return rec;
  };
  const operations: DedupeOperation[] = [];
  for (const group of groups) {
    // Resolve the matched rule for any copy in the group (all copies share
    // the same SHA256 and therefore the same category/extension, so the
    // first resolvable copy's match is representative for the group).
    let ruleRole: string | null = null;
    let destinationTemplates: string[] = [];
    for (const copy of group.copies) {
      const file = getFileRecord(copy.fileId);
      if (!file) continue;
      const matchedRule = firstMatch(file, rules);
      if (matchedRule) {
        ruleRole = matchedRule.destinationRole ?? null;
        destinationTemplates = [matchedRule.destinationTemplate];
      }
      break;
    }
    const score = scoreCopies(group.copies, {
      drives,
      ruleRole,
      destinationTemplates,
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
  const hasMore = offset + groups.length < total;
  return { operations, groups, total, hasMore };
}
