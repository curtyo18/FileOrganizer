import type { DriveKind } from '@fileorganizer/shared';
import type { DuplicateCopy } from './detect.js';

export interface DriveContext {
  kind: DriveKind;
  roles: string[];
}

export interface ScoreOptions {
  drives: Map<string, DriveContext>;
  ruleRole: string | null;
  destinationTemplates: string[];
}

export interface ScoreResult {
  keeperFileId: number;
  reasons: string[];
}

const DRIVE_KIND_SCORE: Record<DriveKind, number> = {
  local: 3,
  external: 1,
  network: 2,
};

export function scoreCopies(copies: DuplicateCopy[], opts: ScoreOptions): ScoreResult {
  if (copies.length === 0) {
    throw new Error('scoreCopies requires at least one copy');
  }
  const reasons: string[] = [];
  const sorted = [...copies].sort((a, b) => {
    const aRole = opts.ruleRole && opts.drives.get(a.driveId)?.roles.includes(opts.ruleRole) ? 1 : 0;
    const bRole = opts.ruleRole && opts.drives.get(b.driveId)?.roles.includes(opts.ruleRole) ? 1 : 0;
    if (aRole !== bRole) return bRole - aRole;
    const aTpl = matchesAnyTemplate(a.path, opts.destinationTemplates) ? 1 : 0;
    const bTpl = matchesAnyTemplate(b.path, opts.destinationTemplates) ? 1 : 0;
    if (aTpl !== bTpl) return bTpl - aTpl;
    const aDepth = pathDepth(a.path);
    const bDepth = pathDepth(b.path);
    if (aDepth !== bDepth) return bDepth - aDepth;
    const aDriveKind = DRIVE_KIND_SCORE[opts.drives.get(a.driveId)?.kind ?? 'local'];
    const bDriveKind = DRIVE_KIND_SCORE[opts.drives.get(b.driveId)?.kind ?? 'local'];
    if (aDriveKind !== bDriveKind) return bDriveKind - aDriveKind;
    if (a.mtime !== b.mtime) return a.mtime < b.mtime ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  const winner = sorted[0]!;
  if (sorted.length > 1) {
    const runnerUp = sorted[1]!;
    if (opts.ruleRole) {
      const wHas = opts.drives.get(winner.driveId)?.roles.includes(opts.ruleRole);
      const rHas = opts.drives.get(runnerUp.driveId)?.roles.includes(opts.ruleRole);
      if (wHas !== rHas) reasons.push(`drive carries role "${opts.ruleRole}"`);
    }
    if (
      matchesAnyTemplate(winner.path, opts.destinationTemplates) !==
      matchesAnyTemplate(runnerUp.path, opts.destinationTemplates)
    ) {
      reasons.push('path matches an organizing rule destination');
    }
    if (pathDepth(winner.path) !== pathDepth(runnerUp.path)) {
      reasons.push(`deeper path (${pathDepth(winner.path)} segments)`);
    }
    const wKind = opts.drives.get(winner.driveId)?.kind;
    const rKind = opts.drives.get(runnerUp.driveId)?.kind;
    if (wKind !== rKind) reasons.push(`drive kind ${wKind} preferred`);
    if (winner.mtime !== runnerUp.mtime) reasons.push(`older mtime (${winner.mtime})`);
    if (reasons.length === 0) reasons.push('lexicographic path tiebreak');
  } else {
    reasons.push('only copy');
  }
  return { keeperFileId: winner.fileId, reasons };
}

function pathDepth(path: string): number {
  return path.split(/[\\/]/).filter(Boolean).length;
}

function matchesAnyTemplate(path: string, templates: string[]): boolean {
  return templates.some((tpl) => path.toLowerCase().includes(tpl.toLowerCase()));
}
