#!/usr/bin/env tsx
/**
 * Downloads mediainfo CLI for the host platform into packages/engine/bin/.
 * Run via: npm run fetch-binaries
 *
 * If the download fails (corporate proxy, sandbox, registry blocked, etc.)
 * the engine code already tolerates a missing mediainfo binary (returns
 * null video metadata), so this script logs a clear error and exits 1
 * without leaving a half-extracted binary behind.
 */
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = join(ROOT, 'packages', 'engine', 'bin');

interface Binary {
  name: string;
  url: string;
  archiveEntry: string;
  outName: string;
}

const BINARIES: Binary[] = [
  {
    name: 'mediainfo',
    url: 'https://mediaarea.net/download/binary/mediainfo/24.06/MediaInfo_CLI_24.06_Windows_x64.zip',
    archiveEntry: 'MediaInfo.exe',
    outName: process.platform === 'win32' ? 'mediainfo.exe' : 'mediainfo',
  },
];

async function ensureBinary(b: Binary): Promise<void> {
  const outPath = join(BIN_DIR, b.outName);
  if (existsSync(outPath)) {
    console.log(`[fetch-binaries] ${b.name} present at ${outPath}`);
    return;
  }
  mkdirSync(BIN_DIR, { recursive: true });

  const tmpZip = join(BIN_DIR, `${b.name}.zip`);
  console.log(`[fetch-binaries] downloading ${b.name} from ${b.url}`);
  const res = await fetch(b.url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} fetching ${b.url}`);
  }
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmpZip));

  try {
    console.log(`[fetch-binaries] extracting ${b.archiveEntry} → ${outPath}`);
    extractZipEntry(tmpZip, b.archiveEntry, outPath);
    if (process.platform !== 'win32') chmodSync(outPath, 0o755);
  } finally {
    unlinkSync(tmpZip);
  }
}

/**
 * Extract a single named entry from a zip archive into outPath.
 * Supports stored (method 0) and deflate (method 8). The mediainfo zip
 * uses deflate; that's all we need.
 */
function extractZipEntry(zipPath: string, entryName: string, outPath: string): void {
  const buf = readFileSync(zipPath);
  const eocd = findEndOfCentralDirectory(buf);
  const cdEntries = readCentralDirectory(buf, eocd.cdOffset, eocd.cdEntries);

  const match =
    cdEntries.find((e) => e.fileName === entryName) ??
    cdEntries.find((e) => e.fileName.endsWith(`/${entryName}`));
  if (!match) {
    const names = cdEntries.map((e) => e.fileName).join(', ');
    throw new Error(`zip entry "${entryName}" not found. Archive contained: ${names}`);
  }

  // Local file header: 30-byte fixed prefix + variable filename + extra field, then payload.
  const lfh = match.localHeaderOffset;
  if (buf.readUInt32LE(lfh) !== 0x04034b50) {
    throw new Error(`bad local file header signature at offset ${lfh}`);
  }
  const lfhFilenameLen = buf.readUInt16LE(lfh + 26);
  const lfhExtraLen = buf.readUInt16LE(lfh + 28);
  const dataStart = lfh + 30 + lfhFilenameLen + lfhExtraLen;
  const compressed = buf.subarray(dataStart, dataStart + match.compressedSize);

  let payload: Buffer;
  if (match.method === 0) {
    payload = compressed;
  } else if (match.method === 8) {
    payload = inflateRawSync(compressed);
  } else {
    throw new Error(`unsupported compression method ${match.method} for ${entryName}`);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  // Write to a temp path and rename so a partial write doesn't masquerade as success.
  const tmpOut = `${outPath}.partial`;
  try {
    writeFileSync(tmpOut, payload);
    renameSync(tmpOut, outPath);
  } catch (err) {
    if (existsSync(tmpOut)) rmSync(tmpOut, { force: true });
    throw err;
  }
}

interface CentralDirEntry {
  fileName: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readCentralDirectory(
  buf: Buffer,
  cdOffset: number,
  cdEntries: number,
): CentralDirEntry[] {
  const out: CentralDirEntry[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < cdEntries; i += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`bad central directory entry signature at offset ${cursor}`);
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const fileNameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cursor + 42);
    const fileName = buf.subarray(cursor + 46, cursor + 46 + fileNameLen).toString('utf8');
    out.push({ fileName, method, compressedSize, uncompressedSize, localHeaderOffset });
    cursor += 46 + fileNameLen + extraLen + commentLen;
  }
  return out;
}

interface EocdInfo {
  cdOffset: number;
  cdEntries: number;
}

function findEndOfCentralDirectory(buf: Buffer): EocdInfo {
  // EOCD is at least 22 bytes and may have a comment up to 65535 bytes.
  const minScan = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= minScan; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      const cdEntries = buf.readUInt16LE(i + 10);
      const cdOffset = buf.readUInt32LE(i + 16);
      return { cdEntries, cdOffset };
    }
  }
  throw new Error('end-of-central-directory record not found (corrupt zip?)');
}

async function main(): Promise<void> {
  let failed = 0;
  for (const b of BINARIES) {
    try {
      await ensureBinary(b);
    } catch (err) {
      console.error(`[fetch-binaries] ${b.name} failed: ${(err as Error).message}`);
      console.error(
        `[fetch-binaries] you can install ${b.name} manually by downloading it from ${b.url}, ` +
          `extracting ${b.archiveEntry}, and dropping it at ${join(BIN_DIR, b.outName)}.`,
      );
      failed += 1;
    }
  }
  if (failed > 0) process.exit(1);
}

await main();
