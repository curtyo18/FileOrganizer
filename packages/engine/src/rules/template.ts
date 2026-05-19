import { basename, extname } from 'node:path';
import type { FileRecord } from '@fileorganizer/shared';
import { RuleError } from '@fileorganizer/shared';

const FIELD_RE = /\{([a-z_]+)(?::(\d+))?\}/g;

export function renderTemplate(template: string, file: FileRecord, driveLabel: string): string {
  return template.replace(FIELD_RE, (_match, field: string, pad?: string) => {
    const padN = pad ? parseInt(pad, 10) : 0;
    switch (field) {
      case 'year':
        return String(yearOf(file)).padStart(4, '0');
      case 'month':
        return padDigits(monthOf(file), padN || 1);
      case 'day':
        return padDigits(dayOf(file), padN || 1);
      case 'filename':
        return file.name;
      case 'stem':
        return basename(file.name, extname(file.name));
      case 'ext':
        return file.extension;
      case 'category':
        return file.category;
      case 'drive_label':
        return driveLabel;
      default:
        throw new RuleError('TEMPLATE_UNKNOWN_FIELD', `unknown field {${field}}`);
    }
  });
}

function dateOf(file: FileRecord, fieldName: string): Date {
  const raw = file.exifDate ?? file.mtime;
  if (!raw) {
    throw new RuleError('TEMPLATE_NO_DATE', `cannot render {${fieldName}} without date`);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new RuleError('TEMPLATE_NO_DATE', `cannot render {${fieldName}} without date`);
  }
  return d;
}

function yearOf(file: FileRecord): number {
  return dateOf(file, 'year').getUTCFullYear();
}

function monthOf(file: FileRecord): number {
  return dateOf(file, 'month').getUTCMonth() + 1;
}

function dayOf(file: FileRecord): number {
  return dateOf(file, 'day').getUTCDate();
}

function padDigits(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
