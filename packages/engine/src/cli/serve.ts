import { readPointer, writePointer, defaultCatalogPath } from '../catalog/locator.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { createServer } from '../api/server.js';

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
    } finally {
      closeCatalog(initDb);
    }
    writePointer(opts.pointerPath, { catalogPath, uiPort: 0 });
    ptr = { catalogPath, uiPort: 0 };
  }
  const db = openCatalog(ptr.catalogPath);
  migrate(db);
  const server = await createServer({ db, port: opts.port ?? 0, hostname: '127.0.0.1' });
  writePointer(opts.pointerPath, { catalogPath: ptr.catalogPath, uiPort: server.port });
  const url = `http://127.0.0.1:${server.port}`;
  console.log('');
  console.log('  FileOrganizer is ready');
  console.log(`  Open ${url} in your browser`);
  console.log(`  Catalog: ${ptr.catalogPath}`);
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  const shutdown = async () => {
    await server.close();
    closeCatalog(db);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
