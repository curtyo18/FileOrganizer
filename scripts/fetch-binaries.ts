#!/usr/bin/env tsx
/**
 * Downloads mediainfo CLI for Windows into packages/engine/bin/.
 * Run via: npm run fetch-binaries
 *
 * The cloud-sandbox note: if the download is blocked, write a blocker note
 * per Section 0.5 and skip. The engine code already tolerates a missing
 * mediainfo binary (returns null video metadata).
 */
import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = join(ROOT, 'packages', 'engine', 'bin');

interface Binary {
  name: string;
  url: string;
  outName: string;
}

const BINARIES: Binary[] = [
  {
    name: 'mediainfo',
    url: 'https://mediaarea.net/download/binary/mediainfo/24.06/MediaInfo_CLI_24.06_Windows_x64.zip',
    outName: process.platform === 'win32' ? 'mediainfo.exe' : 'mediainfo',
  },
];

async function ensureBinary(b: Binary): Promise<void> {
  const outPath = join(BIN_DIR, b.outName);
  if (existsSync(outPath)) {
    console.log(`[fetch-binaries] ${b.name} already present at ${outPath}`);
    return;
  }
  mkdirSync(BIN_DIR, { recursive: true });
  console.log(`[fetch-binaries] downloading ${b.name} from ${b.url}`);
  const res = await fetch(b.url);
  if (!res.ok || !res.body) {
    throw new Error(`failed to download ${b.name}: HTTP ${res.status}`);
  }
  const tmpZip = join(BIN_DIR, `${b.name}.zip`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmpZip));
  console.log(
    `[fetch-binaries] saved ${b.name} archive to ${tmpZip}.`,
  );
  console.log(
    `[fetch-binaries] M7-T06 will replace this with proper unzip extraction.`,
  );
}

async function main(): Promise<void> {
  for (const b of BINARIES) {
    try {
      await ensureBinary(b);
    } catch (err) {
      console.error(`[fetch-binaries] ${b.name}: ${(err as Error).message}`);
    }
  }
}

main();
