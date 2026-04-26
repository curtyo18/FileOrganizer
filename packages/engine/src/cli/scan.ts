import { resolve } from 'node:path';
import { readPointer } from '../catalog/locator.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { detectVolume } from '../drives/volume.js';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { runScan } from '../scan/orchestrator.js';
import { ThrottleManager } from '../throttle/manager.js';
import { createLogger, defaultWriter } from '../log.js';
import { CatalogError } from '@fileorganizer/shared';
import type { ThrottleProfileName } from '@fileorganizer/shared';

export interface ScanCliOptions {
  pointerPath: string;
  rootPath: string;
  profile?: ThrottleProfileName;
  mediainfoPath: string;
}

export interface ScanCliResult {
  scanId: string;
  filesIndexed: number;
  filesUnchanged: number;
  filesSkipped: number;
  errors: number;
}

export async function runScanCli(opts: ScanCliOptions): Promise<ScanCliResult> {
  const ptr = readPointer(opts.pointerPath);
  if (!ptr) {
    throw new CatalogError('POINTER_MISSING', `no catalog pointer at ${opts.pointerPath}`);
  }
  const db = openCatalog(ptr.catalogPath);
  try {
    migrate(db);
    const settings = new SettingsRepo(db).load();
    const drives = new DriveRepo(db);
    const root = resolve(opts.rootPath);
    const volume = detectVolume(root);
    const drive = drives.upsert({
      volumeSerial: volume.volumeSerial,
      label: volume.currentLetter ?? root,
      currentLetter: volume.currentLetter,
      mountPath: volume.mountPath,
      kind: volume.kind,
      roles: [],
      totalBytes: volume.totalBytes,
      freeBytes: volume.freeBytes,
    });
    const profileName: ThrottleProfileName = opts.profile ?? 'balanced';
    const throttle = new ThrottleManager(settings.throttleProfiles, profileName, settings.throttleSchedule);
    const log = createLogger({ level: 'info', write: defaultWriter });
    const result = await runScan({
      db,
      driveId: drive.id,
      roots: [root],
      categoryMap: settings.categoryMap,
      throttle,
      log,
      mediainfoPath: opts.mediainfoPath,
    });
    return {
      scanId: result.scanId,
      filesIndexed: result.filesIndexed,
      filesUnchanged: result.filesUnchanged,
      filesSkipped: result.filesSkipped,
      errors: result.errors,
    };
  } finally {
    closeCatalog(db);
  }
}
