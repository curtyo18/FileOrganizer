import { readPointer, writePointer, defaultCatalogPath } from '../catalog/locator.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { seedDefaultRules } from '../rules/defaults.js';
import { seedDefaultRoles } from '../roles/defaults.js';
import { ThrottleManager } from '../throttle/manager.js';
import { ThrottleScheduler } from '../throttle/scheduler.js';
import { createServer } from '../api/server.js';
import { reconcileOnStartup } from '../catalog/reconcile.js';
import { Optimizer } from '../catalog/optimizer.js';

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
  seedDefaultRoles(db);
  seedDefaultRules(db);

  const reconciled = await reconcileOnStartup(db);
  console.log(
    `Reconciled ${reconciled.scanned} in-progress operations (${reconciled.ambiguous} ambiguous)`,
  );

  const optimizer = new Optimizer(db);
  optimizer.runIfDue();
  const optimizerHandle = optimizer.startInterval();

  let throttleManager = new ThrottleManager(
    new SettingsRepo(db).load().throttleProfiles,
    'balanced',
    new SettingsRepo(db).load().throttleSchedule,
  );
  let scheduler: ThrottleScheduler | null = null;

  const server = await createServer({
    db,
    port: opts.port ?? 0,
    hostname: '127.0.0.1',
    catalogPath: ptr.catalogPath,
    onSettingsChanged: (next) => {
      const activeProfile = throttleManager.current().name;
      throttleManager = new ThrottleManager(
        next.throttleProfiles,
        activeProfile,
        next.throttleSchedule,
      );
      scheduler?.stop();
      scheduler = new ThrottleScheduler({
        manager: throttleManager,
        events: server.events,
        intervalMs: 60_000,
      });
      scheduler.start();
    },
  });
  writePointer(opts.pointerPath, { catalogPath: ptr.catalogPath, uiPort: server.port });

  scheduler = new ThrottleScheduler({
    manager: throttleManager,
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
