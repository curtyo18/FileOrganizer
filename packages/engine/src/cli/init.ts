import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { writePointer } from '../catalog/locator.js';
import { SettingsRepo } from '../catalog/settings-repo.js';

export interface InitOptions {
  pointerPath: string;
  catalogPath: string;
}

export function runInit(opts: InitOptions): void {
  const db = openCatalog(opts.catalogPath);
  try {
    migrate(db);
    const settings = new SettingsRepo(db);
    settings.load();
  } finally {
    closeCatalog(db);
  }
  writePointer(opts.pointerPath, { catalogPath: opts.catalogPath, uiPort: 0 });
}
