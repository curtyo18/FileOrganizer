import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walk, type WalkOptions, MAX_DEPTH } from './walker.js';
import type { Logger } from '../log.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fileorg-walk-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(rel: string, body = ''): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

const opts: Omit<WalkOptions, 'roots'> = {
  extensions: new Set(['jpg', 'pdf']),
  excluded: new Set(['Windows', 'node_modules']),
  extraExcluded: [],
};

function makeLogger(): { logger: Logger; warns: Array<{ msg: string; fields: Record<string, unknown> }> } {
  const warns: Array<{ msg: string; fields: Record<string, unknown> }> = [];
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: (msg, fields) => warns.push({ msg, fields: fields ?? {} }),
    error: noop,
    child: () => logger,
  };
  return { logger, warns };
}

describe('walk', () => {
  it('emits files matching extension allowlist', async () => {
    touch('a.jpg');
    touch('b.pdf');
    touch('c.exe');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, '').replace(/\\/g, '/'));
    }
    expect(seen.sort()).toEqual(['/a.jpg', '/b.pdf']);
  });

  it('skips excluded directories', async () => {
    touch('keep/a.jpg');
    touch('Windows/skip.jpg');
    touch('node_modules/skip.jpg');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, '').replace(/\\/g, '/'));
    }
    expect(seen).toEqual(['/keep/a.jpg']);
  });

  it('skips dot-prefixed directories', async () => {
    touch('.git/skip.jpg');
    touch('keep.jpg');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, '').replace(/\\/g, '/'));
    }
    expect(seen).toEqual(['/keep.jpg']);
  });

  it('reports size and mtime for emitted files', async () => {
    touch('a.jpg', 'hello');
    for await (const entry of walk({ ...opts, roots: [root] })) {
      expect(entry.sizeBytes).toBe(5);
      expect(typeof entry.mtime).toBe('string');
      expect(entry.extension).toBe('jpg');
    }
  });
});

describe('walk onEmptyDir', () => {
  it('fires for recursively-empty subtrees and skips dirs holding indexed files', async () => {
    // fully empty branch
    mkdirSync(join(root, 'all-empty', 'deep'), { recursive: true });
    // branch whose only files fail the extension allowlist
    touch('non-matching/a.tmp');
    touch('non-matching/sub/b.log');
    // branch whose only child is an excluded name (so the walker never
    // descends into it; the parent yields zero indexed files so it counts
    // as empty by the walker's metric)
    mkdirSync(join(root, 'excluded-only', 'node_modules', 'pkg'), { recursive: true });
    touch('excluded-only/node_modules/pkg/index.js');
    // branch with an actual indexed file deep inside — neither the leaf nor
    // any ancestor should fire
    touch('keeper/sub/inside.jpg');
    // sibling of keeper that's empty — should still fire on its own
    mkdirSync(join(root, 'keeper', 'empty-sibling'), { recursive: true });

    const fired: string[] = [];
    const seen: string[] = [];
    for await (const entry of walk({
      ...opts,
      roots: [root],
      onEmptyDir: (p) => fired.push(p),
    })) {
      seen.push(entry.path);
    }

    const rel = (p: string) => p.replace(root, '').replace(/\\/g, '/');
    const firedRel = fired.map(rel).sort();
    expect(firedRel).toEqual(
      [
        '/all-empty/deep',
        '/all-empty',
        '/non-matching/sub',
        '/non-matching',
        '/excluded-only',
        '/keeper/empty-sibling',
      ].sort(),
    );
    // root itself never fires
    expect(fired).not.toContain(root);
    // dir holding an indexed file does not fire
    expect(firedRel).not.toContain('/keeper');
    expect(firedRel).not.toContain('/keeper/sub');
    // descendants of an excluded dir are never visited and never fire
    expect(firedRel.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('emits onEmptyDir deepest-first as it unwinds', async () => {
    mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true });
    const fired: string[] = [];
    for await (const _ of walk({
      ...opts,
      roots: [root],
      onEmptyDir: (p) => fired.push(p),
    })) {
      // drain
      void _;
    }
    expect(fired).toEqual([
      join(root, 'a', 'b', 'c'),
      join(root, 'a', 'b'),
      join(root, 'a'),
    ]);
  });

  it('does not fire onEmptyDir at all when the signal is already aborted', async () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    const controller = new AbortController();
    controller.abort();
    const fired: string[] = [];
    for await (const _ of walk({
      ...opts,
      roots: [root],
      signal: controller.signal,
      onEmptyDir: (p) => fired.push(p),
    })) {
      void _;
    }
    expect(fired).toHaveLength(0);
  });

  it('fires no onEmptyDir callbacks for entries past the abort point', async () => {
    for (let i = 0; i < 50; i += 1) {
      mkdirSync(join(root, `b-${String(i).padStart(2, '0')}`), { recursive: true });
    }
    const controller = new AbortController();
    const fired: string[] = [];
    let i = 0;
    for await (const _ of walk({
      ...opts,
      roots: [root],
      signal: controller.signal,
      onEmptyDir: (p) => {
        fired.push(p);
        i += 1;
        if (i === 5) controller.abort();
      },
    })) {
      void _;
    }
    // Walker checks signal at the top of each child iteration. With 50
    // sibling empty leaves, aborting from inside the 5th callback leaves
    // exactly 5 callbacks fired.
    expect(fired).toHaveLength(5);
  });
});

