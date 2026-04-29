export const CATEGORIES = [
  'image',
  'video',
  'audio',
  'document',
  'spreadsheet',
  'presentation',
  'archive',
  'ebook',
  'code',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const DRIVE_KINDS = ['local', 'external', 'network'] as const;
export type DriveKind = (typeof DRIVE_KINDS)[number];

export type ScanStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type FileState =
  | 'indexed'
  | 'quarantined'
  | 'moved'
  | 'deleted-from-source'
  | 'missing';

export type DateSource = 'exif' | 'mtime' | 'none';

export type ThrottleProfileName = 'idle' | 'balanced' | 'full-send';

export type BatchKind =
  | 'scan'
  | 'move'
  | 'dedupe'
  | 'quarantine-empty'
  | 'restore'
  | 'undo'
  | 'one-off-move';

export type OperationKind = 'move' | 'copy' | 'quarantine' | 'restore' | 'delete';

export type OperationStatus =
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'completed-via-existing'
  | 'failed'
  | 'reverted'
  | 'dry-run';

export type MovePolicy = 'same-drive-auto' | 'cross-drive-review' | 'always-review';
export type QuarantinePolicy = 'default' | 'skip-quarantine';

export interface DriveRecord {
  id: string;
  volumeSerial: string;
  label: string;
  currentLetter: string | null;
  mountPath: string | null;
  kind: DriveKind;
  roles: string[];
  totalBytes: number;
  freeBytes: number;
  lastSeenAt: string;
  connected: boolean;
}

export interface FileRecord {
  id: number;
  driveId: string;
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  category: Category;
  sha256: string;
  mtime: string;
  ctime: string;
  exifDate: string | null;
  dateSource: DateSource;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  ntfsFileId: string | null;
  state: FileState;
  lastVerifiedAt: string;
  scanId: string;
}

export interface ScanRecord {
  id: string;
  driveId: string;
  startedAt: string;
  finishedAt: string | null;
  status: ScanStatus;
  rootPaths: string[];
  throttleProfile: ThrottleProfileName;
  progress: ScanProgress;
  stats: ScanStats;
}

export interface ScanProgress {
  lastCompletedDirectory: string | null;
  filesSeen: number;
  filesIndexed: number;
  filesSkipped: number;
  bytesProcessed: number;
}

export interface ScanStats extends ScanProgress {
  errors: number;
}

export interface BatchRecord {
  id: string;
  kind: BatchKind;
  startedAt: string;
  finishedAt: string | null;
  status: OperationStatus;
  description: string;
  summary: Record<string, unknown>;
}

export interface OperationRecord {
  id: number;
  batchId: string;
  kind: OperationKind;
  fileId: number | null;
  sourceDriveId: string | null;
  sourcePath: string | null;
  destDriveId: string | null;
  destPath: string | null;
  preHash: string | null;
  postHash: string | null;
  quarantinePath: string | null;
  status: OperationStatus;
  errorMessage: string | null;
}

export interface QuarantineEntry {
  id: number;
  driveId: string;
  originalPath: string;
  originalSize: number;
  originalSha256: string;
  originalMtime: string;
  quarantinePath: string;
  quarantinedAt: string;
  batchId: string;
}
