import { readPointer, writePointer } from '../catalog/locator.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { createServer } from '../api/server.js';
import { CatalogError } from '@fileorganizer/shared';

export interface ServeCliOptions {
  pointerPath: string;
  port?: number;
}

export async function runServe(opts: ServeCliOptions): Promise<void> {
  const ptr = readPointer(opts.pointerPath);
  if (!ptr) {
    throw new CatalogError('POINTER_MISSING', `no catalog pointer at ${opts.pointerPath}`);
  }
  const db = openCatalog(ptr.catalogPath);
  migrate(db);
  const server = await createServer({ db, port: opts.port ?? 0, hostname: '127.0.0.1' });
  writePointer(opts.pointerPath, { catalogPath: ptr.catalogPath, uiPort: server.port });
  console.log(`Engine listening on http://127.0.0.1:${server.port}`);
  console.log(`Catalog: ${ptr.catalogPath}`);
  console.log('Press Ctrl+C to stop.');

  const shutdown = async () => {
    await server.close();
    closeCatalog(db);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
