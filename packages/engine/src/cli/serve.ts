import { readPointer, writePointer, defaultCatalogPath } from '../catalog/locator.js';
import { openCatalog, closeCatalog, assertCatalogHealthy } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { seedDefaultRules } from '../rules/defaults.js';
import { seedDefaultRoles } from '../roles/defaults.js';
import { ThrottleManager, ThrottleManagerRef } from '../throttle/manager.js';
import { ThrottleScheduler } from '../throttle/scheduler.js';
import { createServer } from '../api/server.js';
import { reconcileOnStartup } from '../catalog/reconcile.js';
import { Optimizer } from '../catalog/optimizer.js';

const SCHEDULER_INTERVAL_MS = 60_000;

export interface ServeCliOptions {
  pointerPath: string;
  port?: number;
}

export async function runServe(opts: ServeCliOptions): Promise<void> {
  let ptr = readPointer(opts.pointerPath);
  if (!ptr) {
    const catalogPath = defaultCatalogPath();
    console.log(`No catalog pointer at ${opts.pointerPath}. Creating one with default catalog at ${catalogPath}.`);
    const initDb = openCatalog(catalogPath);
    try {
      migrate(initDb);
      assertCatalogHealthy(initDb, catalogPath);
      new SettingsRepo(initDb).load();
      seedDefaultRoles(initDb);
      seedDefaultRules(initDb);
    } finally {
      closeCatalog(initDb);
    }
    writePointer(opts.pointerPath, { catalogPath, uiPort: 0 });
    ptr = { catalogPath, uiPort: 0 };
  }
  const db = openCatalog(ptr.catalogPath);
  migrate(db);
  assertCatalogHealthy(db, ptr.catalogPath);
  seedDefaultRoles(db);
  seedDefaultRules(db);

  const reconciled = await reconcileOnStartup(db);
  console.log(
    `Reconciled ${reconciled.scanned} in-progress operations (${reconciled.ambiguous} ambiguous)`,
  );

  const optimizer = new Optimizer(db);
  optimizer.runIfDue();
  const optimizerHandle = optimizer.startInterval();

  const initialSettings = new SettingsRepo(db).load();
  const initialManager = new ThrottleManager(
    initialSettings.throttleProfiles,
    'balanced',
    initialSettings.throttleSchedule,
  );
  // Process-singleton ref: the scheduler and all API-initiated scans share this
  // handle. Swapping ref.replace() propagates to in-flight scans at their next
  // chunk boundary without passing them a new reference.
  const throttleRef = new ThrottleManagerRef(initialManager);
  let scheduler: ThrottleScheduler | null = null;

  const server = await createServer({
    db,
    port: opts.port ?? 0,
    hostname: '127.0.0.1',
    catalogPath: ptr.catalogPath,
    throttle: throttleRef,
    onSettingsChanged: (next) => {
      const activeProfile = throttleRef.current().name;
      const nextManager = new ThrottleManager(
        next.throttleProfiles,
        activeProfile,
        next.throttleSchedule,
      );
      // Replace the inner manager inside the singleton ref so in-flight scans
      // observe the new profile without being re-wired.
      throttleRef.replace(nextManager);
      scheduler?.stop();
      scheduler = new ThrottleScheduler({
        manager: throttleRef,
        events: server.events,
        intervalMs: SCHEDULER_INTERVAL_MS,
      });
      scheduler.start();
    },
  });
  writePointer(opts.pointerPath, { catalogPath: ptr.catalogPath, uiPort: server.port });

  scheduler = new ThrottleScheduler({
    manager: throttleRef,
    events: server.events,
    intervalMs: 60_000,
  });
  scheduler.start();

  const url = `http://127.0.0.1:${server.port}`;
  console.log('');
  console.log('  FileOrganizer is ready');
  console.log(`  Open ${url} in your browser`);
  console.log(`  Catalog: ${ptr.catalogPath}`);
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      scheduler?.stop();
      clearInterval(optimizerHandle);
      await server.close();
      closeCatalog(db);
      resolve();
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
}
