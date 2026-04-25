#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { defaultPointerPath } from '../catalog/locator.js';
import { runInit } from './init.js';
import { runStatus, formatStatus } from './status.js';
import { runScanCli } from './scan.js';
import type { ThrottleProfileName } from '@fileorganizer/shared';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ParsedArgs {
  command: string;
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = 'true';
      }
    }
  }
  return { command: command ?? 'help', flags };
}

export async function runCli(argv: string[]): Promise<CliResult> {
  const { command, flags } = parseArgs(argv);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const pointerPath = flags['pointer'] ?? defaultPointerPath();

  try {
    switch (command) {
      case 'init': {
        const catalog = flags['catalog'];
        if (!catalog) {
          stderr.push('init requires --catalog <path>');
          return { exitCode: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
        }
        runInit({ pointerPath, catalogPath: catalog });
        stdout.push(`Initialized catalog at ${catalog}`);
        return { exitCode: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
      }
      case 'status': {
        const result = runStatus({ pointerPath });
        stdout.push(formatStatus(result));
        return { exitCode: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
      }
      case 'scan': {
        const root = flags['path'];
        if (!root) {
          stderr.push('scan requires --path <directory>');
          return { exitCode: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
        }
        const profile = (flags['profile'] as ThrottleProfileName | undefined) ?? 'balanced';
        const mediainfoPath =
          flags['mediainfo'] ??
          (process.platform === 'win32'
            ? `${process.cwd()}\\packages\\engine\\bin\\mediainfo.exe`
            : `${process.cwd()}/packages/engine/bin/mediainfo`);
        const result = await runScanCli({ pointerPath, rootPath: root, profile, mediainfoPath });
        stdout.push(
          `Scan ${result.scanId} complete:`,
          `  indexed=${result.filesIndexed} unchanged=${result.filesUnchanged} skipped=${result.filesSkipped} errors=${result.errors}`,
        );
        return { exitCode: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
      }
      case 'help':
      case '--help':
      case '-h': {
        stdout.push(
          'fileorganizer <command>',
          'Commands:',
          '  init --catalog <path> [--pointer <path>]',
          '  status [--pointer <path>]',
          '  scan --path <dir> [--profile idle|balanced|full-send] [--mediainfo <path>] [--pointer <path>]',
        );
        return { exitCode: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
      }
      default: {
        stderr.push(`unknown command: ${command}`);
        return { exitCode: 2, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
      }
    }
  } catch (err) {
    stderr.push((err as Error).message);
    return { exitCode: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  }
}

const entryArg = process.argv[1];
const isMain = entryArg ? import.meta.url === pathToFileURL(entryArg).href : false;
if (isMain) {
  runCli(process.argv.slice(2)).then((r) => {
    if (r.stdout) process.stdout.write(r.stdout + '\n');
    if (r.stderr) process.stderr.write(r.stderr + '\n');
    process.exit(r.exitCode);
  });
}
