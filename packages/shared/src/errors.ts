export class FileOrganizerError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class CatalogError extends FileOrganizerError {}
export class ScanError extends FileOrganizerError {}
export class RuleError extends FileOrganizerError {}
export class IntegrityError extends FileOrganizerError {}
export class QuarantineError extends FileOrganizerError {}
export class DriveError extends FileOrganizerError {}

export function isFileOrganizerError(value: unknown): value is FileOrganizerError {
  return value instanceof FileOrganizerError;
}
