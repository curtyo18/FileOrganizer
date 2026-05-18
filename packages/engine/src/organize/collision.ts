import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { hashFile } from '../scan/hasher.js';

export type CollisionDecision =
  | { kind: 'use-as-is'; path: string }
  | { kind: 'suffix'; path: string }
  | { kind: 'same-content'; path: string };

// 1 000 attempts before giving up: avoids an infinite loop if a destination
// directory is already packed with identically-named files.
const MAX_SUFFIX_ATTEMPTS = 1000;

export async function resolveCollision(
  destPath: string,
  sourceHash: string,
  chunkBytes: number,
): Promise<CollisionDecision> {
  if (!existsSync(destPath)) {
    return { kind: 'use-as-is', path: destPath };
  }
  const existingHash = await hashFile(destPath, { chunkBytes, sleepMs: 0 });
  if (existingHash === sourceHash) {
    return { kind: 'same-content', path: destPath };
  }
  const dir = dirname(destPath);
  const ext = extname(destPath);
  const stem = basename(destPath, ext);
  for (let i = 1; i < MAX_SUFFIX_ATTEMPTS; i += 1) {
    const candidate = join(dir, `${stem}_${i}${ext}`);
    if (!existsSync(candidate)) {
      return { kind: 'suffix', path: candidate };
    }
  }
  throw new Error(`exhausted suffixes for ${destPath}`);
}
