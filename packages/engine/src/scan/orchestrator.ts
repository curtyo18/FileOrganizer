import type { Catalog } from '../catalog/connection.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { EmptyDirsRepo } from '../catalog/empty-dirs-repo.js';
import { DriveRepo } from '../drives/repo.js';
import { detectVolume } from '../drives/volume.js';
import { walk } from './walker.js';
import { hashFile } from './hasher.js';
import { extractImageMetadata } from './metadata-image.js';
import { extractVideoMetadata } from './metadata-video.js';
import { resolveFileDate } from './date-resolver.js';
import { DEFAULT_EXCLUDED_NAMES } from './exclusions.js';
import {
  categoryForExtension,
  type CategoryMap,
  ScanError,
} from '@fileorganizer/shared';
import type { ThrottleManager, ThrottleManagerRef } from '../throttle/manager.js';
import type { Logger } from '../log.js';
import { dirname } from 'node:path';

const PROGRESS_INTERVAL_MS = 1000;
const PROGRESS_FILE_CADENCE = 50;

export interface RunScanOptions {
  db: Catalog;
  driveId: string;
  roots: string[];
  categoryMap: CategoryMap;
  throttle: ThrottleManager | ThrottleManagerRef;
  log: Logger;
  mediainfoPath: string;
  extraExcluded?: readonly string[];
  signal?: AbortSignal;
  onStart?: (scanId: string) => void;
}

export interface RunScanResult {
  scanId: string;
  filesSeen: number;
  filesIndexed: number;
  filesUnchanged: number;
  filesSkipped: number;
  errors: number;
  cancelled: boolean;
}

// Discriminated result returned by processOneFile for each walker entry.
type ProcessResult =
  | { kind: 'skipped-no-category' }
  | { kind: 'skipped-unchanged' }
  | { kind: 'indexed'; bytesProcessed: number }
  | { kind: 'error'; err: Error; bytesProcessed: 0 };

interface ScanContext {
  scanId: string;
  driveId: string;
  filesRepo: FilesRepo;
  scansRepo: ScansRepo;
  categoryMap: CategoryMap;
  throttle: ThrottleManager | ThrottleManagerRef;
  mediainfoPath: string;
  log: Logger;
}

async function processOneFile(
  entry: import('./walker.js').WalkEntry,
  ctx: ScanContext,
): Promise<ProcessResult> {
  const category = categoryForExtension(ctx.categoryMap, entry.extension);
  if (!category) {
    return { kind: 'skipped-no-category' };
  }
  try {
    const qc = ctx.filesRepo.quickCheck(ctx.driveId, entry.path, entry.sizeBytes, entry.mtime);
    if (qc.kind === 'skip') {
      ctx.filesRepo.bumpLastVerified(qc.fileId, ctx.scanId);
      return { kind: 'skipped-unchanged' };
    }
    const profile = ctx.throttle.current();
    const sha = await hashFile(entry.path, {
      chunkBytes: profile.readChunkBytes,
      sleepMs: profile.interChunkSleepMs,
    });
    let exifDate: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let durationSeconds: number | null = null;
    if (category === 'image') {
      const m = await extractImageMetadata(entry.path, { log: ctx.log });
      exifDate = m.exifDate;
      width = m.width;
      height = m.height;
    } else if (category === 'video') {
      const m = await extractVideoMetadata(entry.path, { binaryPath: ctx.mediainfoPath, log: ctx.log });
      exifDate = m.exifDate;
      width = m.width;
      height = m.height;
      durationSeconds = m.durationSeconds;
    }
    const resolved = resolveFileDate({ exifDate, mtime: entry.mtime });
    ctx.filesRepo.upsertOne({
      driveId: ctx.driveId,
      path: entry.path,
      name: entry.name,
      extension: entry.extension,
      sizeBytes: entry.sizeBytes,
      category,
      sha256: sha,
      mtime: entry.mtime,
      ctime: entry.ctime,
      exifDate: resolved.source === 'exif' ? resolved.date : null,
      dateSource: resolved.source,
      width,
      height,
      durationSeconds,
      ntfsFileId: entry.ino,
      state: 'indexed',
      scanId: ctx.scanId,
    });
    return { kind: 'indexed', bytesProcessed: entry.sizeBytes };
  } catch (err) {
    ctx.log.warn('file-error', { path: entry.path, err: (err as Error).message });
    return { kind: 'error', err: err as Error, bytesProcessed: 0 };
  }
}

function finishScan(
  status: 'cancelled' | 'completed' | 'failed',
  scanId: string,
  ctx: Pick<ScanContext, 'scansRepo' | 'log'>,
  summary: { filesIndexed: number; filesUnchanged: number; filesSkipped: number; errors: number },
): void {
  ctx.scansRepo.finish(scanId, status, { errors: summary.errors });
  if (status === 'cancelled') {
    ctx.log.info('scan-cancelled', {
      filesIndexed: summary.filesIndexed,
      filesUnchanged: summary.filesUnchanged,
      filesSkipped: summary.filesSkipped,
      errors: summary.errors,
    });
  } else {
    ctx.log.info('scan-completed', {
      filesIndexed: summary.filesIndexed,
      filesUnchanged: summary.filesUnchanged,
      filesSkipped: summary.filesSkipped,
      errors: summary.errors,
    });
  }
}

