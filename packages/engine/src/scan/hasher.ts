import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export interface HashOptions {
  chunkBytes: number;
  sleepMs: number;
}

export async function hashFile(path: string, opts: HashOptions): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(opts.chunkBytes);
    for (;;) {
      const result = await handle.read(buf, 0, buf.length);
      if (result.bytesRead === 0) break;
      hash.update(buf.subarray(0, result.bytesRead));
      if (opts.sleepMs > 0) await delay(opts.sleepMs);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}
