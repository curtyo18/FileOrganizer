import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { DriveKind } from '@fileorganizer/shared';

export interface VolumeInfo {
  volumeSerial: string;
  totalBytes: number;
  freeBytes: number;
  kind: DriveKind;
  currentLetter: string | null;
}

export function detectVolume(path: string): VolumeInfo {
  const abs = resolve(path);
  if (process.platform === 'win32') {
    return detectWindows(abs);
  }
  return detectPosix(abs);
}

function detectWindows(abs: string): VolumeInfo {
  const driveLetter = /^([A-Za-z]):/.exec(abs)?.[1];
  let serial = '';
  let kind: DriveKind = 'local';
  if (driveLetter) {
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Volume -DriveLetter ${driveLetter} | Select-Object -ExpandProperty UniqueId)`,
        ],
        { encoding: 'utf-8', timeout: 10_000 },
      );
      serial = out.trim();
    } catch {
      serial = '';
    }
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Volume -DriveLetter ${driveLetter} | Select-Object -ExpandProperty DriveType)`,
        ],
        { encoding: 'utf-8', timeout: 10_000 },
      );
      const t = out.trim();
      if (t === 'Removable') kind = 'external';
      else if (t === 'Network') kind = 'network';
      else kind = 'local';
    } catch {
      kind = 'local';
    }
  }
  if (!serial) {
    serial = synthSerial(abs);
  }
  const capacity = capacityFor(abs);
  return {
    volumeSerial: serial,
    totalBytes: capacity.total,
    freeBytes: capacity.free,
    kind,
    currentLetter: driveLetter ? `${driveLetter}:` : null,
  };
}

function detectPosix(abs: string): VolumeInfo {
  const capacity = capacityFor(abs);
  return {
    volumeSerial: synthSerial(abs),
    totalBytes: capacity.total,
    freeBytes: capacity.free,
    kind: 'local',
    currentLetter: null,
  };
}

function capacityFor(abs: string): { total: number; free: number } {
  try {
    const fs = statfsSync(abs);
    return {
      total: Number(fs.bsize) * Number(fs.blocks),
      free: Number(fs.bsize) * Number(fs.bavail),
    };
  } catch {
    return { total: 0, free: 0 };
  }
}

function synthSerial(abs: string): string {
  return 'synth-' + createHash('sha1').update(abs).digest('hex').slice(0, 16);
}
