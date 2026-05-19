#!/usr/bin/env node
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defaultPointerPath } from '../catalog/locator.js';
import { runInit } from './init.js';
import { runStatus, formatStatus } from './status.js';
import { runScanCli } from './scan.js';
import { runServe } from './serve.js';
import type { ThrottleProfileName } from '@fileorganizer/shared';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION: string = (JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf-8')) as { version: string }).version;
const mediainfoPathDefault =
  process.platform === 'win32'
    ? resolve(packageRoot, 'bin', 'mediainfo.exe')
    : resolve(packageRoot, 'bin', 'mediainfo');

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
      const eq = a.indexOf('=');
      if (eq > 0) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        flags[key] = val;
      } else {
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
  }
  return { command: command ?? 'help', flags };
}

const HELP_LINES = [
  'fileorganizer <command> [--version | -V]',
  'Commands:',
  '  init --catalog <path> [--pointer <path>]',
  '  status [--pointer <path>]',
  '  scan --path <dir> [--profile idle|balanced|full-send] [--mediainfo <path>] [--pointer <path>]',
  '  serve [--port <number>] [--pointer <path>]',
];

export async function runCli(argv: string[]): Promise<CliResult> {
  // Handle --version / -V before full parse (they are top-level flags, not subcommands)
  if (argv.includes('--version') || argv.includes('-V')) {
    return { exitCode: 0, stdout: VERSION, stderr: '' };
  }

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
      case 'serve': {
        const port = flags['port'] ? parseInt(flags['port']!, 10) : undefined;
        await runServe({ pointerPath, ...(port !== undefined ? { port } : {}) });
        return { exitCode: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
      }
      case 'scan': {
        const root = flags['path'];
        if (!root) {
          stderr.push('scan requires --path <directory>');
          return { exitCode: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
        }
        const profile = (flags['profile'] as ThrottleProfileName | undefined) ?? 'balanced';
        const mediainfoPath = flags['mediainfo'] ?? mediainfoPathDefault;
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
        stdout.push(...HELP_LINES);
        return { exitCode: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
      }
      default: {
        stderr.push(`unknown command: ${command}`, ...HELP_LINES);
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
  void runCli(process.argv.slice(2)).then((r) => {
    if (r.stdout) process.stdout.write(r.stdout + '\n');
    if (r.stderr) process.stderr.write(r.stderr + '\n');
    process.exit(r.exitCode);
  });
}