describe('walk cycle detection', () => {
  it('terminates when a symlink loop points back to an ancestor dir, logs a warning, and still returns non-loop files', async () => {
    // Structure: root/sub/ + root/keep.jpg + root/sub/loop -> root/
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(root, 'keep.jpg'), 'pixel');
    // POSIX symlink pointing back to root — creates an infinite cycle
    symlinkSync(root, join(root, 'sub', 'loop'));

    const { logger, warns } = makeLogger();
    const seen: string[] = [];

    // Use a timeout to guard in case cycle detection is missing and it hangs.
    // vitest default timeout is 5 s; a stack overflow would terminate first anyway.
    for await (const entry of walk({ ...opts, roots: [root], log: logger })) {
      seen.push(entry.path.replace(root, '').replace(/\\/g, '/'));
    }

    // The non-loop file must be returned.
    expect(seen).toContain('/keep.jpg');

    // A cycle-detection warning must have been logged.
    const cycleWarn = warns.find((w) => w.msg === 'walker-cycle-detected');
    expect(cycleWarn).toBeDefined();
    expect(typeof cycleWarn?.fields['path']).toBe('string');
  });

  it('terminates when depth exceeds MAX_DEPTH and logs a depth-limit warning', async () => {
    // Build a directory tree just past the limit.
    // We use a smaller depth option to keep the test fast.
    const TEST_DEPTH = MAX_DEPTH + 2;
    let cur = root;
    for (let i = 0; i < TEST_DEPTH; i++) {
      cur = join(cur, `d${i}`);
      mkdirSync(cur, { recursive: true });
    }
    // Put a file at the very bottom (should NOT be seen — it's past the limit).
    writeFileSync(join(cur, 'deep.jpg'), 'x');
    // Put a file at root level (SHOULD be seen).
    writeFileSync(join(root, 'shallow.jpg'), 'y');

    const { logger, warns } = makeLogger();
    const seen: string[] = [];

    for await (const entry of walk({ ...opts, roots: [root], log: logger })) {
      seen.push(entry.path.replace(root, '').replace(/\\/g, '/'));
    }

    // The shallow file is within depth limit.
    expect(seen).toContain('/shallow.jpg');
    // The deeply nested file is beyond MAX_DEPTH and must not appear.
    expect(seen).not.toContain(
      '/' + Array.from({ length: TEST_DEPTH }, (_, i) => `d${i}`).join('/') + '/deep.jpg',
    );

    // A depth-limit warning must have been logged.
    const depthWarn = warns.find((w) => w.msg === 'walker-depth-limit');
    expect(depthWarn).toBeDefined();
    expect(typeof depthWarn?.fields['depth']).toBe('number');
  });
});
