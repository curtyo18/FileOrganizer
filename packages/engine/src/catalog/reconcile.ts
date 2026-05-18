import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Catalog } from './connection.js';
import { hashFile } from '../scan/hasher.js';
import { createLogger, defaultWriter } from '../log.js';
import { QUARANTINE_DIR_NAME } from '../quarantine/quarantine.js';

const log = createLogger({ level: 'info', write: defaultWriter, context: { module: 'reconcile' } });

export interface ReconcileResult {
  scanned: number;
  fixed: number;
  ambiguous: number;
  quarantineOrphans: string[];
}

interface OpRow {
  id: number;
  batch_id: string;
  kind: string;
  source_path: string | null;
  dest_path: string | null;
  pre_hash: string | null;
  post_hash: string | null;
  status: string;
  quarantine_path: string | null;
}

interface Decision {
  status: 'completed' | 'failed';
  message: string;
}

export async function reconcileOnStartup(db: Catalog): Promise<ReconcileResult> {
  const ops = db
    .prepare(
      `SELECT id, batch_id, kind, source_path, dest_path, pre_hash, post_hash, status, quarantine_path
       FROM operations WHERE status = 'in-progress'`,
    )
    .all() as OpRow[];

  let fixed = 0;
  let ambiguous = 0;

  // Pre-compute all decisions before entering the synchronous DB transaction.
  // better-sqlite3 transactions are sync-only, but decide() is async (file hashing).
  // We process ops serially rather than in parallel to avoid overwhelming the
  // filesystem with concurrent hash operations on large in-progress sets.
  const decisions: Array<{ op: OpRow; decision: Decision }> = [];
  for (const op of ops) {
    const decision = await decide(op);
    decisions.push({ op, decision });
    if (decision.message.includes('ambiguous')) ambiguous += 1;
    else fixed += 1;
  }

  // Apply all op updates and batch finalizations in a single atomic transaction.
  // A mid-loop crash previously left a mix of updated and stale rows; wrapping
  // both loops in one transaction gives all-or-nothing semantics so a restart
  // re-processes the full set correctly.
  db.transaction(() => {
    for (const { op, decision } of decisions) {
      db.prepare(`UPDATE operations SET status = ?, error_message = ? WHERE id = ?`).run(
        decision.status,
        decision.message,
        op.id,
      );
    }

    const touchedBatches = db
      .prepare(`SELECT id AS batch_id FROM batches WHERE status = 'in-progress'`)
      .all() as Array<{ batch_id: string }>;

    for (const { batch_id } of touchedBatches) {
      const counts = db
        .prepare(
          `SELECT
             SUM(CASE WHEN status IN ('pending','in-progress') THEN 1 ELSE 0 END) AS active,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
             COUNT(*) AS total
           FROM operations WHERE batch_id = ?`,
        )
        .get(batch_id) as { active: number | null; failed: number | null; total: number | null };
      if ((counts.total ?? 0) === 0) continue;
      if ((counts.active ?? 0) === 0) {
        const finalStatus = (counts.failed ?? 0) > 0 ? 'failed' : 'completed';
        db.prepare(
          `UPDATE batches SET status = ?, finished_at = ? WHERE id = ? AND status = 'in-progress'`,
        ).run(finalStatus, new Date().toISOString(), batch_id);
      }
    }
  })();

  // Quarantine-scope pass: detect files in _FileOrganizer_quarantine/ with no matching DB row.
  // This is async filesystem I/O and must NOT be inside the synchronous DB transaction above.
  const quarantineOrphans = await detectQuarantineOrphans(db);

  return { scanned: ops.length, fixed, ambiguous, quarantineOrphans };
}

interface DriveRow {
  id: string;
  mount_path: string | null;
}

async function collectLeafFiles(dir: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectLeafFiles(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
}

async function detectQuarantineOrphans(db: Catalog): Promise<string[]> {
  const drives = db.prepare(`SELECT id, mount_path FROM drives`).all() as DriveRow[];

  // Build a Set of all quarantine_path values from the DB for fast lookup
  const catalogued = new Set<string>(
    (db.prepare(`SELECT quarantine_path FROM quarantine`).all() as Array<{ quarantine_path: string }>).map(
      (r) => r.quarantine_path,
    ),
  );

  const orphans: string[] = [];

  for (const drive of drives) {
    if (!drive.mount_path) continue;

    const quarantineRoot = join(drive.mount_path, QUARANTINE_DIR_NAME);
    if (!existsSync(quarantineRoot)) continue;

    let stat;
    try {
      stat = statSync(quarantineRoot);
    } catch {
      log.warn('reconcile-quarantine-scan-skipped', {
        drive_id: drive.id,
        quarantine_root: quarantineRoot,
        reason: 'stat failed – drive may be disconnected',
      });
      continue;
    }
    if (!stat.isDirectory()) continue;

    const diskFiles: string[] = [];
    await collectLeafFiles(quarantineRoot, diskFiles);

    for (const filePath of diskFiles) {
      if (!catalogued.has(filePath)) {
        orphans.push(filePath);
        log.warn('reconcile-quarantine-orphan', {
          drive_id: drive.id,
          path: filePath,
          reason: 'file present in quarantine folder but absent from quarantine table',
        });
      }
    }
  }

  return orphans;
}

async function decide(op: OpRow): Promise<Decision> {
  const destPresent = op.dest_path != null && existsSync(op.dest_path);
  const sourcePresent = op.source_path != null && existsSync(op.source_path);

  if (destPresent && op.post_hash) {
    try {
      const live = await hashFile(op.dest_path!, { chunkBytes: 1024 * 1024, sleepMs: 0 });
      if (live === op.post_hash) {
        return { status: 'completed', message: 'reconciled: destination matches post_hash' };
      }
    } catch {
      // fall through
    }
  }

  if (!destPresent && sourcePresent) {
    return {
      status: 'failed',
      message: 'reconciled: never finished; source intact, dest missing',
    };
  }

  if (!destPresent && !sourcePresent) {
    return { status: 'failed', message: 'reconciled: ambiguous (both source and dest missing)' };
  }

  return { status: 'failed', message: 'reconciled: ambiguous outcome' };
}
