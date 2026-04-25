import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CatalogError } from '@fileorganizer/shared';

export interface CatalogPointer {
  catalogPath: string;
  uiPort: number;
}

export function readPointer(path: string): CatalogPointer | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as Partial<CatalogPointer>;
    if (
      typeof parsed.catalogPath !== 'string' ||
      typeof parsed.uiPort !== 'number'
    ) {
      throw new CatalogError('POINTER_INVALID', `pointer file ${path} has unexpected shape`);
    }
    return { catalogPath: parsed.catalogPath, uiPort: parsed.uiPort };
  } catch (err) {
    if (err instanceof CatalogError) throw err;
    throw new CatalogError(
      'POINTER_INVALID',
      `pointer file ${path} is not valid JSON: ${(err as Error).message}`,
      err,
    );
  }
}

export function writePointer(path: string, ptr: CatalogPointer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ptr, null, 2), 'utf-8');
}

export function defaultPointerPath(): string {
  const appData = process.env['APPDATA'];
  if (appData) {
    return `${appData}\\FileOrganizer\\catalog-location.json`;
  }
  const home = process.env['HOME'] ?? process.cwd();
  return `${home}/.fileorganizer/catalog-location.json`;
}