export async function runScan(opts: RunScanOptions): Promise<RunScanResult> {
  // Pre-flight: verify the drive's volume serial hasn't changed since registration.
  // Catches the drive-letter-remapped case where the catalog and physical drive disagree.
  // Conditions for skipping the check:
  //   - mountPath is null: drive registered without a known mount point.
  //   - stored serial starts with 'synth-': a synthetic serial derived from the path.
  //     Synth serials are path-based (not mount-based) on POSIX and can't reliably
  //     detect remapping — detectVolume(mountPath) would always produce a different
  //     synth value than detectVolume(originalPath). Only real OS-issued serials
  //     (Windows volume UniqueId) support the remapping-detection guarantee.
  const drive = new DriveRepo(opts.db).findById(opts.driveId);
  if (!drive) throw new ScanError('DRIVE_NOT_FOUND', `drive ${opts.driveId} not registered`);
  if (drive.mountPath !== null && !drive.volumeSerial.startsWith('synth-')) {
    const live = detectVolume(drive.mountPath);
    if (live.volumeSerial !== drive.volumeSerial) {
      throw new ScanError(
        'VOLUME_SERIAL_MISMATCH',
        `drive ${drive.label} (id=${opts.driveId}) volume serial changed: catalog=${drive.volumeSerial} live=${live.volumeSerial}`,
      );
    }
  }

  const filesRepo = new FilesRepo(opts.db);
  const scansRepo = new ScansRepo(opts.db);
  const emptyDirsRepo = new EmptyDirsRepo(opts.db);
  const scan = scansRepo.start({
    driveId: opts.driveId,
    rootPaths: opts.roots,
    throttleProfile: opts.throttle.current().name,
  });
  opts.onStart?.(scan.id);
  const log = opts.log.child({ scanId: scan.id });
  log.info('scan-started', { roots: opts.roots });

  const ctx: ScanContext = {
    scanId: scan.id,
    driveId: opts.driveId,
    filesRepo,
    scansRepo,
    categoryMap: opts.categoryMap,
    throttle: opts.throttle,
    mediainfoPath: opts.mediainfoPath,
    log,
  };

  const allowedExtensions = collectAllowedExtensions(opts.categoryMap);
  let filesSeen = 0;
  let filesIndexed = 0;
  let filesUnchanged = 0;
  let filesSkipped = 0;
  let errors = 0;
  let bytesProcessed = 0;
  let lastDir: string | null = null;
  let lastProgressAt = Date.now();
  let filesSinceProgress = 0;

  let cancelled = false;
  try {
    const walkOpts: import('./walker.js').WalkOptions = {
      roots: opts.roots,
      extensions: allowedExtensions,
      excluded: DEFAULT_EXCLUDED_NAMES,
      extraExcluded: opts.extraExcluded ?? [],
      log,
      onEmptyDir: (path) =>
        emptyDirsRepo.upsert(opts.driveId, path, scan.id, new Date().toISOString()),
    };
    if (opts.signal) walkOpts.signal = opts.signal;
    const walker = walk(walkOpts);

    const flushProgress = () => {
      scansRepo.updateProgress(scan.id, {
        lastCompletedDirectory: lastDir,
        filesSeen,
        filesIndexed,
        filesSkipped,
        bytesProcessed,
      });
      lastProgressAt = Date.now();
      filesSinceProgress = 0;
    };

    for await (const entry of walker) {
      if (opts.signal?.aborted) {
        cancelled = true;
        break;
      }
      filesSeen += 1;
      filesSinceProgress += 1;
      const dirPart = dirname(entry.path);
      const dirChanged = dirPart !== lastDir;
      if (dirChanged) lastDir = dirPart;
      if (
        dirChanged ||
        filesSinceProgress >= PROGRESS_FILE_CADENCE ||
        Date.now() - lastProgressAt >= PROGRESS_INTERVAL_MS
      ) {
        flushProgress();
      }
      const result = await processOneFile(entry, ctx);
      if (result.kind === 'skipped-no-category') { filesSkipped += 1; }
      else if (result.kind === 'skipped-unchanged') { filesUnchanged += 1; }
      else if (result.kind === 'indexed') { filesIndexed += 1; bytesProcessed += result.bytesProcessed; }
      else { errors += 1; }
    }

    // The in-loop check fires between files. If cancel arrives after the
    // last file but before finalization, we'd otherwise finish as
    // 'completed'. Re-check the signal one more time so that race lands
    // as 'cancelled'.
    if (!cancelled && opts.signal?.aborted) {
      cancelled = true;
    }

    if (!cancelled) {
      filesRepo.markMissing(opts.driveId, scan.id, opts.roots);
      // Drop empty_dirs rows from prior scans that this walk didn't
      // re-confirm. Skipped on cancel: a partial walk would otherwise wipe
      // the prior scan's correct state, and removeEmptyDirs re-checks each
      // path with readdir before deleting anyway.
      emptyDirsRepo.pruneStale(opts.driveId, scan.id);
    }
    scansRepo.updateProgress(scan.id, {
      lastCompletedDirectory: lastDir,
      filesSeen,
      filesIndexed,
      filesSkipped,
      bytesProcessed,
    });
    finishScan(
      cancelled ? 'cancelled' : 'completed',
      scan.id,
      ctx,
      { filesIndexed, filesUnchanged, filesSkipped, errors },
    );
  } catch (err) {
    scansRepo.finish(scan.id, 'failed', { errors });
    log.error('scan-failed', { err: (err as Error).message });
    throw err;
  }

  return {
    scanId: scan.id,
    filesSeen,
    filesIndexed,
    filesUnchanged,
    filesSkipped,
    errors,
    cancelled,
  };
}

function collectAllowedExtensions(map: CategoryMap): ReadonlySet<string> {
  const exts = new Set<string>();
  for (const list of Object.values(map)) {
    for (const ext of list) exts.add(ext.toLowerCase());
  }
  return exts;
}
