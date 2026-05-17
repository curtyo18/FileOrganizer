# FileOrganizer Implementation Plan

**Goal:** Build the FileOrganizer tool described in `docs/superpowers/specs/2026-04-25-file-organizer-design.md` end-to-end, in seven sequential milestones, producing a locally-runnable Node + TypeScript application that scans drives, catalogs personal files, detects byte-identical duplicates, and organizes files according to user-defined rules.

**Architecture:** Three layers — a headless Node + TypeScript engine, a single SQLite catalog, and a Preact + Vite UI served by the engine on `127.0.0.1`. Monorepo via npm workspaces. Test-driven throughout. Frequent commits. No premature abstraction.

**Tech Stack:** Node 22 or 24 LTS (24 recommended), TypeScript, npm workspaces, `better-sqlite3`, `Hono` (HTTP+WS), `node:crypto`, `node:worker_threads`, `exifr`, `mediainfo` (subprocess), `sharp`, `vitest`, Preact, `vite`, `tsx`, `esbuild`.

**Spec reference:** Every section of this plan refers back to `docs/superpowers/specs/2026-04-25-file-organizer-design.md` (referred to as "the spec" below). The spec is authoritative; this plan is the execution path.

---

## Section 1 — Conventions across all tasks

### 2.1 Branch and commit flow

- Work happens on `main` directly. Each task lands as a single commit on `main` and is pushed immediately so a fresh `git pull` always gives a runnable build.
- Side-branches are only used for in-progress work that breaks `main`; they merge back as soon as they’re stable.

### 2.2 File-creation policy

- Use the `Write` tool to create new files. Use `Edit` for changes to existing files.
- After every file creation, immediately add the new file to the next commit's staging.

### 2.3 Test command shorthand

When a task says **"Run tests"** without further qualification, run:

```
npm test --workspace=<package>
```

…where `<package>` is the workspace whose tests changed. When tests across packages must run together, the plan says so explicitly.

### 2.4 Type sharing rule

Any type used by both the engine and the UI **MUST** be defined in `packages/shared/src/`. Engine-only types live in `packages/engine/src/<module>/types.ts`. UI-only types live in `packages/ui/src/<area>/types.ts`. This rule prevents type drift between the two halves of the system.

### 2.5 SQL convention

- Migration files: `packages/engine/src/catalog/migrations/<NNNN>_<short_description>.sql`. NNNN is zero-padded, monotonically increasing. Never edit a migration once it has been committed and run anywhere — only add new ones.
- Queries: prepared statements via `better-sqlite3`. Inline SQL strings live next to the function that uses them; do not centralize SQL in a single file.
- Use parameter binding for every value. No string interpolation into SQL.

### 2.6 Logging convention

- Use the logger from `packages/engine/src/log.ts` (created in §M1.6).
- Log lines include batch ID, scan ID, or operation ID where relevant for `grep`-friendly auditing.

### 2.7 Definition of "done" for a task

A task is done when, in order:

1. All checkboxes in the task are ticked.
2. The verification command(s) have all passed.
3. A commit exists with the correct message format and only the files this task touched.
4. The repo is in a clean state (`git status` shows no untracked or modified files outside what the next task expects).

---

## Section M0 — Repository setup (prereq for everything)

This milestone gets the repo, workspaces, and tooling in place. It is not in the spec's milestone list because the spec assumes the repo exists; this section bridges from "empty directory" to "M1 can begin."

### M0-T01: Initialize the git repository (prereq)

**Files:**
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Initialize git**

```
git init -b main
```

- [ ] **Step 2: Write `.gitignore`**

```
# dependencies
node_modules/
**/node_modules/

# build outputs
dist/
**/dist/
*.tsbuildinfo

# editor & OS
.DS_Store
.vscode/
.idea/
Thumbs.db

# environment
.env
.env.local

# runtime data (must never be committed)
catalog.db
catalog.db-journal
catalog.db-wal
catalog.db-shm
logs/
thumbnails-cache/

# bundled binaries (fetched at install time)
packages/engine/bin/mediainfo*
packages/engine/bin/ffprobe*

# implementation notes
docs/superpowers/notes-from-implementation.md
docs/superpowers/blockers.md
```

- [ ] **Step 3: Write a minimal `README.md`**

```markdown
# FileOrganizer

Local tool to organize personal files across multiple drives. See:

- Design spec: `docs/superpowers/specs/2026-04-25-file-organizer-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-25-file-organizer-implementation.md`

## Quick start (after M0 is complete)

```
npm install
npm run build
npm run start
```

The application is a work in progress; see the implementation plan for current milestone status.
```

- [ ] **Step 4: Stage and commit**

```
git add .gitignore README.md
git commit -m "chore(repo): initialize git, ignore rules, readme

Task: M0-T01"
```

- [ ] **Step 5: Verify**

```
git log --oneline
```

Expected: one line containing `chore(repo): initialize git, ignore rules, readme`.

### M0-T02: Add the existing spec and plan to the repo (prereq)

The spec file and this plan file already exist on disk under `docs/superpowers/`. They were written before `git init`, so they're currently untracked.

**Files:**
- Track: `docs/superpowers/specs/2026-04-25-file-organizer-design.md` (already on disk)
- Track: `docs/superpowers/plans/2026-04-25-file-organizer-implementation.md` (already on disk)

- [ ] **Step 1: Stage both docs**

```
git add docs/superpowers/specs/2026-04-25-file-organizer-design.md docs/superpowers/plans/2026-04-25-file-organizer-implementation.md
```

- [ ] **Step 2: Commit**

```
git commit -m "docs(plan): add design spec and implementation plan

Task: M0-T02"
```

- [ ] **Step 3: Verify**

```
git ls-files docs/
```

Expected output (exactly):

```
docs/superpowers/plans/2026-04-25-file-organizer-implementation.md
docs/superpowers/specs/2026-04-25-file-organizer-design.md
```

### M0-T03: Workspace-root `package.json` (prereq)

**Files:**
- Create: `package.json`

- [ ] **Step 1: Write the root `package.json`**

```json
{
  "name": "fileorganizer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "workspaces": [
    "packages/shared",
    "packages/engine",
    "packages/ui"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "start": "npm run start --workspace=engine",
    "fetch-binaries": "tsx scripts/fetch-binaries.ts"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "prettier": "^3.3.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
```

- [ ] **Step 2: Install root devDependencies**

```
npm install
```

Expected: completes without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 3: Stage and commit**

```
git add package.json package-lock.json
git commit -m "chore(repo): add workspace root package.json

Task: M0-T03"
```

### M0-T04: Root TypeScript config (prereq)

**Files:**
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true,
    "incremental": true,
    "composite": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 2: Write root `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "packages/engine" },
    { "path": "packages/ui" }
  ]
}
```

- [ ] **Step 3: Stage and commit**

```
git add tsconfig.base.json tsconfig.json
git commit -m "chore(repo): add base typescript config and project references

Task: M0-T04"
```

### M0-T05: Prettier and ESLint config (prereq)

**Files:**
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `eslint.config.js`

- [ ] **Step 1: Write `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 2: Write `.prettierignore`**

```
node_modules
dist
**/dist
package-lock.json
docs/superpowers/specs
docs/superpowers/plans
```

- [ ] **Step 3: Write `eslint.config.js`**

```js
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
];
```

- [ ] **Step 4: Stage and commit**

```
git add .prettierrc.json .prettierignore eslint.config.js
git commit -m "chore(repo): add prettier and eslint config

Task: M0-T05"
```

### M0-T06: Workspace package skeletons (prereq)

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Create: `packages/engine/src/index.ts`
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`

- [ ] **Step 1: Write `packages/shared/package.json`**

```json
{
  "name": "@fileorganizer/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/shared/src/index.ts`**

```ts
export {};
```

- [ ] **Step 4: Write `packages/engine/package.json`**

```json
{
  "name": "@fileorganizer/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "fileorganizer": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "start": "tsx src/cli/index.ts serve"
  },
  "dependencies": {
    "@fileorganizer/shared": "*"
  }
}
```

- [ ] **Step 5: Write `packages/engine/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" }
  ]
}
```

- [ ] **Step 6: Write `packages/engine/src/index.ts`**

```ts
export {};
```

- [ ] **Step 7: Write `packages/ui/package.json`**

```json
{
  "name": "@fileorganizer/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fileorganizer/shared": "*"
  }
}
```

- [ ] **Step 8: Write `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "jsxImportSource": "preact"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" }
  ]
}
```

- [ ] **Step 9: Write `packages/ui/src/index.ts`**

```ts
export {};
```

- [ ] **Step 10: Install workspace dependencies**

```
npm install
```

- [ ] **Step 11: Verify the workspace builds (no source yet)**

```
npm run typecheck
```

Expected: completes with no errors. Each workspace's `typecheck` script runs `tsc --noEmit` against an empty source set, which succeeds.

- [ ] **Step 12: Stage and commit**

```
git add packages/ package.json package-lock.json
git commit -m "chore(repo): scaffold shared, engine, ui workspace packages

Task: M0-T06"
```

### M0-T07: Vitest workspace configuration (prereq)

**Files:**
- Create: `vitest.workspace.ts`

- [ ] **Step 1: Write `vitest.workspace.ts`**

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/engine',
  'packages/ui',
]);
```

- [ ] **Step 2: Verify**

```
npm test
```

Expected: vitest finds no tests across workspaces and exits 0 with a "No test files found" message per workspace. (Tests get added in M1+.)

- [ ] **Step 3: Stage and commit**

```
git add vitest.workspace.ts
git commit -m "chore(repo): add vitest workspace config

Task: M0-T07"
```

### M0-T08: Milestone gate for M0

- [ ] **Step 1: Verify the repo state**

```
git status
git log --oneline
npm run typecheck
npm test
```

Expected:
- `git status`: clean working tree.
- `git log --oneline`: 7 commits on `main` (one per task M0-T01 through M0-T07).
- `npm run typecheck`: passes for all three workspaces.
- `npm test`: passes (no tests yet) for all three workspaces.


---

## Section M1 — Foundations

**Goal:** Project skeleton with the catalog data model, drive registry, settings, throttle profile data model, and a `status` CLI command. By end of M1, the engine can be installed, started against a local SQLite catalog, register drives manually, and report state — but it does not yet scan, organize, or dedupe.

### M1-T01: Shared types — core domain types (prereq)

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/types.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Category, DriveKind, ScanStatus, FileState, BatchKind, OperationKind, OperationStatus } from './types.js';
import { CATEGORIES, DRIVE_KINDS } from './types.js';

describe('domain enums', () => {
  it('exposes the full category list', () => {
    expect(CATEGORIES).toEqual([
      'image',
      'video',
      'audio',
      'document',
      'spreadsheet',
      'presentation',
      'archive',
      'ebook',
      'code',
    ]);
  });

  it('exposes drive kinds', () => {
    expect(DRIVE_KINDS).toEqual(['local', 'external', 'network']);
  });

  it('rejects unknown category at compile-time via type narrowing', () => {
    const c: Category = 'image';
    expect(c).toBe('image');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
npm test --workspace=@fileorganizer/shared
```

Expected: FAIL — module `./types.js` not found.

- [ ] **Step 3: Implement `packages/shared/src/types.ts`**

```ts
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

export type ScanStatus = 'running' | 'paused' | 'completed' | 'failed';

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
```

- [ ] **Step 4: Update `packages/shared/src/index.ts`**

```ts
export * from './types.js';
```

- [ ] **Step 5: Run tests**

```
npm test --workspace=@fileorganizer/shared
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```
git add packages/shared/src/types.ts packages/shared/src/types.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add core domain types and enums

Task: M1-T01"
```

### M1-T02: Shared types — rules, throttle profiles, settings (prereq)

**Files:**
- Create: `packages/shared/src/rules.ts`
- Create: `packages/shared/src/throttle.ts`
- Create: `packages/shared/src/settings.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write `packages/shared/src/rules.ts`**

```ts
import type { Category, MovePolicy, QuarantinePolicy } from './types.js';

export interface RuleMatch {
  category?: Category[];
  dateBefore?: string;
  dateAfter?: string;
  dateSourceMin?: 'exif' | 'mtime' | 'any';
  minSizeBytes?: number | null;
  maxSizeBytes?: number | null;
  pathGlob?: string | null;
  sourceDrives?: string[] | null;
  sourceRoles?: string[] | null;
}

export interface Rule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  match: RuleMatch;
  destinationRole: string;
  destinationTemplate: string;
  movePolicy: MovePolicy;
  quarantinePolicy: QuarantinePolicy;
}
```

- [ ] **Step 2: Write `packages/shared/src/throttle.ts`**

```ts
import type { ThrottleProfileName } from './types.js';

export interface ThrottleProfile {
  name: ThrottleProfileName;
  localHashWorkers: number;
  networkHashWorkers: number;
  readChunkBytes: number;
  interChunkSleepMs: number;
  maxOpenFiles: number;
}

export interface ThrottleScheduleEntry {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  profile: ThrottleProfileName;
}

export const DEFAULT_THROTTLE_PROFILES: Record<ThrottleProfileName, ThrottleProfile> = {
  idle: {
    name: 'idle',
    localHashWorkers: 1,
    networkHashWorkers: 1,
    readChunkBytes: 256 * 1024,
    interChunkSleepMs: 5,
    maxOpenFiles: 4,
  },
  balanced: {
    name: 'balanced',
    localHashWorkers: Math.max(1, Math.floor((require('node:os').cpus()?.length ?? 4) / 2)),
    networkHashWorkers: 1,
    readChunkBytes: 1024 * 1024,
    interChunkSleepMs: 1,
    maxOpenFiles: 16,
  },
  'full-send': {
    name: 'full-send',
    localHashWorkers: require('node:os').cpus()?.length ?? 4,
    networkHashWorkers: 2,
    readChunkBytes: 4 * 1024 * 1024,
    interChunkSleepMs: 0,
    maxOpenFiles: 64,
  },
};
```

> **Note:** `require()` inside an ESM module triggers a TypeScript / runtime warning. Replace with the resolved CPU count at instantiation time in code that consumes this. Step 3 fixes this.

- [ ] **Step 3: Replace step 2 — final `packages/shared/src/throttle.ts`**

The cleaner shape is to keep the static config and let the consumer plug CPU count in. Replace the file content from step 2 with this:

```ts
import type { ThrottleProfileName } from './types.js';

export interface ThrottleProfile {
  name: ThrottleProfileName;
  localHashWorkers: number;
  networkHashWorkers: number;
  readChunkBytes: number;
  interChunkSleepMs: number;
  maxOpenFiles: number;
}

export interface ThrottleScheduleEntry {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  profile: ThrottleProfileName;
}

export function defaultThrottleProfiles(cpuCount: number): Record<ThrottleProfileName, ThrottleProfile> {
  return {
    idle: {
      name: 'idle',
      localHashWorkers: 1,
      networkHashWorkers: 1,
      readChunkBytes: 256 * 1024,
      interChunkSleepMs: 5,
      maxOpenFiles: 4,
    },
    balanced: {
      name: 'balanced',
      localHashWorkers: Math.max(1, Math.floor(cpuCount / 2)),
      networkHashWorkers: 1,
      readChunkBytes: 1024 * 1024,
      interChunkSleepMs: 1,
      maxOpenFiles: 16,
    },
    'full-send': {
      name: 'full-send',
      localHashWorkers: Math.max(1, cpuCount),
      networkHashWorkers: 2,
      readChunkBytes: 4 * 1024 * 1024,
      interChunkSleepMs: 0,
      maxOpenFiles: 64,
    },
  };
}
```

- [ ] **Step 4: Write `packages/shared/src/settings.ts`**

```ts
import type { Category, ThrottleProfileName } from './types.js';
import type { ThrottleProfile, ThrottleScheduleEntry } from './throttle.js';

export interface RoleDefinition {
  name: string;
  drivePriority: string[];
  fillThresholdPercent: number;
}

export interface CategoryMap {
  [category: string]: string[];
}

export interface Settings {
  catalogVersion: number;
  categoryMap: CategoryMap;
  roles: RoleDefinition[];
  throttleProfiles: Record<ThrottleProfileName, ThrottleProfile>;
  throttleSchedule: ThrottleScheduleEntry[];
  recentArchiveCutoffYears: number;
  uiPort: number;
}

export const DEFAULT_CATEGORY_MAP: CategoryMap = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'heic', 'webp', 'raw', 'cr2', 'nef', 'arw', 'dng'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'],
  document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md'],
  spreadsheet: ['xls', 'xlsx', 'ods', 'csv'],
  presentation: ['ppt', 'pptx', 'odp', 'key'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz'],
  ebook: ['epub', 'mobi', 'azw', 'azw3'],
  code: [
    'py', 'js', 'ts', 'tsx', 'jsx', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
    'ipynb', 'sh', 'rb', 'php', 'swift', 'kt',
  ],
};

export function categoryForExtension(map: CategoryMap, extension: string): Category | null {
  const ext = extension.toLowerCase().replace(/^\./, '');
  for (const [cat, exts] of Object.entries(map)) {
    if (exts.includes(ext)) {
      return cat as Category;
    }
  }
  return null;
}
```

- [ ] **Step 5: Update `packages/shared/src/index.ts`**

```ts
export * from './types.js';
export * from './rules.js';
export * from './throttle.js';
export * from './settings.js';
```

- [ ] **Step 6: Add a test for `categoryForExtension`**

`packages/shared/src/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { categoryForExtension, DEFAULT_CATEGORY_MAP } from './settings.js';

describe('categoryForExtension', () => {
  it('matches known extensions case-insensitively', () => {
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, 'jpg')).toBe('image');
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, '.JPG')).toBe('image');
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, 'PDF')).toBe('document');
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, 'mp4')).toBe('video');
  });

  it('returns null for unknown extensions', () => {
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, 'exe')).toBeNull();
    expect(categoryForExtension(DEFAULT_CATEGORY_MAP, '')).toBeNull();
  });
});
```

- [ ] **Step 7: Run tests**

```
npm test --workspace=@fileorganizer/shared
```

Expected: PASS, 5 tests.

- [ ] **Step 8: Commit**

```
git add packages/shared/src/rules.ts packages/shared/src/throttle.ts packages/shared/src/settings.ts packages/shared/src/settings.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add rules, throttle profiles, settings types

Task: M1-T02"
```

### M1-T03: Engine — error classes (prereq)

**Files:**
- Create: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/errors.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CatalogError, ScanError, RuleError, IntegrityError, isFileOrganizerError } from './errors.js';

describe('error classes', () => {
  it('CatalogError carries a code and message', () => {
    const err = new CatalogError('CATALOG_LOCKED', 'database is locked');
    expect(err.code).toBe('CATALOG_LOCKED');
    expect(err.message).toBe('database is locked');
    expect(err.name).toBe('CatalogError');
    expect(err instanceof Error).toBe(true);
  });

  it('ScanError carries a code and optional cause', () => {
    const cause = new Error('underlying');
    const err = new ScanError('DRIVE_DISCONNECTED', 'NAS not reachable', cause);
    expect(err.code).toBe('DRIVE_DISCONNECTED');
    expect(err.cause).toBe(cause);
  });

  it('isFileOrganizerError detects all error subclasses', () => {
    expect(isFileOrganizerError(new CatalogError('X', 'y'))).toBe(true);
    expect(isFileOrganizerError(new ScanError('X', 'y'))).toBe(true);
    expect(isFileOrganizerError(new RuleError('X', 'y'))).toBe(true);
    expect(isFileOrganizerError(new IntegrityError('X', 'y'))).toBe(true);
    expect(isFileOrganizerError(new Error('plain'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```
npm test --workspace=@fileorganizer/shared
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/shared/src/errors.ts`**

```ts
export class FileOrganizerError extends Error {
  readonly code: string;
  readonly cause?: unknown;

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
```

- [ ] **Step 4: Update `packages/shared/src/index.ts`**

```ts
export * from './types.js';
export * from './rules.js';
export * from './throttle.js';
export * from './settings.js';
export * from './errors.js';
```

- [ ] **Step 5: Run tests**

```
npm test --workspace=@fileorganizer/shared
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```
git add packages/shared/src/errors.ts packages/shared/src/errors.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add typed error classes

Task: M1-T03"
```

### M1-T04: Engine — install runtime dependencies (prereq)

**Files:**
- Modify: `packages/engine/package.json`

- [ ] **Step 1: Update `packages/engine/package.json` `dependencies` and `devDependencies`**

```json
{
  "name": "@fileorganizer/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "fileorganizer": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "start": "tsx src/cli/index.ts serve"
  },
  "dependencies": {
    "@fileorganizer/shared": "*",
    "better-sqlite3": "^12.0.0",
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "exifr": "^7.1.0",
    "sharp": "^0.33.5",
    "uuid": "^10.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/uuid": "^10.0.0"
  }
}
```

- [ ] **Step 2: Install**

```
npm install
```

Expected: completes without errors. `better-sqlite3` and `sharp` are native modules; their build steps may take a minute.

- [ ] **Step 3: Verify `better-sqlite3` loads**

```
node -e "import('better-sqlite3').then(m => console.log('ok', typeof m.default))"
```

Expected: prints `ok function`.

- [ ] **Step 4: Commit**

```
git add packages/engine/package.json package-lock.json
git commit -m "chore(engine): add runtime dependencies (sqlite, hono, exifr, sharp)

Task: M1-T04"
```

### M1-T05: Engine — catalog SQLite wrapper

**Files:**
- Create: `packages/engine/src/catalog/connection.ts`
- Create: `packages/engine/src/catalog/connection.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/catalog/connection.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog } from './connection.js';

const tmpDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fileorg-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('openCatalog', () => {
  it('creates the database file if missing', () => {
    const dir = freshDir();
    const path = join(dir, 'catalog.db');
    const db = openCatalog(path);
    expect(db).toBeDefined();
    closeCatalog(db);
  });

  it('opens an existing database', () => {
    const dir = freshDir();
    const path = join(dir, 'catalog.db');
    const db1 = openCatalog(path);
    closeCatalog(db1);
    const db2 = openCatalog(path);
    expect(db2).toBeDefined();
    closeCatalog(db2);
  });

  it('enables WAL and foreign keys', () => {
    const dir = freshDir();
    const path = join(dir, 'catalog.db');
    const db = openCatalog(path);
    const journalMode = db.pragma('journal_mode', { simple: true });
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(journalMode).toBe('wal');
    expect(fk).toBe(1);
    closeCatalog(db);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```
npm test --workspace=@fileorganizer/engine
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/engine/src/catalog/connection.ts`**

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CatalogError } from '@fileorganizer/shared';

export type Catalog = Database.Database;

export function openCatalog(path: string): Catalog {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (err) {
    throw new CatalogError(
      'CATALOG_OPEN_FAILED',
      `failed to open catalog at ${path}: ${(err as Error).message}`,
      err,
    );
  }
}

export function closeCatalog(db: Catalog): void {
  db.close();
}
```

- [ ] **Step 4: Run tests**

```
npm test --workspace=@fileorganizer/engine
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/catalog/connection.ts packages/engine/src/catalog/connection.test.ts
git commit -m "feat(engine/catalog): add sqlite connection wrapper

Task: M1-T05"
```

### M1-T06: Engine — schema migration runner

**Files:**
- Create: `packages/engine/src/catalog/migrate.ts`
- Create: `packages/engine/src/catalog/migrate.test.ts`
- Create: `packages/engine/src/catalog/migrations/0001_initial.sql`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/catalog/migrate.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog } from './connection.js';
import { migrate, currentSchemaVersion } from './migrate.js';

const tmpDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fileorg-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('migrate', () => {
  it('applies all migrations to a fresh database', () => {
    const db = openCatalog(join(freshDir(), 'catalog.db'));
    migrate(db);
    expect(currentSchemaVersion(db)).toBeGreaterThanOrEqual(1);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const t of [
      'drives', 'scans', 'files', 'rules', 'batches', 'operations',
      'quarantine', 'settings', 'schema_version',
    ]) {
      expect(names).toContain(t);
    }
    closeCatalog(db);
  });

  it('is idempotent on a migrated database', () => {
    const path = join(freshDir(), 'catalog.db');
    const db = openCatalog(path);
    migrate(db);
    const v1 = currentSchemaVersion(db);
    migrate(db);
    const v2 = currentSchemaVersion(db);
    expect(v1).toBe(v2);
    closeCatalog(db);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```
npm test --workspace=@fileorganizer/engine
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/engine/src/catalog/migrations/0001_initial.sql`**

```sql
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE drives (
    id TEXT PRIMARY KEY,
    volume_serial TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    current_letter TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('local', 'external', 'network')),
    roles TEXT NOT NULL DEFAULT '[]',
    total_bytes INTEGER NOT NULL DEFAULT 0,
    free_bytes INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE scans (
    id TEXT PRIMARY KEY,
    drive_id TEXT NOT NULL REFERENCES drives(id),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'failed')),
    root_paths TEXT NOT NULL DEFAULT '[]',
    throttle_profile TEXT NOT NULL,
    progress TEXT NOT NULL DEFAULT '{}',
    stats TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id TEXT NOT NULL REFERENCES drives(id),
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    extension TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    category TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    mtime TEXT NOT NULL,
    ctime TEXT NOT NULL,
    exif_date TEXT,
    date_source TEXT NOT NULL CHECK (date_source IN ('exif', 'mtime', 'none')),
    width INTEGER,
    height INTEGER,
    duration_seconds REAL,
    ntfs_file_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('indexed', 'quarantined', 'moved', 'deleted-from-source', 'missing')),
    last_verified_at TEXT NOT NULL,
    scan_id TEXT NOT NULL REFERENCES scans(id),
    UNIQUE (drive_id, path)
);

CREATE INDEX idx_files_sha256 ON files (sha256);
CREATE INDEX idx_files_category_exif ON files (category, exif_date);
CREATE INDEX idx_files_state ON files (state);

CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    match_json TEXT NOT NULL,
    destination_role TEXT NOT NULL,
    destination_template TEXT NOT NULL,
    move_policy TEXT NOT NULL,
    quarantine_policy TEXT NOT NULL DEFAULT 'default'
);

CREATE INDEX idx_rules_priority ON rules (priority);

CREATE TABLE batches (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_batches_started_at ON batches (started_at);

CREATE TABLE operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL REFERENCES batches(id),
    kind TEXT NOT NULL,
    file_id INTEGER REFERENCES files(id),
    source_drive_id TEXT,
    source_path TEXT,
    dest_drive_id TEXT,
    dest_path TEXT,
    pre_hash TEXT,
    post_hash TEXT,
    quarantine_path TEXT,
    status TEXT NOT NULL,
    error_message TEXT
);

CREATE INDEX idx_operations_batch ON operations (batch_id);
CREATE INDEX idx_operations_status ON operations (status);

CREATE TABLE quarantine (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id TEXT NOT NULL REFERENCES drives(id),
    original_path TEXT NOT NULL,
    original_size INTEGER NOT NULL,
    original_sha256 TEXT NOT NULL,
    original_mtime TEXT NOT NULL,
    quarantine_path TEXT NOT NULL,
    quarantined_at TEXT NOT NULL,
    batch_id TEXT NOT NULL REFERENCES batches(id)
);

CREATE INDEX idx_quarantine_drive ON quarantine (drive_id);
CREATE INDEX idx_quarantine_hash ON quarantine (original_sha256);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

- [ ] **Step 4: Implement `packages/engine/src/catalog/migrate.ts`**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Catalog } from './connection.js';
import { CatalogError } from '@fileorganizer/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function currentSchemaVersion(db: Catalog): number {
  const tableExists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`,
    )
    .get() as { name: string } | undefined;
  if (!tableExists) return 0;
  const row = db
    .prepare(`SELECT MAX(version) AS v FROM schema_version`)
    .get() as { v: number | null };
  return row.v ?? 0;
}

export function migrate(db: Catalog): void {
  const current = currentSchemaVersion(db);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file.slice(0, 4), 10);
    if (version <= current) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(
        version,
        new Date().toISOString(),
      );
    });
    try {
      tx();
    } catch (err) {
      throw new CatalogError(
        'MIGRATION_FAILED',
        `migration ${file} failed: ${(err as Error).message}`,
        err,
      );
    }
  }
}
```

- [ ] **Step 5: Run tests**

```
npm test --workspace=@fileorganizer/engine
```

Expected: PASS, 5 tests cumulative.

- [ ] **Step 6: Commit**

```
git add packages/engine/src/catalog/migrate.ts packages/engine/src/catalog/migrate.test.ts packages/engine/src/catalog/migrations/0001_initial.sql
git commit -m "feat(engine/catalog): add migration runner with initial schema

Task: M1-T06"
```

### M1-T07: Engine — logger

**Files:**
- Create: `packages/engine/src/log.ts`
- Create: `packages/engine/src/log.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/log.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from './log.js';

describe('createLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('emits structured JSON lines', () => {
    const writes: string[] = [];
    const log = createLogger({ level: 'info', write: (line) => writes.push(line) });
    log.info('hello', { k: 1 });
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.k).toBe(1);
    expect(typeof parsed.ts).toBe('string');
  });

  it('respects level filtering', () => {
    const writes: string[] = [];
    const log = createLogger({ level: 'warn', write: (line) => writes.push(line) });
    log.debug('skip');
    log.info('skip');
    log.warn('keep');
    log.error('keep');
    expect(writes).toHaveLength(2);
  });

  it('child logger merges base context', () => {
    const writes: string[] = [];
    const log = createLogger({ level: 'info', write: (line) => writes.push(line) });
    const child = log.child({ scanId: 'abc' });
    child.info('x', { y: 2 });
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.scanId).toBe('abc');
    expect(parsed.y).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/log.ts`**

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  write: (line: string) => void;
  context?: Record<string, unknown>;
}

export function createLogger(opts: LoggerOptions): Logger {
  const base = opts.context ?? {};
  const min = LEVEL_ORDER[opts.level];
  const log = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < min) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...base,
      ...fields,
    });
    opts.write(line);
  };
  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (context) =>
      createLogger({ level: opts.level, write: opts.write, context: { ...base, ...context } }),
  };
}

export function defaultWriter(line: string): void {
  process.stderr.write(line + '\n');
}
```

- [ ] **Step 4: Run tests**

```
npm test --workspace=@fileorganizer/engine
```

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/log.ts packages/engine/src/log.test.ts
git commit -m "feat(engine): add structured logger

Task: M1-T07"
```

### M1-T08: Engine — settings repository

**Files:**
- Create: `packages/engine/src/catalog/settings-repo.ts`
- Create: `packages/engine/src/catalog/settings-repo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/catalog/settings-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { SettingsRepo } from './settings-repo.js';
import { DEFAULT_CATEGORY_MAP } from '@fileorganizer/shared';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-settings-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsRepo', () => {
  it('initialises with defaults on first call', () => {
    const repo = new SettingsRepo(db);
    const s = repo.load();
    expect(s.categoryMap).toEqual(DEFAULT_CATEGORY_MAP);
    expect(s.recentArchiveCutoffYears).toBe(2);
    expect(s.uiPort).toBe(0);
  });

  it('persists changes', () => {
    const repo = new SettingsRepo(db);
    const s = repo.load();
    s.uiPort = 12345;
    s.recentArchiveCutoffYears = 3;
    repo.save(s);
    const reloaded = new SettingsRepo(db).load();
    expect(reloaded.uiPort).toBe(12345);
    expect(reloaded.recentArchiveCutoffYears).toBe(3);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/catalog/settings-repo.ts`**

```ts
import { cpus } from 'node:os';
import type { Catalog } from './connection.js';
import {
  DEFAULT_CATEGORY_MAP,
  defaultThrottleProfiles,
  type Settings,
} from '@fileorganizer/shared';

const KEY = 'settings';

export class SettingsRepo {
  constructor(private readonly db: Catalog) {}

  load(): Settings {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(KEY) as { value: string } | undefined;
    if (row) {
      return JSON.parse(row.value) as Settings;
    }
    const fresh = this.defaults();
    this.save(fresh);
    return fresh;
  }

  save(s: Settings): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
      .run(KEY, JSON.stringify(s));
  }

  private defaults(): Settings {
    const cpuCount = cpus().length || 4;
    return {
      catalogVersion: 1,
      categoryMap: DEFAULT_CATEGORY_MAP,
      roles: [],
      throttleProfiles: defaultThrottleProfiles(cpuCount),
      throttleSchedule: [],
      recentArchiveCutoffYears: 2,
      uiPort: 0,
    };
  }
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/catalog/settings-repo.ts packages/engine/src/catalog/settings-repo.test.ts
git commit -m "feat(engine/catalog): add settings repository with defaults

Task: M1-T08"
```

### M1-T09: Engine — drive registry

**Files:**
- Create: `packages/engine/src/drives/repo.ts`
- Create: `packages/engine/src/drives/repo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/drives/repo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from './repo.js';

let dir: string;
let db: Catalog;
let repo: DriveRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-drives-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  repo = new DriveRepo(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('DriveRepo', () => {
  it('upserts a new drive and assigns id', () => {
    const drive = repo.upsert({
      volumeSerial: 'AAAA-BBBB',
      label: 'SSD-Active',
      currentLetter: 'D:',
      kind: 'local',
      roles: ['active-documents'],
      totalBytes: 1_000_000_000,
      freeBytes: 500_000_000,
    });
    expect(drive.id).toBeTruthy();
    expect(drive.volumeSerial).toBe('AAAA-BBBB');
    expect(drive.roles).toEqual(['active-documents']);
  });

  it('updates an existing drive on second upsert with same serial', () => {
    const a = repo.upsert({
      volumeSerial: 'AAAA-BBBB',
      label: 'SSD-Active',
      currentLetter: 'D:',
      kind: 'local',
      roles: [],
      totalBytes: 1_000_000_000,
      freeBytes: 500_000_000,
    });
    const b = repo.upsert({
      volumeSerial: 'AAAA-BBBB',
      label: 'SSD-Active-Renamed',
      currentLetter: 'E:',
      kind: 'local',
      roles: ['x'],
      totalBytes: 1_000_000_000,
      freeBytes: 400_000_000,
    });
    expect(b.id).toBe(a.id);
    expect(b.label).toBe('SSD-Active-Renamed');
    expect(b.currentLetter).toBe('E:');
    expect(b.freeBytes).toBe(400_000_000);
    expect(b.roles).toEqual(['x']);
    expect(repo.list()).toHaveLength(1);
  });

  it('lists drives ordered by label', () => {
    repo.upsert({ volumeSerial: 'B', label: 'Beta', currentLetter: null, kind: 'local', roles: [], totalBytes: 1, freeBytes: 1 });
    repo.upsert({ volumeSerial: 'A', label: 'Alpha', currentLetter: null, kind: 'local', roles: [], totalBytes: 1, freeBytes: 1 });
    const drives = repo.list();
    expect(drives.map((d) => d.label)).toEqual(['Alpha', 'Beta']);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/drives/repo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Catalog } from '../catalog/connection.js';
import type { DriveRecord, DriveKind } from '@fileorganizer/shared';

export interface UpsertDriveInput {
  volumeSerial: string;
  label: string;
  currentLetter: string | null;
  kind: DriveKind;
  roles: string[];
  totalBytes: number;
  freeBytes: number;
}

export class DriveRepo {
  constructor(private readonly db: Catalog) {}

  upsert(input: UpsertDriveInput): DriveRecord {
    const existing = this.db
      .prepare(`SELECT * FROM drives WHERE volume_serial = ?`)
      .get(input.volumeSerial) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare(
          `UPDATE drives SET label = ?, current_letter = ?, kind = ?, roles = ?,
           total_bytes = ?, free_bytes = ?, last_seen_at = ? WHERE id = ?`,
        )
        .run(
          input.label,
          input.currentLetter,
          input.kind,
          JSON.stringify(input.roles),
          input.totalBytes,
          input.freeBytes,
          now,
          existing['id'] as string,
        );
      return this.findById(existing['id'] as string)!;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO drives (id, volume_serial, label, current_letter, kind, roles,
         total_bytes, free_bytes, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.volumeSerial,
        input.label,
        input.currentLetter,
        input.kind,
        JSON.stringify(input.roles),
        input.totalBytes,
        input.freeBytes,
        now,
      );
    return this.findById(id)!;
  }

  findById(id: string): DriveRecord | null {
    const row = this.db.prepare(`SELECT * FROM drives WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.toRecord(row) : null;
  }

  list(): DriveRecord[] {
    const rows = this.db.prepare(`SELECT * FROM drives ORDER BY label`).all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.toRecord(r));
  }

  private toRecord(row: Record<string, unknown>): DriveRecord {
    return {
      id: row['id'] as string,
      volumeSerial: row['volume_serial'] as string,
      label: row['label'] as string,
      currentLetter: (row['current_letter'] as string | null) ?? null,
      kind: row['kind'] as DriveKind,
      roles: JSON.parse((row['roles'] as string) || '[]') as string[],
      totalBytes: row['total_bytes'] as number,
      freeBytes: row['free_bytes'] as number,
      lastSeenAt: row['last_seen_at'] as string,
      connected: false,
    };
  }
}
```

- [ ] **Step 4: Run tests**

Expected: PASS, 3 tests added.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/drives/repo.ts packages/engine/src/drives/repo.test.ts
git commit -m "feat(engine/drives): add drive repository with upsert by volume serial

Task: M1-T09"
```

### M1-T10: Engine — catalog locator (pointer file)

**Files:**
- Create: `packages/engine/src/catalog/locator.ts`
- Create: `packages/engine/src/catalog/locator.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/catalog/locator.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPointer, writePointer, type CatalogPointer } from './locator.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('catalog locator', () => {
  it('returns null when pointer file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-loc-'));
    tmpDirs.push(dir);
    expect(readPointer(join(dir, 'pointer.json'))).toBeNull();
  });

  it('round-trips a pointer through write and read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-loc-'));
    tmpDirs.push(dir);
    const path = join(dir, 'pointer.json');
    const ptr: CatalogPointer = { catalogPath: '/tmp/cat.db', uiPort: 4242 };
    writePointer(path, ptr);
    expect(existsSync(path)).toBe(true);
    expect(readPointer(path)).toEqual(ptr);
  });

  it('rejects malformed pointer files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-loc-'));
    tmpDirs.push(dir);
    const path = join(dir, 'pointer.json');
    writeFileSync(path, 'not json');
    expect(() => readPointer(path)).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/catalog/locator.ts`**

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CatalogError } from '@fileorganizer/shared';

export interface CatalogPointer {
  catalogPath: string;
  uiPort: number;
}

export function readPointer(path: string): CatalogPointer | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as Partial<CatalogPointer>;
    if (
      typeof parsed.catalogPath !== 'string' ||
      typeof parsed.uiPort !== 'number'
    ) {
      throw new CatalogError('POINTER_INVALID', `pointer file ${path} has unexpected shape`);
    }
    return { catalogPath: parsed.catalogPath, uiPort: parsed.uiPort };
  } catch (err) {
    if (err instanceof CatalogError) throw err;
    throw new CatalogError(
      'POINTER_INVALID',
      `pointer file ${path} is not valid JSON: ${(err as Error).message}`,
      err,
    );
  }
}

export function writePointer(path: string, ptr: CatalogPointer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ptr, null, 2), 'utf-8');
}

export function defaultPointerPath(): string {
  const appData = process.env['APPDATA'];
  if (appData) {
    return `${appData}\\FileOrganizer\\catalog-location.json`;
  }
  const home = process.env['HOME'] ?? process.cwd();
  return `${home}/.fileorganizer/catalog-location.json`;
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/catalog/locator.ts packages/engine/src/catalog/locator.test.ts
git commit -m "feat(engine/catalog): add catalog pointer file locator

Task: M1-T10"
```

### M1-T11: Engine — CLI scaffolding and `status` command

**Files:**
- Create: `packages/engine/src/cli/index.ts`
- Create: `packages/engine/src/cli/status.ts`
- Create: `packages/engine/src/cli/init.ts`
- Create: `packages/engine/src/cli/index.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/cli/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './index.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI', () => {
  it('init creates pointer file and catalog db', async () => {
    const pointerPath = join(dir, 'pointer.json');
    const catalogPath = join(dir, 'cat.db');
    const result = await runCli(['init', '--pointer', pointerPath, '--catalog', catalogPath]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(pointerPath)).toBe(true);
    expect(existsSync(catalogPath)).toBe(true);
  });

  it('status prints registered drives', async () => {
    const pointerPath = join(dir, 'pointer.json');
    const catalogPath = join(dir, 'cat.db');
    await runCli(['init', '--pointer', pointerPath, '--catalog', catalogPath]);
    const result = await runCli(['status', '--pointer', pointerPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Drives: 0');
  });

  it('exits 2 on unknown command', async () => {
    const result = await runCli(['nope']);
    expect(result.exitCode).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/cli/init.ts`**

```ts
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { writePointer } from '../catalog/locator.js';
import { SettingsRepo } from '../catalog/settings-repo.js';

export interface InitOptions {
  pointerPath: string;
  catalogPath: string;
}

export function runInit(opts: InitOptions): void {
  const db = openCatalog(opts.catalogPath);
  try {
    migrate(db);
    const settings = new SettingsRepo(db);
    settings.load();
  } finally {
    closeCatalog(db);
  }
  writePointer(opts.pointerPath, { catalogPath: opts.catalogPath, uiPort: 0 });
}
```

- [ ] **Step 4: Implement `packages/engine/src/cli/status.ts`**

```ts
import { readPointer } from '../catalog/locator.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { CatalogError } from '@fileorganizer/shared';

export interface StatusOptions {
  pointerPath: string;
}

export interface StatusResult {
  driveCount: number;
  catalogPath: string;
  drives: { label: string; serial: string; sizeBytes: number; freeBytes: number }[];
}

export function runStatus(opts: StatusOptions): StatusResult {
  const ptr = readPointer(opts.pointerPath);
  if (!ptr) {
    throw new CatalogError('POINTER_MISSING', `no catalog pointer at ${opts.pointerPath}`);
  }
  const db = openCatalog(ptr.catalogPath);
  try {
    migrate(db);
    const drives = new DriveRepo(db).list();
    return {
      driveCount: drives.length,
      catalogPath: ptr.catalogPath,
      drives: drives.map((d) => ({
        label: d.label,
        serial: d.volumeSerial,
        sizeBytes: d.totalBytes,
        freeBytes: d.freeBytes,
      })),
    };
  } finally {
    closeCatalog(db);
  }
}

export function formatStatus(s: StatusResult): string {
  const lines: string[] = [];
  lines.push(`Catalog: ${s.catalogPath}`);
  lines.push(`Drives: ${s.driveCount}`);
  for (const d of s.drives) {
    lines.push(`  - ${d.label} [${d.serial}] ${formatBytes(d.freeBytes)} free of ${formatBytes(d.sizeBytes)}`);
  }
  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
```

- [ ] **Step 5: Implement `packages/engine/src/cli/index.ts`**

```ts
#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { defaultPointerPath } from '../catalog/locator.js';
import { runInit } from './init.js';
import { runStatus, formatStatus } from './status.js';

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
      case 'help':
      case '--help':
      case '-h': {
        stdout.push(
          'fileorganizer <command>',
          'Commands:',
          '  init --catalog <path> [--pointer <path>]',
          '  status [--pointer <path>]',
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
```

- [ ] **Step 6: Run tests**

```
npm test --workspace=@fileorganizer/engine
```

Expected: PASS.

- [ ] **Step 7: Smoke-test the CLI manually**

```
npx tsx packages/engine/src/cli/index.ts --help
```

Expected: prints help text.

- [ ] **Step 8: Commit**

```
git add packages/engine/src/cli/
git commit -m "feat(engine/cli): add CLI scaffolding with init and status commands

Task: M1-T11"
```

### M1-T12: Milestone gate for M1

- [ ] **Step 1: Run all tests**

```
npm test
```

Expected: PASS for all three workspaces.

- [ ] **Step 2: Run typecheck**

```
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

```
npm run lint
```

Expected: PASS or warnings only.

- [ ] **Step 4: Verify the CLI end-to-end**

```
npx tsx packages/engine/src/cli/index.ts init --pointer /tmp/fileorg-ptr.json --catalog /tmp/fileorg-cat.db
npx tsx packages/engine/src/cli/index.ts status --pointer /tmp/fileorg-ptr.json
```

Expected: prints `Catalog: /tmp/fileorg-cat.db` and `Drives: 0`.


---

## Section M2 — Scan

**Goal:** A working scan pipeline. By end of M2, `fileorganizer scan <drive-letter-or-path>` walks a drive root, applies path/category filters, hashes new or changed files, extracts metadata, writes the catalog, and supports pause/resume + throttle profiles.

### M2-T01: Path exclusions module

**Files:**
- Create: `packages/engine/src/scan/exclusions.ts`
- Create: `packages/engine/src/scan/exclusions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/scan/exclusions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPathExcluded, DEFAULT_EXCLUDED_NAMES } from './exclusions.js';

describe('isPathExcluded', () => {
  it('excludes default system folders', () => {
    expect(isPathExcluded('Windows', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('Program Files', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('$Recycle.Bin', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('System Volume Information', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('node_modules', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('__pycache__', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('_FileOrganizer_quarantine', DEFAULT_EXCLUDED_NAMES)).toBe(true);
  });

  it('excludes hidden directories starting with a dot', () => {
    expect(isPathExcluded('.git', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('.venv', DEFAULT_EXCLUDED_NAMES)).toBe(true);
    expect(isPathExcluded('.config', DEFAULT_EXCLUDED_NAMES)).toBe(true);
  });

  it('does not exclude regular folder names', () => {
    expect(isPathExcluded('Photos', DEFAULT_EXCLUDED_NAMES)).toBe(false);
    expect(isPathExcluded('Documents', DEFAULT_EXCLUDED_NAMES)).toBe(false);
    expect(isPathExcluded('My Project', DEFAULT_EXCLUDED_NAMES)).toBe(false);
  });

  it('respects extra exclusions', () => {
    expect(isPathExcluded('CustomFolder', DEFAULT_EXCLUDED_NAMES, ['CustomFolder'])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/scan/exclusions.ts`**

```ts
export const DEFAULT_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
  '$Recycle.Bin',
  'System Volume Information',
  'node_modules',
  '__pycache__',
  'dist',
  'build',
  'target',
  'vendor',
  '_FileOrganizer_quarantine',
]);

export function isPathExcluded(
  name: string,
  defaults: ReadonlySet<string> = DEFAULT_EXCLUDED_NAMES,
  extras: readonly string[] = [],
): boolean {
  if (name.startsWith('.')) return true;
  if (defaults.has(name)) return true;
  if (extras.includes(name)) return true;
  return false;
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/scan/exclusions.ts packages/engine/src/scan/exclusions.test.ts
git commit -m "feat(engine/scan): add path exclusion rules

Task: M2-T01"
```

### M2-T02: Volume detection

**Files:**
- Create: `packages/engine/src/drives/volume.ts`
- Create: `packages/engine/src/drives/volume.test.ts`

The product targets Windows. Volume serial extraction on Windows uses `wmic` (deprecated but still present on Win10/11) or PowerShell. On non-Windows we synthesize a stable serial from the path so tests run portably.

- [ ] **Step 1: Write the failing test**

`packages/engine/src/drives/volume.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectVolume } from './volume.js';
import { mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('detectVolume', () => {
  it('returns shape with serial, capacity, free for a real path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-vol-'));
    try {
      const v = detectVolume(dir);
      expect(typeof v.volumeSerial).toBe('string');
      expect(v.volumeSerial.length).toBeGreaterThan(0);
      expect(v.totalBytes).toBeGreaterThan(0);
      expect(v.freeBytes).toBeGreaterThanOrEqual(0);
      expect(v.kind).toMatch(/local|external|network/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the same serial across calls for the same path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fileorg-vol-'));
    try {
      const a = detectVolume(dir);
      const b = detectVolume(dir);
      expect(a.volumeSerial).toBe(b.volumeSerial);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/drives/volume.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Expected: PASS. (Note: `statfsSync` is Node ≥ 18 stable; should work on Node 22.)

- [ ] **Step 5: Commit**

```
git add packages/engine/src/drives/volume.ts packages/engine/src/drives/volume.test.ts
git commit -m "feat(engine/drives): add volume detection (windows + posix synth)

Task: M2-T02"
```

### M2-T03: Files repo

**Files:**
- Create: `packages/engine/src/catalog/files-repo.ts`
- Create: `packages/engine/src/catalog/files-repo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/catalog/files-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo, type UpsertFileInput } from './files-repo.js';

let dir: string;
let db: Catalog;
let driveId: string;
let scanId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-files-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  const drive = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  });
  driveId = drive.id;
  scanId = 'test-scan-1';
  db.prepare(
    `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
  ).run(scanId, driveId, new Date().toISOString(), 'running', 'balanced');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function input(path: string, sha: string, mtime: string): UpsertFileInput {
  return {
    driveId,
    path,
    name: path.split('/').pop()!,
    extension: 'jpg',
    sizeBytes: 100,
    category: 'image',
    sha256: sha,
    mtime,
    ctime: mtime,
    exifDate: null,
    dateSource: 'mtime',
    width: null,
    height: null,
    durationSeconds: null,
    ntfsFileId: null,
    state: 'indexed',
    scanId,
  };
}

describe('FilesRepo', () => {
  it('upsertOne inserts a new file', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const row = repo.findByPath(driveId, '/a.jpg');
    expect(row).not.toBeNull();
    expect(row!.sha256).toBe('h1');
  });

  it('upsertOne replaces on (drive,path) collision', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    repo.upsertOne(input('/a.jpg', 'h2', '2024-02-01T00:00:00.000Z'));
    const row = repo.findByPath(driveId, '/a.jpg');
    expect(row!.sha256).toBe('h2');
  });

  it('quickCheck returns "skip" for unchanged file', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const r = repo.quickCheck(driveId, '/a.jpg', 100, '2024-01-01T00:00:00.000Z');
    expect(r.kind).toBe('skip');
  });

  it('quickCheck returns "rehash" when size or mtime differs', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    expect(repo.quickCheck(driveId, '/a.jpg', 200, '2024-01-01T00:00:00.000Z').kind).toBe('rehash');
    expect(repo.quickCheck(driveId, '/a.jpg', 100, '2024-02-01T00:00:00.000Z').kind).toBe('rehash');
  });

  it('quickCheck returns "new" for unknown path', () => {
    const repo = new FilesRepo(db);
    expect(repo.quickCheck(driveId, '/x.jpg', 1, '2024-01-01T00:00:00.000Z').kind).toBe('new');
  });

  it('markMissing flips state for files not seen in current scan', () => {
    const repo = new FilesRepo(db);
    repo.upsertOne(input('/a.jpg', 'h1', '2024-01-01T00:00:00.000Z'));
    const newScanId = 'test-scan-2';
    db.prepare(
      `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
    ).run(newScanId, driveId, new Date().toISOString(), 'running', 'balanced');
    repo.markMissing(driveId, newScanId);
    const row = repo.findByPath(driveId, '/a.jpg');
    expect(row!.state).toBe('missing');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/catalog/files-repo.ts`**

```ts
import type { Catalog } from './connection.js';
import type { Category, DateSource, FileRecord, FileState } from '@fileorganizer/shared';

export interface UpsertFileInput {
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
  scanId: string;
}

export type QuickCheckResult =
  | { kind: 'skip'; fileId: number }
  | { kind: 'rehash'; fileId: number }
  | { kind: 'new' };

export class FilesRepo {
  constructor(private readonly db: Catalog) {}

  upsertOne(input: UpsertFileInput): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO files (
          drive_id, path, name, extension, size_bytes, category, sha256,
          mtime, ctime, exif_date, date_source, width, height, duration_seconds,
          ntfs_file_id, state, last_verified_at, scan_id
        ) VALUES (
          @driveId, @path, @name, @extension, @sizeBytes, @category, @sha256,
          @mtime, @ctime, @exifDate, @dateSource, @width, @height, @durationSeconds,
          @ntfsFileId, @state, @lastVerifiedAt, @scanId
        )
        ON CONFLICT(drive_id, path) DO UPDATE SET
          name = excluded.name,
          extension = excluded.extension,
          size_bytes = excluded.size_bytes,
          category = excluded.category,
          sha256 = excluded.sha256,
          mtime = excluded.mtime,
          ctime = excluded.ctime,
          exif_date = excluded.exif_date,
          date_source = excluded.date_source,
          width = excluded.width,
          height = excluded.height,
          duration_seconds = excluded.duration_seconds,
          ntfs_file_id = excluded.ntfs_file_id,
          state = excluded.state,
          last_verified_at = excluded.last_verified_at,
          scan_id = excluded.scan_id`,
      )
      .run({ ...input, lastVerifiedAt: now });
  }

  quickCheck(
    driveId: string,
    path: string,
    sizeBytes: number,
    mtime: string,
  ): QuickCheckResult {
    const row = this.db
      .prepare(`SELECT id, size_bytes, mtime FROM files WHERE drive_id = ? AND path = ?`)
      .get(driveId, path) as { id: number; size_bytes: number; mtime: string } | undefined;
    if (!row) return { kind: 'new' };
    if (row.size_bytes === sizeBytes && row.mtime === mtime) {
      return { kind: 'skip', fileId: row.id };
    }
    return { kind: 'rehash', fileId: row.id };
  }

  bumpLastVerified(fileId: number, scanId: string): void {
    this.db
      .prepare(`UPDATE files SET last_verified_at = ?, scan_id = ?, state = 'indexed' WHERE id = ?`)
      .run(new Date().toISOString(), scanId, fileId);
  }

  findByPath(driveId: string, path: string): FileRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM files WHERE drive_id = ? AND path = ?`)
      .get(driveId, path) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : null;
  }

  markMissing(driveId: string, currentScanId: string): number {
    const result = this.db
      .prepare(
        `UPDATE files SET state = 'missing'
         WHERE drive_id = ? AND scan_id != ? AND state = 'indexed'`,
      )
      .run(driveId, currentScanId);
    return result.changes;
  }
}

function toRecord(row: Record<string, unknown>): FileRecord {
  return {
    id: row['id'] as number,
    driveId: row['drive_id'] as string,
    path: row['path'] as string,
    name: row['name'] as string,
    extension: row['extension'] as string,
    sizeBytes: row['size_bytes'] as number,
    category: row['category'] as Category,
    sha256: row['sha256'] as string,
    mtime: row['mtime'] as string,
    ctime: row['ctime'] as string,
    exifDate: (row['exif_date'] as string | null) ?? null,
    dateSource: row['date_source'] as DateSource,
    width: (row['width'] as number | null) ?? null,
    height: (row['height'] as number | null) ?? null,
    durationSeconds: (row['duration_seconds'] as number | null) ?? null,
    ntfsFileId: (row['ntfs_file_id'] as string | null) ?? null,
    state: row['state'] as FileState,
    lastVerifiedAt: row['last_verified_at'] as string,
    scanId: row['scan_id'] as string,
  };
}
```

- [ ] **Step 4: Run tests**

Expected: PASS, 6 tests added.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/catalog/files-repo.ts packages/engine/src/catalog/files-repo.test.ts
git commit -m "feat(engine/catalog): add files repository with quick-check semantics

Task: M2-T03"
```

### M2-T04: Scans repo

**Files:**
- Create: `packages/engine/src/catalog/scans-repo.ts`
- Create: `packages/engine/src/catalog/scans-repo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/catalog/scans-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { ScansRepo } from './scans-repo.js';

let dir: string;
let db: Catalog;
let driveId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-scans-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  const d = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  });
  driveId = d.id;
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('ScansRepo', () => {
  it('starts a scan and stores it as running', () => {
    const repo = new ScansRepo(db);
    const scan = repo.start({
      driveId,
      rootPaths: ['/foo'],
      throttleProfile: 'balanced',
    });
    expect(scan.id).toBeTruthy();
    expect(scan.status).toBe('running');
  });

  it('updates progress and finishes a scan', () => {
    const repo = new ScansRepo(db);
    const scan = repo.start({ driveId, rootPaths: ['/foo'], throttleProfile: 'balanced' });
    repo.updateProgress(scan.id, {
      lastCompletedDirectory: '/foo/bar',
      filesSeen: 10,
      filesIndexed: 8,
      filesSkipped: 2,
      bytesProcessed: 1024,
    });
    repo.finish(scan.id, 'completed', { errors: 0 });
    const reloaded = repo.findById(scan.id);
    expect(reloaded!.status).toBe('completed');
    expect(reloaded!.progress.filesIndexed).toBe(8);
    expect(reloaded!.stats.errors).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/catalog/scans-repo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Catalog } from './connection.js';
import type {
  ScanProgress,
  ScanRecord,
  ScanStats,
  ScanStatus,
  ThrottleProfileName,
} from '@fileorganizer/shared';

export interface StartScanInput {
  driveId: string;
  rootPaths: string[];
  throttleProfile: ThrottleProfileName;
}

const EMPTY_PROGRESS: ScanProgress = {
  lastCompletedDirectory: null,
  filesSeen: 0,
  filesIndexed: 0,
  filesSkipped: 0,
  bytesProcessed: 0,
};

const EMPTY_STATS: ScanStats = { ...EMPTY_PROGRESS, errors: 0 };

export class ScansRepo {
  constructor(private readonly db: Catalog) {}

  start(input: StartScanInput): ScanRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scans (id, drive_id, started_at, status, root_paths, throttle_profile, progress, stats)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.driveId,
        now,
        JSON.stringify(input.rootPaths),
        input.throttleProfile,
        JSON.stringify(EMPTY_PROGRESS),
        JSON.stringify(EMPTY_STATS),
      );
    return this.findById(id)!;
  }

  updateProgress(id: string, progress: ScanProgress): void {
    this.db
      .prepare(`UPDATE scans SET progress = ? WHERE id = ?`)
      .run(JSON.stringify(progress), id);
  }

  finish(id: string, status: ScanStatus, statsOverride: Partial<ScanStats>): void {
    const existing = this.findById(id);
    if (!existing) return;
    const stats: ScanStats = { ...existing.progress, errors: 0, ...statsOverride };
    this.db
      .prepare(`UPDATE scans SET status = ?, finished_at = ?, stats = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), JSON.stringify(stats), id);
  }

  pause(id: string): void {
    this.db.prepare(`UPDATE scans SET status = 'paused' WHERE id = ?`).run(id);
  }

  findById(id: string): ScanRecord | null {
    const row = this.db.prepare(`SELECT * FROM scans WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toRecord(row) : null;
  }
}

function toRecord(row: Record<string, unknown>): ScanRecord {
  return {
    id: row['id'] as string,
    driveId: row['drive_id'] as string,
    startedAt: row['started_at'] as string,
    finishedAt: (row['finished_at'] as string | null) ?? null,
    status: row['status'] as ScanStatus,
    rootPaths: JSON.parse((row['root_paths'] as string) || '[]') as string[],
    throttleProfile: row['throttle_profile'] as ThrottleProfileName,
    progress: JSON.parse((row['progress'] as string) || '{}') as ScanProgress,
    stats: JSON.parse((row['stats'] as string) || '{}') as ScanStats,
  };
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/catalog/scans-repo.ts packages/engine/src/catalog/scans-repo.test.ts
git commit -m "feat(engine/catalog): add scans repository

Task: M2-T04"
```

### M2-T05: File walker

**Files:**
- Create: `packages/engine/src/scan/walker.ts`
- Create: `packages/engine/src/scan/walker.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/scan/walker.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walk, type WalkOptions } from './walker.js';

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

describe('walk', () => {
  it('emits files matching extension allowlist', async () => {
    touch('a.jpg');
    touch('b.pdf');
    touch('c.exe');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, ''));
    }
    expect(seen.sort()).toEqual(['/a.jpg', '/b.pdf']);
  });

  it('skips excluded directories', async () => {
    touch('keep/a.jpg');
    touch('Windows/skip.jpg');
    touch('node_modules/skip.jpg');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, ''));
    }
    expect(seen).toEqual(['/keep/a.jpg']);
  });

  it('skips dot-prefixed directories', async () => {
    touch('.git/skip.jpg');
    touch('keep.jpg');
    const seen: string[] = [];
    for await (const entry of walk({ ...opts, roots: [root] })) {
      seen.push(entry.path.replace(root, ''));
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
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/scan/walker.ts`**

```ts
import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { isPathExcluded } from './exclusions.js';

export interface WalkOptions {
  roots: string[];
  extensions: ReadonlySet<string>;
  excluded: ReadonlySet<string>;
  extraExcluded: readonly string[];
}

export interface WalkEntry {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  mtime: string;
  ctime: string;
}

export async function* walk(opts: WalkOptions): AsyncIterable<WalkEntry> {
  for (const root of opts.roots) {
    yield* walkOne(root, opts);
  }
}

async function* walkOne(dir: string, opts: WalkOptions): AsyncIterable<WalkEntry> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childName = entry.name;
    if (isPathExcluded(childName, opts.excluded, opts.extraExcluded)) {
      continue;
    }
    const childPath = join(dir, childName);
    if (entry.isDirectory()) {
      yield* walkOne(childPath, opts);
    } else if (entry.isFile()) {
      const ext = extname(childName).slice(1).toLowerCase();
      if (!opts.extensions.has(ext)) continue;
      let s;
      try {
        s = await stat(childPath);
      } catch {
        continue;
      }
      yield {
        path: childPath,
        name: basename(childPath),
        extension: ext,
        sizeBytes: s.size,
        mtime: s.mtime.toISOString(),
        ctime: s.ctime.toISOString(),
      };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/scan/walker.ts packages/engine/src/scan/walker.test.ts
git commit -m "feat(engine/scan): add async file walker with category and exclusion filters

Task: M2-T05"
```

### M2-T06: Hasher

**Files:**
- Create: `packages/engine/src/scan/hasher.ts`
- Create: `packages/engine/src/scan/hasher.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/scan/hasher.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashFile } from './hasher.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-hash-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('hashFile', () => {
  it('computes the sha256 of a known input', async () => {
    const path = join(dir, 'a.bin');
    writeFileSync(path, 'hello world');
    const hash = await hashFile(path, { chunkBytes: 64, sleepMs: 0 });
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('handles empty files', async () => {
    const path = join(dir, 'empty.bin');
    writeFileSync(path, '');
    const hash = await hashFile(path, { chunkBytes: 64, sleepMs: 0 });
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('respects chunk size by producing same hash regardless of chunking', async () => {
    const path = join(dir, 'big.bin');
    writeFileSync(path, 'a'.repeat(10_000));
    const small = await hashFile(path, { chunkBytes: 100, sleepMs: 0 });
    const large = await hashFile(path, { chunkBytes: 10_000, sleepMs: 0 });
    expect(small).toBe(large);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/scan/hasher.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/scan/hasher.ts packages/engine/src/scan/hasher.test.ts
git commit -m "feat(engine/scan): add streaming sha256 hasher with chunk + throttle controls

Task: M2-T06"
```

### M2-T07: EXIF metadata extractor

**Files:**
- Create: `packages/engine/src/scan/metadata-image.ts`
- Create: `packages/engine/src/scan/metadata-image.test.ts`
- Create: `packages/engine/src/scan/__fixtures__/build-fixtures.ts`

- [ ] **Step 1: Write the fixture builder**

`packages/engine/src/scan/__fixtures__/build-fixtures.ts`:

```ts
// Minimal JPEG with embedded EXIF DateTimeOriginal "2023:08:15 14:23:01"
// Used by tests to avoid checking binary blobs into git.
import { writeFileSync } from 'node:fs';

const HEADER = Buffer.from([0xff, 0xd8]);
const APP1_MARKER = Buffer.from([0xff, 0xe1]);
const EXIF_HEADER = Buffer.from('Exif\0\0', 'ascii');
// Big-endian TIFF header
const TIFF_HEADER = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);

function dateTimeOriginalIfd(): Buffer {
  // 1 IFD entry, points to ExifIFD
  const exifIfdOffset = 26;
  const ifd0 = Buffer.alloc(2 + 12 + 4);
  ifd0.writeUInt16BE(1, 0);
  // Tag 0x8769 ExifIFDPointer, type LONG (4), count 1, value = exifIfdOffset
  ifd0.writeUInt16BE(0x8769, 2);
  ifd0.writeUInt16BE(4, 4);
  ifd0.writeUInt32BE(1, 6);
  ifd0.writeUInt32BE(exifIfdOffset, 10);
  ifd0.writeUInt32BE(0, 14); // next IFD offset

  // ExifIFD with one entry: DateTimeOriginal (0x9003), ASCII (2), count 20, offset
  const dateBytes = Buffer.from('2023:08:15 14:23:01\0', 'ascii');
  const exifIfd = Buffer.alloc(2 + 12 + 4);
  exifIfd.writeUInt16BE(1, 0);
  exifIfd.writeUInt16BE(0x9003, 2);
  exifIfd.writeUInt16BE(2, 4);
  exifIfd.writeUInt32BE(dateBytes.length, 6);
  // value offset: relative to TIFF header start
  const dateOffset = exifIfdOffset + exifIfd.length;
  exifIfd.writeUInt32BE(dateOffset, 10);
  exifIfd.writeUInt32BE(0, 14);

  return Buffer.concat([ifd0, exifIfd, dateBytes]);
}

export function buildJpegWithExifDate(outPath: string): void {
  const tiff = Buffer.concat([TIFF_HEADER.slice(0, 4), Buffer.from([0, 0, 0, 8]), dateTimeOriginalIfd()]);
  // Recompose with TIFF header at the start
  const tiffData = Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]), dateTimeOriginalIfd()]);
  const exifPayload = Buffer.concat([EXIF_HEADER, tiffData]);
  const app1Length = exifPayload.length + 2;
  const app1Header = Buffer.from([0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff]);
  // Empty SOS to make it a (barely) valid JPEG
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
  const jpeg = Buffer.concat([HEADER, app1Header, exifPayload, sos]);
  writeFileSync(outPath, jpeg);
}
```

> **Note:** A real JPEG decoder may complain about this minimal fixture. `exifr` parses the EXIF section without decoding the image, which is what we test. If a future test requires a fully-valid JPEG, swap to `sharp.create(...)` with metadata.

- [ ] **Step 2: Write the failing test**

`packages/engine/src/scan/metadata-image.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractImageMetadata } from './metadata-image.js';
import { buildJpegWithExifDate } from './__fixtures__/build-fixtures.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-meta-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('extractImageMetadata', () => {
  it('returns null exif date for a non-exif file', async () => {
    const { writeFileSync } = await import('node:fs');
    const path = join(dir, 'plain.jpg');
    writeFileSync(path, Buffer.from('not a real image'));
    const meta = await extractImageMetadata(path);
    expect(meta.exifDate).toBeNull();
  });

  it('reads DateTimeOriginal from a synthesized exif jpeg', async () => {
    const path = join(dir, 'exif.jpg');
    buildJpegWithExifDate(path);
    const meta = await extractImageMetadata(path);
    expect(meta.exifDate).toMatch(/^2023-08-15T14:23:01/);
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

- [ ] **Step 4: Implement `packages/engine/src/scan/metadata-image.ts`**

```ts
import exifr from 'exifr';

export interface ImageMetadata {
  exifDate: string | null;
  width: number | null;
  height: number | null;
}

const PARSE_OPTS = {
  pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight'],
} as const;

export async function extractImageMetadata(path: string): Promise<ImageMetadata> {
  try {
    const data = await exifr.parse(path, PARSE_OPTS as object);
    if (!data) return { exifDate: null, width: null, height: null };
    const candidates: unknown[] = [data.DateTimeOriginal, data.CreateDate, data.DateTimeDigitized];
    let exifDate: string | null = null;
    for (const c of candidates) {
      if (c instanceof Date && !Number.isNaN(c.getTime())) {
        exifDate = c.toISOString();
        break;
      }
    }
    const width =
      typeof data.ExifImageWidth === 'number'
        ? data.ExifImageWidth
        : typeof data.ImageWidth === 'number'
          ? data.ImageWidth
          : null;
    const height =
      typeof data.ExifImageHeight === 'number'
        ? data.ExifImageHeight
        : typeof data.ImageHeight === 'number'
          ? data.ImageHeight
          : null;
    return { exifDate, width, height };
  } catch {
    return { exifDate: null, width: null, height: null };
  }
}
```

- [ ] **Step 5: Run tests**

Expected: PASS.

> **If `exifr` rejects the synthesized fixture,** generate it with `sharp` instead:
> ```ts
> import sharp from 'sharp';
> await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' }})
>   .withExif({ IFD0: { ImageDescription: 'fixture' }, ExifIFD: { DateTimeOriginal: '2023:08:15 14:23:01' }})
>   .jpeg()
>   .toFile(outPath);
> ```
> Apply that fix in the fixture builder and re-run the test before committing.

- [ ] **Step 6: Commit**

```
git add packages/engine/src/scan/metadata-image.ts packages/engine/src/scan/metadata-image.test.ts packages/engine/src/scan/__fixtures__/
git commit -m "feat(engine/scan): add image metadata extractor (exif date, dimensions)

Task: M2-T07"
```

### M2-T08: Video metadata extractor (subprocess to mediainfo)

**Files:**
- Create: `packages/engine/src/scan/metadata-video.ts`
- Create: `packages/engine/src/scan/metadata-video.test.ts`
- Create: `scripts/fetch-binaries.ts`
- Modify: `packages/engine/package.json` (already has `bin/` dir from M0; nothing to change here)

- [ ] **Step 1: Write the fetch-binaries script**

`scripts/fetch-binaries.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Downloads mediainfo CLI for Windows into packages/engine/bin/.
 * Run via: npm run fetch-binaries
 */
import { mkdirSync, existsSync, createWriteStream, chmodSync } from 'node:fs';
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
  // Pinned URL — verify in CI; replace if upstream archive moves.
  // For Windows users, the canonical mediainfo CLI release is available at:
  // https://mediaarea.net/en/MediaInfo/Download/Windows
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
    `[fetch-binaries] saved ${b.name} archive to ${tmpZip}. Manual extraction may be required ` +
      `if your environment lacks unzip — install one and re-run.`,
  );
  // Note: a real implementation would extract here. We deliberately stop at the .zip
  // M7-T06 replaces this with proper unzip extraction.
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
```

- [ ] **Step 2: Write the failing test**

`packages/engine/src/scan/metadata-video.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractVideoMetadata, parseMediainfoOutput } from './metadata-video.js';

describe('parseMediainfoOutput', () => {
  it('returns null exifDate when no recorded date', () => {
    const json = JSON.stringify({
      media: { track: [{ '@type': 'Video', Width: '1920', Height: '1080', Duration: '12.345' }] },
    });
    const meta = parseMediainfoOutput(json);
    expect(meta.exifDate).toBeNull();
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.durationSeconds).toBeCloseTo(12.345, 3);
  });

  it('reads creation time from General track', () => {
    const json = JSON.stringify({
      media: {
        track: [
          { '@type': 'General', Recorded_Date: '2023-08-15T14:23:01Z' },
          { '@type': 'Video', Width: '1920', Height: '1080', Duration: '5.0' },
        ],
      },
    });
    const meta = parseMediainfoOutput(json);
    expect(meta.exifDate).toBe('2023-08-15T14:23:01.000Z');
  });

  it('handles missing video track gracefully', () => {
    const json = JSON.stringify({ media: { track: [] } });
    const meta = parseMediainfoOutput(json);
    expect(meta.width).toBeNull();
    expect(meta.height).toBeNull();
    expect(meta.durationSeconds).toBeNull();
  });
});

describe('extractVideoMetadata', () => {
  it('returns blank metadata when binary path is missing', async () => {
    const meta = await extractVideoMetadata('/does/not/exist.mp4', { binaryPath: '/no/such/binary' });
    expect(meta).toEqual({ exifDate: null, width: null, height: null, durationSeconds: null });
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

- [ ] **Step 4: Implement `packages/engine/src/scan/metadata-video.ts`**

```ts
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  exifDate: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface ExtractVideoOptions {
  binaryPath: string;
  timeoutMs?: number;
}

export async function extractVideoMetadata(
  path: string,
  opts: ExtractVideoOptions,
): Promise<VideoMetadata> {
  if (!existsSync(opts.binaryPath)) {
    return { exifDate: null, width: null, height: null, durationSeconds: null };
  }
  try {
    const { stdout } = await execFileAsync(
      opts.binaryPath,
      ['--Output=JSON', '--Full', path],
      { timeout: opts.timeoutMs ?? 10_000, maxBuffer: 5 * 1024 * 1024 },
    );
    return parseMediainfoOutput(stdout);
  } catch {
    return { exifDate: null, width: null, height: null, durationSeconds: null };
  }
}

interface MediaInfoTrack {
  '@type': string;
  Width?: string;
  Height?: string;
  Duration?: string;
  Recorded_Date?: string;
  Encoded_Date?: string;
  Tagged_Date?: string;
}

interface MediaInfoOutput {
  media?: { track?: MediaInfoTrack[] };
}

export function parseMediainfoOutput(json: string): VideoMetadata {
  let parsed: MediaInfoOutput;
  try {
    parsed = JSON.parse(json) as MediaInfoOutput;
  } catch {
    return { exifDate: null, width: null, height: null, durationSeconds: null };
  }
  const tracks = parsed.media?.track ?? [];
  const general = tracks.find((t) => t['@type'] === 'General');
  const video = tracks.find((t) => t['@type'] === 'Video');
  const dateStr = general?.Recorded_Date ?? general?.Encoded_Date ?? general?.Tagged_Date ?? null;
  const exifDate = dateStr ? toIsoOrNull(dateStr) : null;
  const width = numberOrNull(video?.Width);
  const height = numberOrNull(video?.Height);
  const durationSeconds = numberOrNull(video?.Duration);
  return { exifDate, width, height, durationSeconds };
}

function toIsoOrNull(s: string): string | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function numberOrNull(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
```

- [ ] **Step 5: Run tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add packages/engine/src/scan/metadata-video.ts packages/engine/src/scan/metadata-video.test.ts scripts/fetch-binaries.ts
git commit -m "feat(engine/scan): add video metadata extractor via mediainfo subprocess

Task: M2-T08"
```

### M2-T09: Date resolution

**Files:**
- Create: `packages/engine/src/scan/date-resolver.ts`
- Create: `packages/engine/src/scan/date-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/scan/date-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveFileDate } from './date-resolver.js';

describe('resolveFileDate', () => {
  it('prefers exif when present and valid', () => {
    const r = resolveFileDate({ exifDate: '2023-08-15T00:00:00.000Z', mtime: '2024-01-01T00:00:00.000Z' });
    expect(r.date).toBe('2023-08-15T00:00:00.000Z');
    expect(r.source).toBe('exif');
  });

  it('falls back to mtime when exif is missing', () => {
    const r = resolveFileDate({ exifDate: null, mtime: '2024-01-01T00:00:00.000Z' });
    expect(r.date).toBe('2024-01-01T00:00:00.000Z');
    expect(r.source).toBe('mtime');
  });

  it('returns none when both missing', () => {
    const r = resolveFileDate({ exifDate: null, mtime: null });
    expect(r.date).toBeNull();
    expect(r.source).toBe('none');
  });

  it('flags suspicious exif (future) and falls through to mtime', () => {
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const r = resolveFileDate({ exifDate: future, mtime: '2024-01-01T00:00:00.000Z' });
    expect(r.source).toBe('mtime');
    expect(r.suspicious).toBe(true);
  });

  it('flags suspicious exif (before 1990)', () => {
    const r = resolveFileDate({ exifDate: '1980-01-01T00:00:00.000Z', mtime: '2024-01-01T00:00:00.000Z' });
    expect(r.source).toBe('mtime');
    expect(r.suspicious).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/scan/date-resolver.ts`**

```ts
import type { DateSource } from '@fileorganizer/shared';

export interface DateResolutionInput {
  exifDate: string | null;
  mtime: string | null;
}

export interface DateResolution {
  date: string | null;
  source: DateSource;
  suspicious: boolean;
}

const MIN_REASONABLE = Date.UTC(1990, 0, 1);

export function resolveFileDate(input: DateResolutionInput): DateResolution {
  const now = Date.now();
  if (input.exifDate) {
    const t = Date.parse(input.exifDate);
    if (!Number.isNaN(t) && t >= MIN_REASONABLE && t <= now) {
      return { date: input.exifDate, source: 'exif', suspicious: false };
    }
    if (input.mtime) {
      return { date: input.mtime, source: 'mtime', suspicious: true };
    }
    return { date: null, source: 'none', suspicious: true };
  }
  if (input.mtime) {
    return { date: input.mtime, source: 'mtime', suspicious: false };
  }
  return { date: null, source: 'none', suspicious: false };
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/scan/date-resolver.ts packages/engine/src/scan/date-resolver.test.ts
git commit -m "feat(engine/scan): add EXIF→mtime date resolver with suspicious flag

Task: M2-T09"
```

### M2-T10: Throttle profile manager

**Files:**
- Create: `packages/engine/src/throttle/manager.ts`
- Create: `packages/engine/src/throttle/manager.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/throttle/manager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ThrottleManager } from './manager.js';
import { defaultThrottleProfiles } from '@fileorganizer/shared';

describe('ThrottleManager', () => {
  it('returns the active profile', () => {
    const profiles = defaultThrottleProfiles(4);
    const m = new ThrottleManager(profiles, 'balanced', []);
    expect(m.current().name).toBe('balanced');
  });

  it('switches via setProfile', () => {
    const profiles = defaultThrottleProfiles(4);
    const m = new ThrottleManager(profiles, 'idle', []);
    m.setProfile('full-send');
    expect(m.current().name).toBe('full-send');
  });

  it('uses schedule to pick profile based on time-of-day', () => {
    const profiles = defaultThrottleProfiles(4);
    const m = new ThrottleManager(profiles, 'balanced', [
      { dayOfWeek: 1, startHour: 22, endHour: 6, profile: 'full-send' },
      { dayOfWeek: 1, startHour: 9, endHour: 18, profile: 'idle' },
    ]);
    // Monday 11:00 → idle window (9-18)
    const monday11 = new Date('2024-01-08T11:00:00');
    expect(m.profileForDate(monday11).name).toBe('idle');
    // Monday 23:00 → full-send (22-6 wraps midnight)
    const monday23 = new Date('2024-01-08T23:00:00');
    expect(m.profileForDate(monday23).name).toBe('full-send');
    // Monday 03:00 → full-send (still in 22-6 window)
    const monday03 = new Date('2024-01-08T03:00:00');
    expect(m.profileForDate(monday03).name).toBe('full-send');
  });

  it('falls back to current profile when no schedule entry matches', () => {
    const profiles = defaultThrottleProfiles(4);
    const m = new ThrottleManager(profiles, 'balanced', []);
    expect(m.profileForDate(new Date()).name).toBe('balanced');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/throttle/manager.ts`**

```ts
import type {
  ThrottleProfile,
  ThrottleProfileName,
  ThrottleScheduleEntry,
} from '@fileorganizer/shared';

export class ThrottleManager {
  private active: ThrottleProfileName;

  constructor(
    private readonly profiles: Record<ThrottleProfileName, ThrottleProfile>,
    initial: ThrottleProfileName,
    private readonly schedule: ThrottleScheduleEntry[],
  ) {
    this.active = initial;
  }

  current(): ThrottleProfile {
    return this.profiles[this.active];
  }

  setProfile(name: ThrottleProfileName): void {
    this.active = name;
  }

  profileForDate(date: Date): ThrottleProfile {
    const dow = date.getDay();
    const hour = date.getHours();
    for (const entry of this.schedule) {
      if (entry.dayOfWeek !== dow) continue;
      if (hourInWindow(hour, entry.startHour, entry.endHour)) {
        return this.profiles[entry.profile];
      }
    }
    return this.current();
  }
}

function hourInWindow(hour: number, start: number, end: number): boolean {
  if (start <= end) {
    return hour >= start && hour < end;
  }
  // wraps midnight, e.g., 22..6
  return hour >= start || hour < end;
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/throttle/manager.ts packages/engine/src/throttle/manager.test.ts
git commit -m "feat(engine/throttle): add throttle manager with schedule-driven switching

Task: M2-T10"
```

### M2-T11: Scan orchestrator (the integration of M2-T01 through M2-T10)

**Files:**
- Create: `packages/engine/src/scan/orchestrator.ts`
- Create: `packages/engine/src/scan/orchestrator.test.ts`

This is the largest task in M2. Read it in full before starting.

- [ ] **Step 1: Write the failing test**

`packages/engine/src/scan/orchestrator.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { runScan } from './orchestrator.js';
import { ThrottleManager } from '../throttle/manager.js';
import { defaultThrottleProfiles, DEFAULT_CATEGORY_MAP } from '@fileorganizer/shared';
import { createLogger } from '../log.js';

let dir: string;
let db: Catalog;
let driveId: string;
let scanRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-orch-'));
  db = openCatalog(join(dir, 'catalog.db'));
  migrate(db);
  scanRoot = join(dir, 'data');
  mkdirSync(scanRoot, { recursive: true });
  const drive = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1_000_000_000,
    freeBytes: 500_000_000,
  });
  driveId = drive.id;
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function fixture(rel: string, body: string): string {
  const path = join(scanRoot, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  return path;
}

describe('runScan', () => {
  it('indexes new files and assigns categories', async () => {
    fixture('a.jpg', 'aaa');
    fixture('b.pdf', 'bbb');
    fixture('skip.exe', 'xxx');
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const result = await runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    });
    expect(result.filesIndexed).toBe(2);
    expect(result.filesSkipped).toBe(1);
    const files = new FilesRepo(db);
    expect(files.findByPath(driveId, join(scanRoot, 'a.jpg'))?.category).toBe('image');
    expect(files.findByPath(driveId, join(scanRoot, 'b.pdf'))?.category).toBe('document');
  });

  it('skips re-hashing unchanged files on second scan', async () => {
    fixture('a.jpg', 'aaa');
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const opts = {
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    };
    await runScan(opts);
    const second = await runScan(opts);
    expect(second.filesIndexed).toBe(0);
    expect(second.filesUnchanged).toBe(1);
  });

  it('marks files missing on rescan when they disappeared', async () => {
    const a = fixture('a.jpg', 'aaa');
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const opts = {
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    };
    await runScan(opts);
    rmSync(a);
    await runScan(opts);
    const files = new FilesRepo(db);
    expect(files.findByPath(driveId, a)?.state).toBe('missing');
  });

  it('persists a scans row with completed status', async () => {
    fixture('a.jpg', 'aaa');
    const writes: string[] = [];
    const log = createLogger({ level: 'error', write: (l) => writes.push(l) });
    const throttle = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    const result = await runScan({
      db, driveId, roots: [scanRoot], categoryMap: DEFAULT_CATEGORY_MAP,
      throttle, log, mediainfoPath: '/no/such',
    });
    const scan = new ScansRepo(db).findById(result.scanId);
    expect(scan!.status).toBe('completed');
    expect(scan!.progress.filesIndexed).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/scan/orchestrator.ts`**

```ts
import { extname } from 'node:path';
import type { Catalog } from '../catalog/connection.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { walk } from './walker.js';
import { hashFile } from './hasher.js';
import { extractImageMetadata } from './metadata-image.js';
import { extractVideoMetadata } from './metadata-video.js';
import { resolveFileDate } from './date-resolver.js';
import { DEFAULT_EXCLUDED_NAMES } from './exclusions.js';
import {
  categoryForExtension,
  type Category,
  type CategoryMap,
} from '@fileorganizer/shared';
import type { ThrottleManager } from '../throttle/manager.js';
import type { Logger } from '../log.js';

export interface RunScanOptions {
  db: Catalog;
  driveId: string;
  roots: string[];
  categoryMap: CategoryMap;
  throttle: ThrottleManager;
  log: Logger;
  mediainfoPath: string;
  extraExcluded?: readonly string[];
}

export interface RunScanResult {
  scanId: string;
  filesSeen: number;
  filesIndexed: number;
  filesUnchanged: number;
  filesSkipped: number;
  errors: number;
}

export async function runScan(opts: RunScanOptions): Promise<RunScanResult> {
  const filesRepo = new FilesRepo(opts.db);
  const scansRepo = new ScansRepo(opts.db);
  const scan = scansRepo.start({
    driveId: opts.driveId,
    rootPaths: opts.roots,
    throttleProfile: opts.throttle.current().name,
  });
  const log = opts.log.child({ scanId: scan.id });
  log.info('scan-started', { roots: opts.roots });

  const allowedExtensions = collectAllowedExtensions(opts.categoryMap);
  let filesSeen = 0;
  let filesIndexed = 0;
  let filesUnchanged = 0;
  let filesSkipped = 0;
  let errors = 0;
  let bytesProcessed = 0;
  let lastDir: string | null = null;

  try {
    const walker = walk({
      roots: opts.roots,
      extensions: allowedExtensions,
      excluded: DEFAULT_EXCLUDED_NAMES,
      extraExcluded: opts.extraExcluded ?? [],
    });

    for await (const entry of walker) {
      filesSeen += 1;
      const dirPart = entry.path.slice(0, entry.path.length - entry.name.length);
      if (dirPart !== lastDir) {
        lastDir = dirPart;
        scansRepo.updateProgress(scan.id, {
          lastCompletedDirectory: lastDir,
          filesSeen,
          filesIndexed,
          filesSkipped,
          bytesProcessed,
        });
      }
      const category = categoryForExtension(opts.categoryMap, entry.extension);
      if (!category) {
        filesSkipped += 1;
        continue;
      }
      try {
        const qc = filesRepo.quickCheck(opts.driveId, entry.path, entry.sizeBytes, entry.mtime);
        if (qc.kind === 'skip') {
          filesRepo.bumpLastVerified(qc.fileId, scan.id);
          filesUnchanged += 1;
          continue;
        }
        const profile = opts.throttle.current();
        const sha = await hashFile(entry.path, {
          chunkBytes: profile.readChunkBytes,
          sleepMs: profile.interChunkSleepMs,
        });
        bytesProcessed += entry.sizeBytes;
        let exifDate: string | null = null;
        let width: number | null = null;
        let height: number | null = null;
        let durationSeconds: number | null = null;
        if (category === 'image') {
          const m = await extractImageMetadata(entry.path);
          exifDate = m.exifDate;
          width = m.width;
          height = m.height;
        } else if (category === 'video') {
          const m = await extractVideoMetadata(entry.path, { binaryPath: opts.mediainfoPath });
          exifDate = m.exifDate;
          width = m.width;
          height = m.height;
          durationSeconds = m.durationSeconds;
        }
        const resolved = resolveFileDate({ exifDate, mtime: entry.mtime });
        filesRepo.upsertOne({
          driveId: opts.driveId,
          path: entry.path,
          name: entry.name,
          extension: entry.extension,
          sizeBytes: entry.sizeBytes,
          category,
          sha256: sha,
          mtime: entry.mtime,
          ctime: entry.ctime,
          exifDate: resolved.source === 'exif' ? resolved.date : null,
          dateSource: resolved.source,
          width,
          height,
          durationSeconds,
          ntfsFileId: null,
          state: 'indexed',
          scanId: scan.id,
        });
        filesIndexed += 1;
      } catch (err) {
        errors += 1;
        log.warn('file-error', { path: entry.path, err: (err as Error).message });
      }
    }

    filesRepo.markMissing(opts.driveId, scan.id);
    scansRepo.updateProgress(scan.id, {
      lastCompletedDirectory: lastDir,
      filesSeen,
      filesIndexed,
      filesSkipped,
      bytesProcessed,
    });
    scansRepo.finish(scan.id, 'completed', { errors });
    log.info('scan-completed', { filesIndexed, filesUnchanged, filesSkipped, errors });
  } catch (err) {
    scansRepo.finish(scan.id, 'failed', { errors });
    log.error('scan-failed', { err: (err as Error).message });
    throw err;
  }

  return { scanId: scan.id, filesSeen, filesIndexed, filesUnchanged, filesSkipped, errors };
}

function collectAllowedExtensions(map: CategoryMap): ReadonlySet<string> {
  const exts = new Set<string>();
  for (const list of Object.values(map)) {
    for (const ext of list) exts.add(ext.toLowerCase());
  }
  return exts;
}
```

- [ ] **Step 4: Run tests**

Expected: PASS, 4 orchestrator tests.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/scan/orchestrator.ts packages/engine/src/scan/orchestrator.test.ts
git commit -m "feat(engine/scan): add scan orchestrator integrating walker, hasher, metadata, repos

Task: M2-T11"
```

### M2-T12: CLI `scan` command

**Files:**
- Modify: `packages/engine/src/cli/index.ts`
- Create: `packages/engine/src/cli/scan.ts`
- Modify: `packages/engine/src/cli/index.test.ts`

- [ ] **Step 1: Implement `packages/engine/src/cli/scan.ts`**

```ts
import { resolve } from 'node:path';
import { readPointer } from '../catalog/locator.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { detectVolume } from '../drives/volume.js';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { runScan } from '../scan/orchestrator.js';
import { ThrottleManager } from '../throttle/manager.js';
import { createLogger, defaultWriter } from '../log.js';
import { CatalogError } from '@fileorganizer/shared';
import type { ThrottleProfileName } from '@fileorganizer/shared';

export interface ScanCliOptions {
  pointerPath: string;
  rootPath: string;
  profile?: ThrottleProfileName;
  mediainfoPath: string;
}

export async function runScanCli(opts: ScanCliOptions): Promise<{ scanId: string; filesIndexed: number; filesUnchanged: number; filesSkipped: number; errors: number }> {
  const ptr = readPointer(opts.pointerPath);
  if (!ptr) {
    throw new CatalogError('POINTER_MISSING', `no catalog pointer at ${opts.pointerPath}`);
  }
  const db = openCatalog(ptr.catalogPath);
  try {
    migrate(db);
    const settings = new SettingsRepo(db).load();
    const drives = new DriveRepo(db);
    const root = resolve(opts.rootPath);
    const volume = detectVolume(root);
    const drive = drives.upsert({
      volumeSerial: volume.volumeSerial,
      label: volume.currentLetter ?? root,
      currentLetter: volume.currentLetter,
      kind: volume.kind,
      roles: [],
      totalBytes: volume.totalBytes,
      freeBytes: volume.freeBytes,
    });
    const profileName: ThrottleProfileName = opts.profile ?? 'balanced';
    const throttle = new ThrottleManager(settings.throttleProfiles, profileName, settings.throttleSchedule);
    const log = createLogger({ level: 'info', write: defaultWriter });
    const result = await runScan({
      db,
      driveId: drive.id,
      roots: [root],
      categoryMap: settings.categoryMap,
      throttle,
      log,
      mediainfoPath: opts.mediainfoPath,
    });
    return result;
  } finally {
    closeCatalog(db);
  }
}
```

- [ ] **Step 2: Wire `scan` into `packages/engine/src/cli/index.ts`**

Add a case to the `switch (command)` block, immediately after `case 'status':`:

```ts
case 'scan': {
  const root = flags['path'];
  if (!root) {
    stderr.push('scan requires --path <directory>');
    return { exitCode: 1, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  }
  const profile = (flags['profile'] as 'idle' | 'balanced' | 'full-send' | undefined) ?? 'balanced';
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
```

…and add the import at the top:

```ts
import { runScanCli } from './scan.js';
```

…and update the help text in the existing `case 'help'` handler to include:

```
  scan --path <dir> [--profile idle|balanced|full-send] [--mediainfo <path>] [--pointer <path>]
```

- [ ] **Step 3: Add a CLI integration test**

Append to `packages/engine/src/cli/index.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';

describe('CLI scan', () => {
  it('runs a scan over a temp directory and reports indexed count', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'fileorg-cli-scan-'));
    try {
      const pointerPath = join(dir2, 'pointer.json');
      const catalogPath = join(dir2, 'cat.db');
      const dataDir = join(dir2, 'data');
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'a.jpg'), 'x');
      writeFileSync(join(dataDir, 'b.pdf'), 'y');
      await runCli(['init', '--pointer', pointerPath, '--catalog', catalogPath]);
      const r = await runCli([
        'scan',
        '--pointer', pointerPath,
        '--path', dataDir,
        '--profile', 'idle',
        '--mediainfo', '/no/such/binary',
      ]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('indexed=2');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Run tests**

```
npm test --workspace=@fileorganizer/engine
```

Expected: PASS, including the new scan CLI test.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/cli/scan.ts packages/engine/src/cli/index.ts packages/engine/src/cli/index.test.ts
git commit -m "feat(engine/cli): add scan command with throttle and mediainfo flags

Task: M2-T12"
```

### M2-T13: Milestone gate for M2

- [ ] **Step 1: Run all tests**

```
npm test
```

Expected: PASS for all workspaces.

- [ ] **Step 2: Run typecheck**

```
npm run typecheck
```

- [ ] **Step 3: Smoke-test the full flow**

```
mkdir -p /tmp/fileorg-smoke/data
echo aaa > /tmp/fileorg-smoke/data/a.jpg
echo bbb > /tmp/fileorg-smoke/data/b.pdf
npx tsx packages/engine/src/cli/index.ts init --pointer /tmp/fileorg-smoke/ptr.json --catalog /tmp/fileorg-smoke/cat.db
npx tsx packages/engine/src/cli/index.ts scan --pointer /tmp/fileorg-smoke/ptr.json --path /tmp/fileorg-smoke/data --profile idle --mediainfo /no/such/binary
npx tsx packages/engine/src/cli/index.ts status --pointer /tmp/fileorg-smoke/ptr.json
```

Expected:
- Scan reports `indexed=2`.
- Status reports 1 drive.


---

## Section M3 — UI scaffolding + read-only screens

**Goal:** A working local web UI served by the engine, with the read-only sections (Dashboard, Drives, Scans, Browse) and the ability to start/pause/resume scans from the UI. By end of M3 the user can run `fileorganizer serve`, open the browser, and see what's been indexed.

**Branch:**

- [ ] **Step setup-1:** `git checkout -b m3-ui-readonly`

### M3-T01: HTTP+WS API skeleton

**Files:**
- Create: `packages/engine/src/api/server.ts`
- Create: `packages/engine/src/api/server.test.ts`
- Create: `packages/engine/src/api/events.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/api/server.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { createServer, type ServerHandle } from './server.js';

let dir: string;
let db: Catalog;
let handle: ServerHandle;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-api-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  handle = await createServer({ db, port: 0, hostname: '127.0.0.1' });
});

afterEach(async () => {
  await handle.close();
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('API server', () => {
  it('binds a port and serves /healthz', async () => {
    const url = `http://127.0.0.1:${handle.port}/healthz`;
    const res = await fetch(url);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('lists drives at /api/drives', async () => {
    const url = `http://127.0.0.1:${handle.port}/api/drives`;
    const res = await fetch(url);
    const body = (await res.json()) as { drives: unknown[] };
    expect(res.status).toBe(200);
    expect(body.drives).toEqual([]);
  });

  it('returns 404 for unknown route', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/nope`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/api/events.ts`**

```ts
import { EventEmitter } from 'node:events';

export interface ScanProgressEvent {
  type: 'scan-progress';
  scanId: string;
  filesIndexed: number;
  filesUnchanged: number;
  filesSkipped: number;
  bytesProcessed: number;
}

export interface BatchStatusEvent {
  type: 'batch-status';
  batchId: string;
  status: string;
}

export type EngineEvent = ScanProgressEvent | BatchStatusEvent;

export class EventBus extends EventEmitter {
  publish(event: EngineEvent): void {
    this.emit('event', event);
  }
  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}
```

- [ ] **Step 4: Implement `packages/engine/src/api/server.ts`**

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Catalog } from '../catalog/connection.js';
import { DriveRepo } from '../drives/repo.js';
import { ScansRepo } from '../catalog/scans-repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { EventBus } from './events.js';

export interface CreateServerOptions {
  db: Catalog;
  port: number;
  hostname: string;
}

export interface ServerHandle {
  port: number;
  events: EventBus;
  close(): Promise<void>;
}

export async function createServer(opts: CreateServerOptions): Promise<ServerHandle> {
  const app = new Hono();
  const events = new EventBus();
  const drives = new DriveRepo(opts.db);
  const scans = new ScansRepo(opts.db);
  const files = new FilesRepo(opts.db);

  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/api/drives', (c) => c.json({ drives: drives.list() }));
  app.get('/api/scans/:id', (c) => {
    const id = c.req.param('id');
    const s = scans.findById(id);
    if (!s) return c.json({ error: 'not-found' }, 404);
    return c.json({ scan: s });
  });
  app.get('/api/files', (c) => {
    const driveId = c.req.query('driveId');
    if (!driveId) return c.json({ error: 'driveId required' }, 400);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 1000);
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10), 0);
    const rows = opts.db
      .prepare(
        `SELECT id, drive_id AS driveId, path, name, extension, size_bytes AS sizeBytes,
                category, sha256, mtime, exif_date AS exifDate, date_source AS dateSource,
                state FROM files WHERE drive_id = ? ORDER BY path LIMIT ? OFFSET ?`,
      )
      .all(driveId, limit, offset);
    return c.json({ files: rows });
  });

  return new Promise((resolveServer) => {
    const server = serve({
      fetch: app.fetch,
      port: opts.port,
      hostname: opts.hostname,
    }, (info) => {
      const handle: ServerHandle = {
        port: info.port,
        events,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      };
      resolveServer(handle);
    });
  });
}
```

- [ ] **Step 5: Run tests**

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```
git add packages/engine/src/api/server.ts packages/engine/src/api/server.test.ts packages/engine/src/api/events.ts
git commit -m "feat(engine/api): add hono server skeleton with /healthz, /api/drives, /api/files

Task: M3-T01"
```

### M3-T02: Engine `serve` command

**Files:**
- Modify: `packages/engine/src/cli/index.ts`
- Create: `packages/engine/src/cli/serve.ts`

- [ ] **Step 1: Implement `packages/engine/src/cli/serve.ts`**

```ts
import { readPointer, writePointer } from '../catalog/locator.js';
import { openCatalog, closeCatalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { createServer } from '../api/server.js';
import { CatalogError } from '@fileorganizer/shared';

export interface ServeCliOptions {
  pointerPath: string;
  port?: number;
}

export async function runServe(opts: ServeCliOptions): Promise<void> {
  const ptr = readPointer(opts.pointerPath);
  if (!ptr) {
    throw new CatalogError('POINTER_MISSING', `no catalog pointer at ${opts.pointerPath}`);
  }
  const db = openCatalog(ptr.catalogPath);
  migrate(db);
  const server = await createServer({ db, port: opts.port ?? 0, hostname: '127.0.0.1' });
  writePointer(opts.pointerPath, { catalogPath: ptr.catalogPath, uiPort: server.port });
  console.log(`Engine listening on http://127.0.0.1:${server.port}`);
  console.log(`Catalog: ${ptr.catalogPath}`);
  console.log('Press Ctrl+C to stop.');

  const shutdown = async () => {
    await server.close();
    closeCatalog(db);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
```

- [ ] **Step 2: Wire into the CLI**

Add to `packages/engine/src/cli/index.ts` switch:

```ts
case 'serve': {
  const port = flags['port'] ? parseInt(flags['port']!, 10) : undefined;
  await runServe({ pointerPath, port });
  return { exitCode: 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
```

…and import at the top:

```ts
import { runServe } from './serve.js';
```

…and update help text to include:

```
  serve [--port <number>] [--pointer <path>]
```

- [ ] **Step 3: Manual smoke test**

```
npx tsx packages/engine/src/cli/index.ts init --pointer /tmp/m3-ptr.json --catalog /tmp/m3-cat.db
npx tsx packages/engine/src/cli/index.ts serve --pointer /tmp/m3-ptr.json --port 0 &
SERVE_PID=$!
sleep 1
PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/m3-ptr.json')).uiPort)")
curl -s "http://127.0.0.1:$PORT/healthz"
kill $SERVE_PID
```

Expected: `{"ok":true}` printed.

- [ ] **Step 4: Commit**

```
git add packages/engine/src/cli/serve.ts packages/engine/src/cli/index.ts
git commit -m "feat(engine/cli): add serve command that boots the api server

Task: M3-T02"
```

### M3-T03: UI dependencies and Vite scaffolding

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/vite.config.ts`
- Create: `packages/ui/index.html`
- Create: `packages/ui/src/main.tsx`
- Create: `packages/ui/src/app.tsx`
- Create: `packages/ui/src/styles.css`

- [ ] **Step 1: Update `packages/ui/package.json`**

```json
{
  "name": "@fileorganizer/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fileorganizer/shared": "*",
    "preact": "^10.24.0",
    "preact-router": "^4.1.0",
    "@preact/signals": "^1.3.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "@preact/preset-vite": "^2.9.0",
    "@types/node": "^22.0.0",
    "@testing-library/preact": "^3.2.0",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 2: Install**

```
npm install
```

- [ ] **Step 3: Write `packages/ui/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5174',
      '/healthz': 'http://127.0.0.1:5174',
      '/ws': { target: 'ws://127.0.0.1:5174', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

> **Note:** the proxy target `5174` is a placeholder. The engine's `serve` mode will be configured to use that port during dev (see M3-T08 milestone gate).

- [ ] **Step 4: Write `packages/ui/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FileOrganizer</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `packages/ui/src/styles.css`**

```css
:root {
  --bg: #0e0f12;
  --panel: #16181d;
  --border: #2a2d34;
  --text: #e6e7ea;
  --muted: #8a8f99;
  --accent: #5c8bff;
  --danger: #ff6b6b;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); }
a { color: var(--accent); text-decoration: none; }
.layout { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.sidebar { background: var(--panel); border-right: 1px solid var(--border); padding: 16px; }
.sidebar nav a { display: block; padding: 8px 12px; border-radius: 6px; }
.sidebar nav a.active { background: var(--border); color: var(--text); }
.main { padding: 24px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.muted { color: var(--muted); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
button { background: var(--accent); color: white; border: 0; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
button.secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
.fill-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
.fill-bar > div { background: var(--accent); height: 100%; }
```

- [ ] **Step 6: Write `packages/ui/src/main.tsx`**

```tsx
import { render } from 'preact';
import { App } from './app.js';

const root = document.getElementById('app');
if (root) render(<App />, root);
```

- [ ] **Step 7: Write `packages/ui/src/app.tsx`**

```tsx
import { Router, Route } from 'preact-router';
import { Dashboard } from './routes/dashboard.js';
import { Drives } from './routes/drives.js';
import { Scans } from './routes/scans.js';
import { Browse } from './routes/browse.js';
import { Sidebar } from './components/sidebar.js';

export function App() {
  return (
    <div class="layout">
      <Sidebar />
      <main class="main">
        <Router>
          <Route path="/" component={Dashboard} />
          <Route path="/drives" component={Drives} />
          <Route path="/scans" component={Scans} />
          <Route path="/browse" component={Browse} />
        </Router>
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Verify typecheck builds**

```
npm run typecheck --workspace=@fileorganizer/ui
```

Expected: errors about missing `routes/dashboard`, `routes/drives`, etc. — these are added in M3-T04 through M3-T07. We commit the skeleton with placeholder routes:

- [ ] **Step 9: Add placeholder routes**

Create the following four files, each containing a minimal stub component:

`packages/ui/src/routes/dashboard.tsx`:

```tsx
export function Dashboard() {
  return <div class="card">Dashboard</div>;
}
```

`packages/ui/src/routes/drives.tsx`:

```tsx
export function Drives() {
  return <div class="card">Drives</div>;
}
```

`packages/ui/src/routes/scans.tsx`:

```tsx
export function Scans() {
  return <div class="card">Scans</div>;
}
```

`packages/ui/src/routes/browse.tsx`:

```tsx
export function Browse() {
  return <div class="card">Browse</div>;
}
```

`packages/ui/src/components/sidebar.tsx`:

```tsx
export function Sidebar() {
  return (
    <aside class="sidebar">
      <h2>FileOrganizer</h2>
      <nav>
        <a href="/">Dashboard</a>
        <a href="/drives">Drives</a>
        <a href="/scans">Scans</a>
        <a href="/browse">Browse</a>
      </nav>
    </aside>
  );
}
```

- [ ] **Step 10: Verify typecheck**

```
npm run typecheck --workspace=@fileorganizer/ui
```

Expected: PASS.

- [ ] **Step 11: Commit**

```
git add packages/ui/
git commit -m "feat(ui): scaffold preact + vite app with placeholder routes

Task: M3-T03"
```

### M3-T04: API client and Drives screen

**Files:**
- Create: `packages/ui/src/api/client.ts`
- Create: `packages/ui/src/api/client.test.ts`
- Modify: `packages/ui/src/routes/drives.tsx`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/api/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from './client.js';

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('listDrives calls /api/drives and returns drives array', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ drives: [{ id: '1', label: 'X' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ baseUrl: 'http://localhost:1234' });
    const result = await client.listDrives();
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:1234/api/drives',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws on non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'oops' }),
    );
    const client = new ApiClient({ baseUrl: 'http://localhost:1234' });
    await expect(client.listDrives()).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Implement `packages/ui/src/api/client.ts`**

```ts
import type { DriveRecord } from '@fileorganizer/shared';

export interface ApiClientOptions {
  baseUrl: string;
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  async listDrives(): Promise<DriveRecord[]> {
    const data = await this.get<{ drives: DriveRecord[] }>('/api/drives');
    return data.drives;
  }

  async listFiles(driveId: string, limit = 100, offset = 0): Promise<unknown[]> {
    const data = await this.get<{ files: unknown[] }>(
      `/api/files?driveId=${encodeURIComponent(driveId)}&limit=${limit}&offset=${offset}`,
    );
    return data.files;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${path} failed: ${res.status} ${body}`);
    }
    return (await res.json()) as T;
  }
}

export function defaultApiClient(): ApiClient {
  // In production builds, the engine serves the UI from the same origin,
  // so a relative baseUrl works. In dev, vite proxies /api to the engine.
  return new ApiClient({ baseUrl: '' });
}
```

- [ ] **Step 3: Configure vitest for jsdom in UI workspace**

Append to `packages/ui/package.json` `vitest`-relevant configuration by creating `packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
```

- [ ] **Step 4: Run tests**

```
npm test --workspace=@fileorganizer/ui
```

Expected: PASS.

- [ ] **Step 5: Replace `packages/ui/src/routes/drives.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord } from '@fileorganizer/shared';

export function Drives() {
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    defaultApiClient()
      .listDrives()
      .then(setDrives)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div class="card">Error: {error}</div>;
  if (drives.length === 0) return <div class="card">No drives registered yet.</div>;

  return (
    <div>
      <h1>Drives</h1>
      <table>
        <thead>
          <tr><th>Label</th><th>Letter</th><th>Kind</th><th>Capacity</th><th>Roles</th></tr>
        </thead>
        <tbody>
          {drives.map((d) => (
            <tr key={d.id}>
              <td>{d.label}</td>
              <td>{d.currentLetter ?? '-'}</td>
              <td>{d.kind}</td>
              <td>{formatBytes(d.freeBytes)} / {formatBytes(d.totalBytes)}</td>
              <td>{d.roles.join(', ') || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${u[i]}`;
}
```

- [ ] **Step 6: Run typecheck**

```
npm run typecheck --workspace=@fileorganizer/ui
```

- [ ] **Step 7: Commit**

```
git add packages/ui/src/api/ packages/ui/src/routes/drives.tsx packages/ui/vitest.config.ts
git commit -m "feat(ui): add api client and Drives screen with live data

Task: M3-T04"
```

### M3-T05: Scans screen with start-scan form

**Files:**
- Modify: `packages/engine/src/api/server.ts`
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/ui/src/routes/scans.tsx`

- [ ] **Step 1: Add `POST /api/scans` to the engine API**

In `packages/engine/src/api/server.ts`, before the `return new Promise...`, add:

```ts
app.post('/api/scans', async (c) => {
  const body = (await c.req.json()) as {
    driveId: string;
    rootPaths: string[];
    profile?: 'idle' | 'balanced' | 'full-send';
  };
  // M3 starts scans synchronously and returns the scan record.
  // M3-T07 wires this into a real background runner.
  const drive = drives.list().find((d) => d.id === body.driveId);
  if (!drive) return c.json({ error: 'drive-not-found' }, 404);
  const scan = scans.start({
    driveId: body.driveId,
    rootPaths: body.rootPaths,
    throttleProfile: body.profile ?? 'balanced',
  });
  return c.json({ scan }, 201);
});

app.get('/api/scans', (c) => {
  const driveId = c.req.query('driveId');
  let rows;
  if (driveId) {
    rows = opts.db
      .prepare(`SELECT * FROM scans WHERE drive_id = ? ORDER BY started_at DESC LIMIT 100`)
      .all(driveId);
  } else {
    rows = opts.db.prepare(`SELECT * FROM scans ORDER BY started_at DESC LIMIT 100`).all();
  }
  return c.json({ scans: rows });
});
```

- [ ] **Step 2: Extend `ApiClient`**

Add to `packages/ui/src/api/client.ts` inside the `ApiClient` class:

```ts
async listScans(driveId?: string): Promise<unknown[]> {
  const q = driveId ? `?driveId=${encodeURIComponent(driveId)}` : '';
  const data = await this.get<{ scans: unknown[] }>(`/api/scans${q}`);
  return data.scans;
}

async startScan(input: { driveId: string; rootPaths: string[]; profile?: string }): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/scans`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API /api/scans failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { scan: unknown };
  return data.scan;
}
```

- [ ] **Step 3: Implement `packages/ui/src/routes/scans.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord, ScanRecord } from '@fileorganizer/shared';

export function Scans() {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [driveId, setDriveId] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [profile, setProfile] = useState<'idle' | 'balanced' | 'full-send'>('balanced');
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    Promise.all([api.listDrives(), api.listScans()])
      .then(([d, s]) => {
        setDrives(d);
        setScans(s as ScanRecord[]);
        if (!driveId && d.length > 0) setDriveId(d[0]!.id);
      })
      .catch((e) => setError((e as Error).message));
  };

  useEffect(reload, []);

  const onStart = async () => {
    setError(null);
    try {
      await api.startScan({ driveId, rootPaths: [rootPath], profile });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <h1>Scans</h1>
      <div class="card">
        <h2>Start scan</h2>
        {drives.length === 0 ? (
          <p class="muted">No drives registered. Run a scan from the CLI first.</p>
        ) : (
          <>
            <label>Drive: </label>
            <select value={driveId} onChange={(e) => setDriveId((e.target as HTMLSelectElement).value)}>
              {drives.map((d) => <option value={d.id}>{d.label}</option>)}
            </select>
            <label> Root path: </label>
            <input value={rootPath} onInput={(e) => setRootPath((e.target as HTMLInputElement).value)} />
            <label> Profile: </label>
            <select value={profile} onChange={(e) => setProfile((e.target as HTMLSelectElement).value as typeof profile)}>
              <option value="idle">idle</option>
              <option value="balanced">balanced</option>
              <option value="full-send">full-send</option>
            </select>
            <button onClick={onStart}>Start scan</button>
          </>
        )}
        {error ? <p style="color:var(--danger)">{error}</p> : null}
      </div>
      <div class="card">
        <h2>Recent scans</h2>
        {scans.length === 0 ? <p class="muted">No scans yet.</p> : (
          <table>
            <thead>
              <tr><th>Started</th><th>Drive</th><th>Status</th><th>Files</th></tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id}>
                  <td>{s.startedAt}</td>
                  <td>{s.driveId.slice(0, 8)}…</td>
                  <td>{s.status}</td>
                  <td>{s.progress?.filesIndexed ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

> **Note:** the start-scan form in M3 only inserts a `scans` row — it does not run the scan. M3-T07 wires it to actually run.

- [ ] **Step 4: Run tests**

```
npm test
```

Expected: PASS for all workspaces.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/api/server.ts packages/ui/src/api/client.ts packages/ui/src/routes/scans.tsx
git commit -m "feat(api+ui): add scans listing and start endpoint with form

Task: M3-T05"
```

### M3-T06: Browse screen

**Files:**
- Modify: `packages/ui/src/routes/browse.tsx`

- [ ] **Step 1: Implement `packages/ui/src/routes/browse.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord } from '@fileorganizer/shared';

interface FileRow {
  id: number;
  driveId: string;
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  category: string;
  sha256: string;
  mtime: string;
  exifDate: string | null;
  state: string;
}

export function Browse() {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [driveId, setDriveId] = useState('');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [offset, setOffset] = useState(0);
  const limit = 100;

  useEffect(() => {
    api.listDrives().then((d) => {
      setDrives(d);
      if (d.length > 0) setDriveId(d[0]!.id);
    });
  }, []);

  useEffect(() => {
    if (!driveId) return;
    api.listFiles(driveId, limit, offset).then((rows) => setFiles(rows as FileRow[]));
  }, [driveId, offset]);

  return (
    <div>
      <h1>Browse</h1>
      <div class="card">
        <label>Drive: </label>
        <select value={driveId} onChange={(e) => { setOffset(0); setDriveId((e.target as HTMLSelectElement).value); }}>
          {drives.map((d) => <option value={d.id}>{d.label}</option>)}
        </select>
        <button class="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</button>
        <button class="secondary" disabled={files.length < limit} onClick={() => setOffset(offset + limit)}>Next</button>
        <span class="muted"> rows {offset + 1}–{offset + files.length}</span>
      </div>
      <div class="card">
        <table>
          <thead>
            <tr><th>Path</th><th>Cat</th><th>Size</th><th>Date</th><th>SHA-256</th><th>State</th></tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>{f.path}</td>
                <td>{f.category}</td>
                <td>{formatBytes(f.sizeBytes)}</td>
                <td>{f.exifDate ?? f.mtime}</td>
                <td title={f.sha256}>{f.sha256.slice(0, 8)}…</td>
                <td>{f.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${u[i]}`;
}
```

- [ ] **Step 2: Run typecheck**

```
npm run typecheck --workspace=@fileorganizer/ui
```

- [ ] **Step 3: Commit**

```
git add packages/ui/src/routes/browse.tsx
git commit -m "feat(ui): add Browse screen with paginated file list

Task: M3-T06"
```

### M3-T07: Wire scan-start API to actually run a scan

**Files:**
- Modify: `packages/engine/src/api/server.ts`
- Modify: `packages/engine/src/api/server.test.ts`

The M3-T05 endpoint creates a scans row but doesn't actually run the scan. Replace it with one that spawns `runScan` in the background and emits progress events on the EventBus.

- [ ] **Step 1: Update `packages/engine/src/api/server.ts`**

Replace the `app.post('/api/scans', ...)` block with:

```ts
app.post('/api/scans', async (c) => {
  const body = (await c.req.json()) as {
    driveId: string;
    rootPaths: string[];
    profile?: 'idle' | 'balanced' | 'full-send';
    mediainfoPath?: string;
  };
  const drive = drives.list().find((d) => d.id === body.driveId);
  if (!drive) return c.json({ error: 'drive-not-found' }, 404);
  const settings = new SettingsRepo(opts.db).load();
  const throttle = new ThrottleManager(
    settings.throttleProfiles,
    body.profile ?? 'balanced',
    settings.throttleSchedule,
  );
  const log = createLogger({ level: 'info', write: defaultWriter });
  const mediainfoPath = body.mediainfoPath ?? '';
  // Run in the background; emit progress events.
  const promise = runScan({
    db: opts.db,
    driveId: drive.id,
    roots: body.rootPaths,
    categoryMap: settings.categoryMap,
    throttle,
    log,
    mediainfoPath,
  });
  promise
    .then((r) => {
      events.publish({
        type: 'scan-progress',
        scanId: r.scanId,
        filesIndexed: r.filesIndexed,
        filesUnchanged: r.filesUnchanged,
        filesSkipped: r.filesSkipped,
        bytesProcessed: 0,
      });
    })
    .catch((err) => log.error('background-scan-failed', { err: (err as Error).message }));
  // Wait briefly to capture the scan id (the scan creates a row immediately).
  await new Promise((r) => setTimeout(r, 50));
  const recent = scans.findById(
    (opts.db
      .prepare(`SELECT id FROM scans WHERE drive_id = ? ORDER BY started_at DESC LIMIT 1`)
      .get(drive.id) as { id: string }).id,
  );
  return c.json({ scan: recent }, 201);
});
```

…and add the imports at the top of the file:

```ts
import { SettingsRepo } from '../catalog/settings-repo.js';
import { ThrottleManager } from '../throttle/manager.js';
import { runScan } from '../scan/orchestrator.js';
import { createLogger, defaultWriter } from '../log.js';
```

- [ ] **Step 2: Update the API test**

Add to `packages/engine/src/api/server.test.ts` an integration test that:

1. Creates a temp directory with `a.jpg`.
2. Posts `/api/scans` for the registered drive.
3. Polls `/api/scans/:id` until status is `completed`.

```ts
it('starts a scan via POST /api/scans and reaches completion', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'a.jpg'), 'aaa');
  // Register drive directly via repo to keep the test focused on the API.
  const { DriveRepo } = await import('../drives/repo.js');
  const drive = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  });
  const post = await fetch(`http://127.0.0.1:${handle.port}/api/scans`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ driveId: drive.id, rootPaths: [dataDir], profile: 'idle' }),
  });
  expect(post.status).toBe(201);
  const { scan } = (await post.json()) as { scan: { id: string } };
  // Poll until completed.
  for (let i = 0; i < 50; i += 1) {
    const got = await fetch(`http://127.0.0.1:${handle.port}/api/scans/${scan.id}`);
    const body = (await got.json()) as { scan: { status: string } };
    if (body.scan.status === 'completed') return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('scan did not complete in time');
});
```

- [ ] **Step 3: Run tests**

```
npm test --workspace=@fileorganizer/engine
```

Expected: PASS.

- [ ] **Step 4: Commit**

```
git add packages/engine/src/api/server.ts packages/engine/src/api/server.test.ts
git commit -m "feat(engine/api): run scans in background from POST /api/scans

Task: M3-T07"
```

### M3-T08: Dashboard with drive cards

**Files:**
- Modify: `packages/ui/src/routes/dashboard.tsx`

- [ ] **Step 1: Implement Dashboard**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord } from '@fileorganizer/shared';

export function Dashboard() {
  const api = defaultApiClient();
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listDrives().then(setDrives).catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {error ? <div class="card">Error: {error}</div> : null}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        {drives.map((d) => {
          const usedPct = d.totalBytes > 0 ? Math.round(((d.totalBytes - d.freeBytes) / d.totalBytes) * 100) : 0;
          return (
            <div class="card" key={d.id}>
              <h3>{d.label}</h3>
              <div class="muted">{d.currentLetter ?? '—'} · {d.kind}</div>
              <div style="margin-top:8px" class="fill-bar"><div style={`width:${usedPct}%`}></div></div>
              <div class="muted" style="margin-top:4px">{usedPct}% used · {formatBytes(d.freeBytes)} free</div>
              <div class="muted" style="margin-top:8px">Roles: {d.roles.join(', ') || '—'}</div>
            </div>
          );
        })}
      </div>
      {drives.length === 0 ? <div class="card muted">No drives yet. Run a scan from the CLI or Scans page.</div> : null}
    </div>
  );
}

function formatBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${u[i]}`;
}
```

- [ ] **Step 2: Run typecheck**

- [ ] **Step 3: Commit**

```
git add packages/ui/src/routes/dashboard.tsx
git commit -m "feat(ui): add Dashboard with drive cards

Task: M3-T08"
```

### M3-T09: Engine serves built UI from `/`

**Files:**
- Modify: `packages/engine/src/api/server.ts`

The engine's HTTP server should serve the UI's `dist/` output at `/` so users only need to start the engine to use the tool. In dev, the user runs the UI dev server separately; in production, the UI is served by the engine.

- [ ] **Step 1: Add static serving for `packages/ui/dist`**

In `packages/engine/src/api/server.ts`, near the top:

```ts
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
```

…and inside `createServer`, before the `return new Promise(...)`:

```ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDist = join(__dirname, '..', '..', '..', 'ui', 'dist');
if (existsSync(uiDist)) {
  app.get('*', serveStatic({ root: uiDist }));
}
```

- [ ] **Step 2: Build the UI to verify static serving works**

```
npm run build --workspace=@fileorganizer/ui
```

Expected: produces `packages/ui/dist/index.html`.

- [ ] **Step 3: Smoke test**

```
npx tsx packages/engine/src/cli/index.ts init --pointer /tmp/m3-ptr.json --catalog /tmp/m3-cat.db
npx tsx packages/engine/src/cli/index.ts serve --pointer /tmp/m3-ptr.json --port 0 &
SERVE_PID=$!
sleep 1
PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/m3-ptr.json')).uiPort)")
curl -s "http://127.0.0.1:$PORT/" | grep -o '<title>[^<]*</title>'
kill $SERVE_PID
```

Expected: prints `<title>FileOrganizer</title>`.

- [ ] **Step 4: Commit**

```
git add packages/engine/src/api/server.ts
git commit -m "feat(engine/api): serve built UI assets from the engine

Task: M3-T09"
```

### M3-T10: Milestone gate for M3

- [ ] **Step 1: Run all tests**

```
npm test
```

- [ ] **Step 2: Build everything**

```
npm run build
```

- [ ] **Step 3: Manual smoke test of the full flow**

Build, init, scan, serve, then open the printed URL in a browser and verify Dashboard + Drives + Scans + Browse all render.


---

## Section M4 — Duplicates

**Goal:** Detect byte-identical duplicate files, score keepers, propose dedup batches, apply approved batches by moving non-keepers to a quarantine folder, and expose Duplicates + Quarantine UI screens.

**Branch:**

- [ ] **Step setup-1:** `git checkout -b m4-duplicates`

### M4-T01: Batches and operations repository

**Files:**
- Create: `packages/engine/src/catalog/batches-repo.ts`
- Create: `packages/engine/src/catalog/batches-repo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/catalog/batches-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { BatchesRepo } from './batches-repo.js';

let dir: string;
let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-batches-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('BatchesRepo', () => {
  it('starts a batch and assigns a uuid', () => {
    const repo = new BatchesRepo(db);
    const b = repo.start({ kind: 'dedupe', description: 'test' });
    expect(b.id).toBeTruthy();
    expect(b.kind).toBe('dedupe');
    expect(b.status).toBe('in-progress');
  });

  it('records operations under a batch', () => {
    const repo = new BatchesRepo(db);
    const b = repo.start({ kind: 'dedupe', description: 't' });
    const op = repo.recordOperation(b.id, {
      kind: 'quarantine',
      sourceDriveId: 'd1',
      sourcePath: '/x/y.jpg',
      preHash: 'h',
      status: 'pending',
    });
    expect(op.id).toBeGreaterThan(0);
    repo.updateOperationStatus(op.id, 'completed', { quarantinePath: '/q/y.jpg' });
    const ops = repo.listOperations(b.id);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('completed');
    expect(ops[0]!.quarantinePath).toBe('/q/y.jpg');
  });

  it('finishes a batch and lists most-recent first', () => {
    const repo = new BatchesRepo(db);
    const b1 = repo.start({ kind: 'dedupe', description: 'a' });
    repo.finish(b1.id, 'completed', {});
    const b2 = repo.start({ kind: 'move', description: 'b' });
    repo.finish(b2.id, 'completed', {});
    const list = repo.list({ limit: 10 });
    expect(list[0]!.id).toBe(b2.id);
    expect(list[1]!.id).toBe(b1.id);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/catalog/batches-repo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Catalog } from './connection.js';
import type {
  BatchKind,
  BatchRecord,
  OperationKind,
  OperationRecord,
  OperationStatus,
} from '@fileorganizer/shared';

export interface StartBatchInput {
  kind: BatchKind;
  description: string;
}

export interface RecordOperationInput {
  kind: OperationKind;
  fileId?: number | null;
  sourceDriveId?: string | null;
  sourcePath?: string | null;
  destDriveId?: string | null;
  destPath?: string | null;
  preHash?: string | null;
  postHash?: string | null;
  quarantinePath?: string | null;
  status: OperationStatus;
}

export class BatchesRepo {
  constructor(private readonly db: Catalog) {}

  start(input: StartBatchInput): BatchRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO batches (id, kind, started_at, status, description, summary)
         VALUES (?, ?, ?, 'in-progress', ?, '{}')`,
      )
      .run(id, input.kind, now, input.description);
    return this.findById(id)!;
  }

  finish(id: string, status: OperationStatus, summary: Record<string, unknown>): void {
    this.db
      .prepare(`UPDATE batches SET status = ?, finished_at = ?, summary = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), JSON.stringify(summary), id);
  }

  recordOperation(batchId: string, op: RecordOperationInput): OperationRecord {
    const result = this.db
      .prepare(
        `INSERT INTO operations (batch_id, kind, file_id, source_drive_id, source_path,
         dest_drive_id, dest_path, pre_hash, post_hash, quarantine_path, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        batchId,
        op.kind,
        op.fileId ?? null,
        op.sourceDriveId ?? null,
        op.sourcePath ?? null,
        op.destDriveId ?? null,
        op.destPath ?? null,
        op.preHash ?? null,
        op.postHash ?? null,
        op.quarantinePath ?? null,
        op.status,
        null,
      );
    return this.findOperation(Number(result.lastInsertRowid))!;
  }

  updateOperationStatus(
    operationId: number,
    status: OperationStatus,
    fields: { postHash?: string; quarantinePath?: string; errorMessage?: string } = {},
  ): void {
    const sets: string[] = ['status = ?'];
    const values: unknown[] = [status];
    if (fields.postHash !== undefined) {
      sets.push('post_hash = ?');
      values.push(fields.postHash);
    }
    if (fields.quarantinePath !== undefined) {
      sets.push('quarantine_path = ?');
      values.push(fields.quarantinePath);
    }
    if (fields.errorMessage !== undefined) {
      sets.push('error_message = ?');
      values.push(fields.errorMessage);
    }
    values.push(operationId);
    this.db.prepare(`UPDATE operations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  listOperations(batchId: string): OperationRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM operations WHERE batch_id = ? ORDER BY id`)
      .all(batchId) as Record<string, unknown>[];
    return rows.map(opRow);
  }

  findById(id: string): BatchRecord | null {
    const row = this.db.prepare(`SELECT * FROM batches WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? batchRow(row) : null;
  }

  findOperation(id: number): OperationRecord | null {
    const row = this.db.prepare(`SELECT * FROM operations WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? opRow(row) : null;
  }

  list(opts: { limit?: number } = {}): BatchRecord[] {
    const limit = opts.limit ?? 100;
    const rows = this.db
      .prepare(`SELECT * FROM batches ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(batchRow);
  }
}

function batchRow(row: Record<string, unknown>): BatchRecord {
  return {
    id: row['id'] as string,
    kind: row['kind'] as BatchKind,
    startedAt: row['started_at'] as string,
    finishedAt: (row['finished_at'] as string | null) ?? null,
    status: row['status'] as OperationStatus,
    description: (row['description'] as string) ?? '',
    summary: JSON.parse((row['summary'] as string) || '{}'),
  };
}

function opRow(row: Record<string, unknown>): OperationRecord {
  return {
    id: row['id'] as number,
    batchId: row['batch_id'] as string,
    kind: row['kind'] as OperationKind,
    fileId: (row['file_id'] as number | null) ?? null,
    sourceDriveId: (row['source_drive_id'] as string | null) ?? null,
    sourcePath: (row['source_path'] as string | null) ?? null,
    destDriveId: (row['dest_drive_id'] as string | null) ?? null,
    destPath: (row['dest_path'] as string | null) ?? null,
    preHash: (row['pre_hash'] as string | null) ?? null,
    postHash: (row['post_hash'] as string | null) ?? null,
    quarantinePath: (row['quarantine_path'] as string | null) ?? null,
    status: row['status'] as OperationStatus,
    errorMessage: (row['error_message'] as string | null) ?? null,
  };
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```
git add packages/engine/src/catalog/batches-repo.ts packages/engine/src/catalog/batches-repo.test.ts
git commit -m "feat(engine/catalog): add batches and operations repository

Task: M4-T01"
```

### M4-T02: Quarantine module

**Files:**
- Create: `packages/engine/src/quarantine/quarantine.ts`
- Create: `packages/engine/src/quarantine/quarantine.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/quarantine/quarantine.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { quarantineFile, restoreFromQuarantine } from './quarantine.js';

let dir: string;
let db: Catalog;
let driveId: string;
let driveRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-q-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  driveRoot = join(dir, 'drive');
  mkdirSync(driveRoot, { recursive: true });
  const drive = new DriveRepo(db).upsert({
    volumeSerial: 'X',
    label: 'X',
    currentLetter: null,
    kind: 'local',
    roles: [],
    totalBytes: 1,
    freeBytes: 1,
  });
  driveId = drive.id;
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

describe('quarantineFile', () => {
  it('moves file into _FileOrganizer_quarantine and records metadata', () => {
    const src = join(driveRoot, 'sub', 'a.jpg');
    mkdirSync(join(src, '..'), { recursive: true });
    writeFileSync(src, 'x');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'dedupe', description: 't' });
    const result = quarantineFile({
      db, batchId: batch.id, driveId, driveRoot,
      sourcePath: src, sha256: 'hashx', sizeBytes: 1, mtime: '2024-01-01T00:00:00.000Z',
    });
    expect(existsSync(src)).toBe(false);
    expect(existsSync(result.quarantinePath)).toBe(true);
    expect(result.quarantinePath).toContain('_FileOrganizer_quarantine');
    expect(result.quarantinePath).toContain(batch.id);
  });

  it('restoreFromQuarantine puts the file back', () => {
    const src = join(driveRoot, 'sub', 'a.jpg');
    mkdirSync(join(src, '..'), { recursive: true });
    writeFileSync(src, 'x');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'dedupe', description: 't' });
    const result = quarantineFile({
      db, batchId: batch.id, driveId, driveRoot,
      sourcePath: src, sha256: 'hashx', sizeBytes: 1, mtime: '2024-01-01T00:00:00.000Z',
    });
    restoreFromQuarantine({ db, driveRoot, quarantineId: result.quarantineId });
    expect(existsSync(src)).toBe(true);
    expect(existsSync(result.quarantinePath)).toBe(false);
    expect(readFileSync(src, 'utf-8')).toBe('x');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/quarantine/quarantine.ts`**

```ts
import { renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Catalog } from '../catalog/connection.js';
import { QuarantineError } from '@fileorganizer/shared';

export interface QuarantineFileInput {
  db: Catalog;
  batchId: string;
  driveId: string;
  driveRoot: string;
  sourcePath: string;
  sha256: string;
  sizeBytes: number;
  mtime: string;
}

export interface QuarantineResult {
  quarantineId: number;
  quarantinePath: string;
}

const QUARANTINE_DIR = '_FileOrganizer_quarantine';

export function quarantineFile(input: QuarantineFileInput): QuarantineResult {
  const rel = relative(input.driveRoot, input.sourcePath);
  if (rel.startsWith('..')) {
    throw new QuarantineError(
      'QUARANTINE_BAD_PATH',
      `source path ${input.sourcePath} is not under drive root ${input.driveRoot}`,
    );
  }
  const dest = join(input.driveRoot, QUARANTINE_DIR, input.batchId, rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    throw new QuarantineError(
      'QUARANTINE_COLLISION',
      `quarantine destination already exists: ${dest}`,
    );
  }
  renameSync(input.sourcePath, dest);
  const result = input.db
    .prepare(
      `INSERT INTO quarantine (drive_id, original_path, original_size, original_sha256,
       original_mtime, quarantine_path, quarantined_at, batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.driveId,
      input.sourcePath,
      input.sizeBytes,
      input.sha256,
      input.mtime,
      dest,
      new Date().toISOString(),
      input.batchId,
    );
  return { quarantineId: Number(result.lastInsertRowid), quarantinePath: dest };
}

export function restoreFromQuarantine(input: {
  db: Catalog;
  driveRoot: string;
  quarantineId: number;
}): void {
  const row = input.db
    .prepare(`SELECT * FROM quarantine WHERE id = ?`)
    .get(input.quarantineId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new QuarantineError('QUARANTINE_NOT_FOUND', `quarantine record ${input.quarantineId} not found`);
  }
  const src = row['quarantine_path'] as string;
  const dest = row['original_path'] as string;
  if (!existsSync(src)) {
    throw new QuarantineError('QUARANTINE_FILE_MISSING', `${src} not present`);
  }
  if (existsSync(dest)) {
    throw new QuarantineError(
      'RESTORE_COLLISION',
      `cannot restore to ${dest}: file exists at original path`,
    );
  }
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);
  input.db.prepare(`DELETE FROM quarantine WHERE id = ?`).run(input.quarantineId);
}

export function quarantineRoot(driveRoot: string): string {
  return join(driveRoot, QUARANTINE_DIR);
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/quarantine/
git commit -m "feat(engine/quarantine): add quarantine + restore primitives

Task: M4-T02"
```

### M4-T03: Duplicate detection query

**Files:**
- Create: `packages/engine/src/dedupe/detect.ts`
- Create: `packages/engine/src/dedupe/detect.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/dedupe/detect.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo, type UpsertFileInput } from '../catalog/files-repo.js';
import { detectDuplicates } from './detect.js';

let dir: string;
let db: Catalog;
let driveId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-dedup-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  driveId = new DriveRepo(db).upsert({
    volumeSerial: 'X', label: 'X', currentLetter: null, kind: 'local',
    roles: [], totalBytes: 1, freeBytes: 1,
  }).id;
  db.prepare(
    `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
  ).run('s1', driveId, new Date().toISOString(), 'completed', 'balanced');
});

afterEach(() => {
  closeCatalog(db);
  rmSync(dir, { recursive: true, force: true });
});

function f(path: string, sha: string, size = 100): UpsertFileInput {
  return {
    driveId, path, name: path.split('/').pop()!, extension: 'jpg', sizeBytes: size,
    category: 'image', sha256: sha, mtime: '2024-01-01T00:00:00.000Z',
    ctime: '2024-01-01T00:00:00.000Z', exifDate: null, dateSource: 'mtime',
    width: null, height: null, durationSeconds: null, ntfsFileId: null,
    state: 'indexed', scanId: 's1',
  };
}

describe('detectDuplicates', () => {
  it('returns groups of files sharing a hash', () => {
    const files = new FilesRepo(db);
    files.upsertOne(f('/a.jpg', 'h1'));
    files.upsertOne(f('/b.jpg', 'h1'));
    files.upsertOne(f('/c.jpg', 'h2'));
    files.upsertOne(f('/d.jpg', 'h3'));
    files.upsertOne(f('/e.jpg', 'h3'));
    files.upsertOne(f('/f.jpg', 'h3'));
    const groups = detectDuplicates(db, { minSizeBytes: 0 });
    expect(groups).toHaveLength(2);
    expect(groups[0]!.copies.length).toBe(3);
    expect(groups[1]!.copies.length).toBe(2);
  });

  it('orders groups by reclaimable bytes descending', () => {
    const files = new FilesRepo(db);
    files.upsertOne(f('/a.jpg', 'small1', 10));
    files.upsertOne(f('/b.jpg', 'small1', 10));
    files.upsertOne(f('/c.jpg', 'big1', 1_000_000));
    files.upsertOne(f('/d.jpg', 'big1', 1_000_000));
    const groups = detectDuplicates(db, { minSizeBytes: 0 });
    expect(groups[0]!.sha256).toBe('big1');
  });

  it('skips groups below minSizeBytes', () => {
    const files = new FilesRepo(db);
    files.upsertOne(f('/a.jpg', 'h1', 100));
    files.upsertOne(f('/b.jpg', 'h1', 100));
    expect(detectDuplicates(db, { minSizeBytes: 200 })).toHaveLength(0);
    expect(detectDuplicates(db, { minSizeBytes: 50 })).toHaveLength(1);
  });

  it('excludes zero-byte and missing files', () => {
    const files = new FilesRepo(db);
    files.upsertOne(f('/a.jpg', 'h1', 0));
    files.upsertOne(f('/b.jpg', 'h1', 0));
    expect(detectDuplicates(db, { minSizeBytes: 0 })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/dedupe/detect.ts`**

```ts
import type { Catalog } from '../catalog/connection.js';
import type { Category, FileState } from '@fileorganizer/shared';

export interface DuplicateCopy {
  fileId: number;
  driveId: string;
  path: string;
  sizeBytes: number;
  category: Category;
  state: FileState;
  mtime: string;
}

export interface DuplicateGroup {
  sha256: string;
  copies: DuplicateCopy[];
  fileSizeBytes: number;
  reclaimableBytes: number;
}

export interface DetectOptions {
  minSizeBytes: number;
}

export function detectDuplicates(db: Catalog, opts: DetectOptions): DuplicateGroup[] {
  const minSize = Math.max(opts.minSizeBytes, 1);
  const hashes = db
    .prepare(
      `SELECT sha256, COUNT(*) AS copies, MIN(size_bytes) AS size
       FROM files
       WHERE state = 'indexed' AND size_bytes >= ?
       GROUP BY sha256
       HAVING copies > 1
       ORDER BY (copies - 1) * MIN(size_bytes) DESC`,
    )
    .all(minSize) as { sha256: string; copies: number; size: number }[];
  return hashes.map((row) => {
    const copies = db
      .prepare(
        `SELECT id AS fileId, drive_id AS driveId, path, size_bytes AS sizeBytes,
                category, state, mtime FROM files WHERE sha256 = ? AND state = 'indexed'`,
      )
      .all(row.sha256) as DuplicateCopy[];
    return {
      sha256: row.sha256,
      copies,
      fileSizeBytes: row.size,
      reclaimableBytes: (copies.length - 1) * row.size,
    };
  });
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/dedupe/detect.ts packages/engine/src/dedupe/detect.test.ts
git commit -m "feat(engine/dedupe): add duplicate group detection query

Task: M4-T03"
```

### M4-T04: Keeper scoring

**Files:**
- Create: `packages/engine/src/dedupe/scorer.ts`
- Create: `packages/engine/src/dedupe/scorer.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/dedupe/scorer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreCopies } from './scorer.js';
import type { DuplicateCopy } from './detect.js';

function copy(o: Partial<DuplicateCopy>): DuplicateCopy {
  return {
    fileId: 1, driveId: 'd1', path: '/a.jpg', sizeBytes: 100, category: 'image',
    state: 'indexed', mtime: '2024-01-01T00:00:00.000Z', ...o,
  };
}

describe('scoreCopies', () => {
  it('prefers a copy on a drive carrying the rule role', () => {
    const copies = [
      copy({ fileId: 1, driveId: 'da', path: '/a.jpg' }),
      copy({ fileId: 2, driveId: 'db', path: '/b.jpg' }),
    ];
    const drives = new Map([
      ['da', { kind: 'local', roles: [] }],
      ['db', { kind: 'local', roles: ['media-archive'] }],
    ]);
    const result = scoreCopies(copies, { drives, ruleRole: 'media-archive', destinationTemplates: [] });
    expect(result.keeperFileId).toBe(2);
    expect(result.reasons[0]).toContain('role');
  });

  it('falls through to path depth when role and template are tied', () => {
    const copies = [
      copy({ fileId: 1, path: '/a.jpg' }),
      copy({ fileId: 2, path: '/Photos/2023/08/a.jpg' }),
    ];
    const drives = new Map([['d1', { kind: 'local', roles: [] }]]);
    const result = scoreCopies(copies.map((c) => ({ ...c, driveId: 'd1' })), {
      drives, ruleRole: null, destinationTemplates: [],
    });
    expect(result.keeperFileId).toBe(2);
  });

  it('breaks ties by older mtime', () => {
    const copies = [
      copy({ fileId: 1, path: '/a.jpg', mtime: '2024-06-01T00:00:00.000Z' }),
      copy({ fileId: 2, path: '/a.jpg', mtime: '2024-01-01T00:00:00.000Z' }),
    ];
    const drives = new Map([['d1', { kind: 'local', roles: [] }]]);
    const result = scoreCopies(copies.map((c) => ({ ...c, driveId: 'd1' })), {
      drives, ruleRole: null, destinationTemplates: [],
    });
    expect(result.keeperFileId).toBe(2);
  });

  it('uses lexicographic path order as final tiebreaker', () => {
    const copies = [
      copy({ fileId: 1, path: '/zzz.jpg' }),
      copy({ fileId: 2, path: '/aaa.jpg' }),
    ];
    const drives = new Map([['d1', { kind: 'local', roles: [] }]]);
    const result = scoreCopies(copies.map((c) => ({ ...c, driveId: 'd1' })), {
      drives, ruleRole: null, destinationTemplates: [],
    });
    expect(result.keeperFileId).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/dedupe/scorer.ts`**

```ts
import type { DriveKind } from '@fileorganizer/shared';
import type { DuplicateCopy } from './detect.js';

export interface DriveContext {
  kind: DriveKind;
  roles: string[];
}

export interface ScoreOptions {
  drives: Map<string, DriveContext>;
  ruleRole: string | null;
  destinationTemplates: string[];
}

export interface ScoreResult {
  keeperFileId: number;
  reasons: string[];
}

const DRIVE_KIND_SCORE: Record<DriveKind, number> = {
  local: 3,
  external: 1,
  network: 2,
};

export function scoreCopies(copies: DuplicateCopy[], opts: ScoreOptions): ScoreResult {
  if (copies.length === 0) {
    throw new Error('scoreCopies requires at least one copy');
  }
  const reasons: string[] = [];
  const sorted = [...copies].sort((a, b) => {
    const aRole = opts.ruleRole && opts.drives.get(a.driveId)?.roles.includes(opts.ruleRole) ? 1 : 0;
    const bRole = opts.ruleRole && opts.drives.get(b.driveId)?.roles.includes(opts.ruleRole) ? 1 : 0;
    if (aRole !== bRole) return bRole - aRole;
    const aTpl = matchesAnyTemplate(a.path, opts.destinationTemplates) ? 1 : 0;
    const bTpl = matchesAnyTemplate(b.path, opts.destinationTemplates) ? 1 : 0;
    if (aTpl !== bTpl) return bTpl - aTpl;
    const aDepth = pathDepth(a.path);
    const bDepth = pathDepth(b.path);
    if (aDepth !== bDepth) return bDepth - aDepth;
    const aDriveKind = DRIVE_KIND_SCORE[opts.drives.get(a.driveId)?.kind ?? 'local'];
    const bDriveKind = DRIVE_KIND_SCORE[opts.drives.get(b.driveId)?.kind ?? 'local'];
    if (aDriveKind !== bDriveKind) return bDriveKind - aDriveKind;
    if (a.mtime !== b.mtime) return a.mtime < b.mtime ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  const winner = sorted[0]!;
  // Build human-readable reasons by re-running comparisons against the runner-up.
  if (sorted.length > 1) {
    const runnerUp = sorted[1]!;
    if (opts.ruleRole) {
      const wHas = opts.drives.get(winner.driveId)?.roles.includes(opts.ruleRole);
      const rHas = opts.drives.get(runnerUp.driveId)?.roles.includes(opts.ruleRole);
      if (wHas !== rHas) reasons.push(`drive carries role "${opts.ruleRole}"`);
    }
    if (
      matchesAnyTemplate(winner.path, opts.destinationTemplates) !==
      matchesAnyTemplate(runnerUp.path, opts.destinationTemplates)
    ) {
      reasons.push('path matches an organizing rule destination');
    }
    if (pathDepth(winner.path) !== pathDepth(runnerUp.path)) {
      reasons.push(`deeper path (${pathDepth(winner.path)} segments)`);
    }
    const wKind = opts.drives.get(winner.driveId)?.kind;
    const rKind = opts.drives.get(runnerUp.driveId)?.kind;
    if (wKind !== rKind) reasons.push(`drive kind ${wKind} preferred`);
    if (winner.mtime !== runnerUp.mtime) reasons.push(`older mtime (${winner.mtime})`);
    if (reasons.length === 0) reasons.push('lexicographic path tiebreak');
  } else {
    reasons.push('only copy');
  }
  return { keeperFileId: winner.fileId, reasons };
}

function pathDepth(path: string): number {
  return path.split(/[\\/]/).filter(Boolean).length;
}

function matchesAnyTemplate(path: string, templates: string[]): boolean {
  return templates.some((tpl) => path.toLowerCase().includes(tpl.toLowerCase()));
}
```

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/dedupe/scorer.ts packages/engine/src/dedupe/scorer.test.ts
git commit -m "feat(engine/dedupe): add keeper scoring with documented reasons

Task: M4-T04"
```

### M4-T05: Dedupe planner and applier

**Files:**
- Create: `packages/engine/src/dedupe/planner.ts`
- Create: `packages/engine/src/dedupe/planner.test.ts`
- Create: `packages/engine/src/dedupe/applier.ts`
- Create: `packages/engine/src/dedupe/applier.test.ts`

The planner consumes detected groups + scores and produces a list of `DedupeOperation`s describing which copies to quarantine. The applier executes the planner output against the filesystem.

- [ ] **Step 1: Write `packages/engine/src/dedupe/planner.ts`**

```ts
import { detectDuplicates, type DuplicateGroup } from './detect.js';
import { scoreCopies, type DriveContext } from './scorer.js';
import type { Catalog } from '../catalog/connection.js';

export interface DedupeOperation {
  groupSha256: string;
  keeperFileId: number;
  removeFileId: number;
  reasons: string[];
  reclaimableBytes: number;
}

export interface PlanDedupeOptions {
  minSizeBytes: number;
}

export interface DedupePlan {
  operations: DedupeOperation[];
  groups: DuplicateGroup[];
}

export function planDedupe(db: Catalog, opts: PlanDedupeOptions): DedupePlan {
  const groups = detectDuplicates(db, { minSizeBytes: opts.minSizeBytes });
  const driveRows = db
    .prepare(`SELECT id, kind, roles FROM drives`)
    .all() as { id: string; kind: 'local' | 'external' | 'network'; roles: string }[];
  const drives = new Map<string, DriveContext>();
  for (const r of driveRows) {
    drives.set(r.id, { kind: r.kind, roles: JSON.parse(r.roles || '[]') });
  }
  const operations: DedupeOperation[] = [];
  for (const group of groups) {
    const score = scoreCopies(group.copies, { drives, ruleRole: null, destinationTemplates: [] });
    for (const copy of group.copies) {
      if (copy.fileId === score.keeperFileId) continue;
      operations.push({
        groupSha256: group.sha256,
        keeperFileId: score.keeperFileId,
        removeFileId: copy.fileId,
        reasons: score.reasons,
        reclaimableBytes: group.fileSizeBytes,
      });
    }
  }
  return { operations, groups };
}
```

- [ ] **Step 2: Write `packages/engine/src/dedupe/planner.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { planDedupe } from './planner.js';

let dir: string; let db: Catalog; let driveId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-plan-'));
  db = openCatalog(join(dir, 'cat.db')); migrate(db);
  driveId = new DriveRepo(db).upsert({
    volumeSerial: 'X', label: 'X', currentLetter: null, kind: 'local',
    roles: [], totalBytes: 1, freeBytes: 1,
  }).id;
  db.prepare(`INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`)
    .run('s', driveId, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');
});

afterEach(() => { closeCatalog(db); rmSync(dir, { recursive: true, force: true }); });

describe('planDedupe', () => {
  it('produces one removal op per non-keeper copy', () => {
    const repo = new FilesRepo(db);
    for (const p of ['/a.jpg', '/b.jpg', '/c.jpg']) {
      repo.upsertOne({
        driveId, path: p, name: p.slice(1), extension: 'jpg', sizeBytes: 100,
        category: 'image', sha256: 'h', mtime: '2024-01-01T00:00:00.000Z',
        ctime: '2024-01-01T00:00:00.000Z', exifDate: null, dateSource: 'mtime',
        width: null, height: null, durationSeconds: null, ntfsFileId: null,
        state: 'indexed', scanId: 's',
      });
    }
    const plan = planDedupe(db, { minSizeBytes: 1 });
    expect(plan.operations).toHaveLength(2);
    const keeperIds = new Set(plan.operations.map((o) => o.keeperFileId));
    expect(keeperIds.size).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests, PASS**

- [ ] **Step 4: Write `packages/engine/src/dedupe/applier.ts`**

```ts
import { existsSync, statSync } from 'node:fs';
import type { Catalog } from '../catalog/connection.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { quarantineFile } from '../quarantine/quarantine.js';
import { hashFile } from '../scan/hasher.js';
import { IntegrityError } from '@fileorganizer/shared';
import type { DedupeOperation } from './planner.js';

export interface ApplyDedupeInput {
  db: Catalog;
  operations: DedupeOperation[];
  driveRoots: Map<string, string>;
}

export interface ApplyDedupeResult {
  batchId: string;
  completed: number;
  failed: number;
  reclaimedBytes: number;
}

export async function applyDedupe(input: ApplyDedupeInput): Promise<ApplyDedupeResult> {
  const batches = new BatchesRepo(input.db);
  const batch = batches.start({
    kind: 'dedupe',
    description: `dedupe ${input.operations.length} ops`,
  });
  let completed = 0;
  let failed = 0;
  let reclaimedBytes = 0;
  try {
    for (const op of input.operations) {
      const fileRow = input.db
        .prepare(
          `SELECT drive_id AS driveId, path, sha256, size_bytes AS sizeBytes, mtime
           FROM files WHERE id = ?`,
        )
        .get(op.removeFileId) as { driveId: string; path: string; sha256: string; sizeBytes: number; mtime: string } | undefined;
      if (!fileRow) { failed += 1; continue; }
      const driveRoot = input.driveRoots.get(fileRow.driveId);
      if (!driveRoot) { failed += 1; continue; }
      const dbOp = batches.recordOperation(batch.id, {
        kind: 'quarantine',
        fileId: op.removeFileId,
        sourceDriveId: fileRow.driveId,
        sourcePath: fileRow.path,
        preHash: fileRow.sha256,
        status: 'in-progress',
      });
      try {
        if (!existsSync(fileRow.path)) {
          throw new IntegrityError('FILE_MISSING', `${fileRow.path} no longer exists`);
        }
        const liveHash = await hashFile(fileRow.path, { chunkBytes: 1024 * 1024, sleepMs: 0 });
        if (liveHash !== fileRow.sha256) {
          throw new IntegrityError(
            'HASH_MISMATCH',
            `live hash ${liveHash} != catalog hash ${fileRow.sha256} for ${fileRow.path}`,
          );
        }
        const result = quarantineFile({
          db: input.db,
          batchId: batch.id,
          driveId: fileRow.driveId,
          driveRoot,
          sourcePath: fileRow.path,
          sha256: fileRow.sha256,
          sizeBytes: fileRow.sizeBytes,
          mtime: fileRow.mtime,
        });
        input.db
          .prepare(`UPDATE files SET state = 'quarantined' WHERE id = ?`)
          .run(op.removeFileId);
        batches.updateOperationStatus(dbOp.id, 'completed', { quarantinePath: result.quarantinePath });
        completed += 1;
        reclaimedBytes += fileRow.sizeBytes;
      } catch (err) {
        batches.updateOperationStatus(dbOp.id, 'failed', { errorMessage: (err as Error).message });
        failed += 1;
      }
    }
    batches.finish(batch.id, failed === 0 ? 'completed' : 'failed', {
      completed, failed, reclaimedBytes,
    });
  } catch (err) {
    batches.finish(batch.id, 'failed', { completed, failed, error: (err as Error).message });
    throw err;
  }
  return { batchId: batch.id, completed, failed, reclaimedBytes };
}
```

- [ ] **Step 5: Write `packages/engine/src/dedupe/applier.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { planDedupe } from './planner.js';
import { applyDedupe } from './applier.js';

let dir: string; let db: Catalog; let driveId: string; let driveRoot: string;

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-apply-'));
  db = openCatalog(join(dir, 'cat.db')); migrate(db);
  driveRoot = join(dir, 'drive');
  mkdirSync(driveRoot, { recursive: true });
  driveId = new DriveRepo(db).upsert({
    volumeSerial: 'X', label: 'X', currentLetter: null, kind: 'local',
    roles: [], totalBytes: 1, freeBytes: 1,
  }).id;
  db.prepare(`INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`)
    .run('s', driveId, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');
});

afterEach(() => { closeCatalog(db); rmSync(dir, { recursive: true, force: true }); });

describe('applyDedupe', () => {
  it('quarantines all but the keeper', async () => {
    const files = new FilesRepo(db);
    const body = 'duplicate-content';
    const hash = sha(body);
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) {
      const p = join(driveRoot, name);
      writeFileSync(p, body);
      files.upsertOne({
        driveId, path: p, name, extension: 'jpg', sizeBytes: body.length,
        category: 'image', sha256: hash, mtime: '2024-01-01T00:00:00.000Z',
        ctime: '2024-01-01T00:00:00.000Z', exifDate: null, dateSource: 'mtime',
        width: null, height: null, durationSeconds: null, ntfsFileId: null,
        state: 'indexed', scanId: 's',
      });
    }
    const plan = planDedupe(db, { minSizeBytes: 1 });
    expect(plan.operations).toHaveLength(2);
    const result = await applyDedupe({
      db, operations: plan.operations, driveRoots: new Map([[driveId, driveRoot]]),
    });
    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
    const survivors = ['a.jpg', 'b.jpg', 'c.jpg'].filter((n) => existsSync(join(driveRoot, n)));
    expect(survivors).toHaveLength(1);
  });

  it('aborts a single op when live hash does not match catalog', async () => {
    const files = new FilesRepo(db);
    for (const name of ['a.jpg', 'b.jpg']) {
      const p = join(driveRoot, name);
      writeFileSync(p, 'real-content');
      files.upsertOne({
        driveId, path: p, name, extension: 'jpg', sizeBytes: 100,
        category: 'image', sha256: 'wronghash', mtime: '2024-01-01T00:00:00.000Z',
        ctime: '2024-01-01T00:00:00.000Z', exifDate: null, dateSource: 'mtime',
        width: null, height: null, durationSeconds: null, ntfsFileId: null,
        state: 'indexed', scanId: 's',
      });
    }
    const plan = planDedupe(db, { minSizeBytes: 1 });
    const result = await applyDedupe({
      db, operations: plan.operations, driveRoots: new Map([[driveId, driveRoot]]),
    });
    expect(result.failed).toBeGreaterThan(0);
    // Both source files should still be present.
    expect(existsSync(join(driveRoot, 'a.jpg'))).toBe(true);
    expect(existsSync(join(driveRoot, 'b.jpg'))).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```
git add packages/engine/src/dedupe/
git commit -m "feat(engine/dedupe): add planner and applier with hash-revalidation safety

Task: M4-T05"
```

### M4-T06: API endpoints for duplicates and quarantine

**Files:**
- Modify: `packages/engine/src/api/server.ts`

- [ ] **Step 1: Add endpoints**

Inside `createServer`, add:

```ts
app.get('/api/duplicates', (c) => {
  const minSize = parseInt(c.req.query('minSize') ?? '1', 10);
  const groups = planDedupe(opts.db, { minSizeBytes: minSize });
  return c.json(groups);
});

app.post('/api/duplicates/apply', async (c) => {
  const body = (await c.req.json()) as { operations: import('../dedupe/planner.js').DedupeOperation[]; driveRoots: Record<string, string> };
  const result = await applyDedupe({
    db: opts.db,
    operations: body.operations,
    driveRoots: new Map(Object.entries(body.driveRoots)),
  });
  events.publish({ type: 'batch-status', batchId: result.batchId, status: 'completed' });
  return c.json(result);
});

app.get('/api/quarantine', (c) => {
  const driveId = c.req.query('driveId');
  const rows = driveId
    ? opts.db.prepare(`SELECT * FROM quarantine WHERE drive_id = ? ORDER BY quarantined_at DESC`).all(driveId)
    : opts.db.prepare(`SELECT * FROM quarantine ORDER BY quarantined_at DESC LIMIT 1000`).all();
  return c.json({ entries: rows });
});

app.post('/api/quarantine/restore', async (c) => {
  const body = (await c.req.json()) as { quarantineIds: number[]; driveRoots: Record<string, string> };
  const errors: string[] = [];
  for (const id of body.quarantineIds) {
    const row = opts.db.prepare(`SELECT drive_id AS driveId FROM quarantine WHERE id = ?`).get(id) as { driveId: string } | undefined;
    if (!row) { errors.push(`${id} not found`); continue; }
    const root = body.driveRoots[row.driveId];
    if (!root) { errors.push(`${id} no driveRoot for ${row.driveId}`); continue; }
    try {
      restoreFromQuarantine({ db: opts.db, driveRoot: root, quarantineId: id });
    } catch (err) {
      errors.push(`${id}: ${(err as Error).message}`);
    }
  }
  return c.json({ restored: body.quarantineIds.length - errors.length, errors });
});
```

…and add the imports:

```ts
import { planDedupe } from '../dedupe/planner.js';
import { applyDedupe } from '../dedupe/applier.js';
import { restoreFromQuarantine } from '../quarantine/quarantine.js';
```

- [ ] **Step 2: Update API tests** with at least one round-trip test that runs `applyDedupe` via HTTP.

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```
git add packages/engine/src/api/server.ts packages/engine/src/api/server.test.ts
git commit -m "feat(engine/api): add duplicates and quarantine endpoints

Task: M4-T06"
```

### M4-T07: Duplicates UI screen

**Files:**
- Create: `packages/ui/src/routes/duplicates.tsx`
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/ui/src/app.tsx`
- Modify: `packages/ui/src/components/sidebar.tsx`

- [ ] **Step 1: Extend `ApiClient`**

```ts
async listDuplicates(minSize = 1): Promise<unknown> {
  return this.get(`/api/duplicates?minSize=${minSize}`);
}

async applyDedupe(input: { operations: unknown[]; driveRoots: Record<string, string> }): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/duplicates/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`apply failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Implement `packages/ui/src/routes/duplicates.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';

interface Copy { fileId: number; driveId: string; path: string; sizeBytes: number; mtime: string; }
interface Operation { groupSha256: string; keeperFileId: number; removeFileId: number; reasons: string[]; reclaimableBytes: number; }
interface Group { sha256: string; copies: Copy[]; fileSizeBytes: number; reclaimableBytes: number; }
interface Plan { operations: Operation[]; groups: Group[]; }

export function Duplicates() {
  const api = defaultApiClient();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    api.listDuplicates(1024).then((p) => {
      const planResult = p as Plan;
      setPlan(planResult);
      setSelected(new Set(planResult.operations.map((o) => o.removeFileId)));
    });
  }, []);

  if (!plan) return <div class="card">Loading…</div>;

  const totalReclaim = plan.operations
    .filter((o) => selected.has(o.removeFileId))
    .reduce((sum, o) => sum + o.reclaimableBytes, 0);

  const apply = async () => {
    const ops = plan.operations.filter((o) => selected.has(o.removeFileId));
    // Driveroots needed for apply — caller fills this in M4-T07 follow-up. For now, prompt:
    const map: Record<string, string> = {};
    for (const drive of new Set(plan.groups.flatMap((g) => g.copies.map((c) => c.driveId)))) {
      const root = window.prompt(`Drive root for ${drive}?`, '');
      if (root) map[drive] = root;
    }
    await api.applyDedupe({ operations: ops, driveRoots: map });
    window.location.reload();
  };

  return (
    <div>
      <h1>Duplicates</h1>
      <div class="card">
        <div>Groups: {plan.groups.length} · Selected ops: {selected.size}</div>
        <div>Reclaimable: {formatBytes(totalReclaim)}</div>
        <button onClick={apply} disabled={selected.size === 0}>Apply (move non-keepers to quarantine)</button>
      </div>
      {plan.groups.map((g) => (
        <div class="card" key={g.sha256}>
          <h3>{g.sha256.slice(0, 12)}… · {g.copies.length} copies · {formatBytes(g.reclaimableBytes)} reclaimable</h3>
          <table>
            <thead>
              <tr><th></th><th>Path</th><th>Size</th><th>mtime</th></tr>
            </thead>
            <tbody>
              {g.copies.map((c) => {
                const op = plan.operations.find((o) => o.removeFileId === c.fileId);
                const isKeeper = !op;
                return (
                  <tr key={c.fileId} style={isKeeper ? 'background:rgba(92,139,255,0.1)' : ''}>
                    <td>{isKeeper ? <strong>KEEP</strong> : (
                      <input type="checkbox" checked={selected.has(c.fileId)} onChange={(e) => {
                        const s = new Set(selected);
                        if ((e.target as HTMLInputElement).checked) s.add(c.fileId); else s.delete(c.fileId);
                        setSelected(s);
                      }}/>
                    )}</td>
                    <td>{c.path}</td>
                    <td>{formatBytes(c.sizeBytes)}</td>
                    <td>{c.mtime}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function formatBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${u[i]}`;
}
```

- [ ] **Step 3: Add Duplicates and Quarantine routes to `app.tsx` and `sidebar.tsx`**

In `app.tsx` add:

```tsx
import { Duplicates } from './routes/duplicates.js';
import { Quarantine } from './routes/quarantine.js';
// ...
<Route path="/duplicates" component={Duplicates} />
<Route path="/quarantine" component={Quarantine} />
```

In `sidebar.tsx` add:

```tsx
<a href="/duplicates">Duplicates</a>
<a href="/quarantine">Quarantine</a>
```

- [ ] **Step 4: Stub Quarantine route**

`packages/ui/src/routes/quarantine.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';

export function Quarantine() {
  const api = defaultApiClient();
  const [entries, setEntries] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    fetch('/api/quarantine').then((r) => r.json()).then((b: { entries: Array<Record<string, unknown>> }) => setEntries(b.entries));
  }, []);

  return (
    <div>
      <h1>Quarantine</h1>
      <div class="card">
        <table>
          <thead>
            <tr><th>When</th><th>Original</th><th>Quarantine path</th><th>Size</th></tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td>{String(e.quarantined_at)}</td>
                <td>{String(e.original_path)}</td>
                <td>{String(e.quarantine_path)}</td>
                <td>{String(e.original_size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run typecheck and build**

```
npm run typecheck --workspace=@fileorganizer/ui
npm run build --workspace=@fileorganizer/ui
```

- [ ] **Step 6: Commit**

```
git add packages/ui/
git commit -m "feat(ui): add Duplicates and Quarantine screens

Task: M4-T07"
```

### M4-T08: Milestone gate for M4

- [ ] **Step 1:** Run `npm test` and `npm run build`. PASS.

- [ ] **Step 2:** Smoke test: build, init catalog, scan a directory containing intentional duplicates, open Duplicates UI, apply, verify files moved into `_FileOrganizer_quarantine/<batch-id>/...`.

- [ ] **Step 3:** Merge to main: `git checkout main && git merge --no-ff m4-duplicates -m "merge: M4 duplicates"`.

- [ ] **Step 4:** End of M4. Stop the session.

---

## Section M5 — Rules + Organize

**Goal:** Define organizing rules, plan moves against the catalog, and apply approved moves with cross-drive review and undo.

> **Compression notice:** M5 follows the patterns established in M1–M4 closely. Each task below lists files, the failing-test code, the implementation, and the commit. Where the structure is identical to a previous task (e.g., a CRUD repo just like `BatchesRepo`), the plan refers to that pattern instead of reproducing every line.

### M5-T01: Rules repository

**Files:**
- Create: `packages/engine/src/rules/repo.ts`
- Create: `packages/engine/src/rules/repo.test.ts`

Build `RulesRepo` following the same shape as `BatchesRepo` (M4-T01): `create`, `update`, `delete`, `list`, `findById`. Persist `match` as JSON. Tests cover create + list-ordered-by-priority + update + delete.

- [ ] **Step 1:** Test: insert two rules with priorities 200 and 100, list returns priority 100 first.
- [ ] **Step 2:** Test: update changes the rule's name and `enabled` flag.
- [ ] **Step 3:** Implement `RulesRepo` with the column mapping below; return `Rule` from `@fileorganizer/shared`.

```ts
import { randomUUID } from 'node:crypto';
import type { Catalog } from '../catalog/connection.js';
import type { Rule, MovePolicy, QuarantinePolicy } from '@fileorganizer/shared';

export interface CreateRuleInput { name: string; priority: number; match: Rule['match']; destinationRole: string; destinationTemplate: string; movePolicy: MovePolicy; quarantinePolicy: QuarantinePolicy; enabled?: boolean; }

export class RulesRepo {
  constructor(private readonly db: Catalog) {}
  create(input: CreateRuleInput): Rule {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO rules (id, name, priority, enabled, match_json, destination_role, destination_template, move_policy, quarantine_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.priority, input.enabled === false ? 0 : 1, JSON.stringify(input.match), input.destinationRole, input.destinationTemplate, input.movePolicy, input.quarantinePolicy);
    return this.findById(id)!;
  }
  update(id: string, patch: Partial<CreateRuleInput> & { enabled?: boolean }): Rule {
    const existing = this.findById(id);
    if (!existing) throw new Error(`rule ${id} not found`);
    const next: Rule = { ...existing, ...patch, match: patch.match ?? existing.match };
    this.db.prepare(
      `UPDATE rules SET name = ?, priority = ?, enabled = ?, match_json = ?, destination_role = ?, destination_template = ?, move_policy = ?, quarantine_policy = ? WHERE id = ?`
    ).run(next.name, next.priority, next.enabled ? 1 : 0, JSON.stringify(next.match), next.destinationRole, next.destinationTemplate, next.movePolicy, next.quarantinePolicy, id);
    return this.findById(id)!;
  }
  delete(id: string): void { this.db.prepare(`DELETE FROM rules WHERE id = ?`).run(id); }
  list(): Rule[] { return (this.db.prepare(`SELECT * FROM rules ORDER BY priority ASC`).all() as Record<string, unknown>[]).map(toRule); }
  findById(id: string): Rule | null { const r = this.db.prepare(`SELECT * FROM rules WHERE id = ?`).get(id) as Record<string, unknown> | undefined; return r ? toRule(r) : null; }
}

function toRule(r: Record<string, unknown>): Rule {
  return {
    id: r['id'] as string, name: r['name'] as string, priority: r['priority'] as number,
    enabled: (r['enabled'] as number) === 1, match: JSON.parse(r['match_json'] as string),
    destinationRole: r['destination_role'] as string, destinationTemplate: r['destination_template'] as string,
    movePolicy: r['move_policy'] as MovePolicy, quarantinePolicy: r['quarantine_policy'] as QuarantinePolicy,
  };
}
```

- [ ] **Step 4:** Run tests, PASS.
- [ ] **Step 5:** Commit:

```
git add packages/engine/src/rules/repo.ts packages/engine/src/rules/repo.test.ts
git commit -m "feat(engine/rules): add rules repository

Task: M5-T01"
```

### M5-T02: Rule matcher

**Files:**
- Create: `packages/engine/src/rules/matcher.ts`
- Create: `packages/engine/src/rules/matcher.test.ts`

The matcher takes a `FileRecord` + a `Rule` and returns whether the file matches.

- [ ] **Step 1:** Test cases:
  1. File category is `image`, rule matches `category: ['image']` → match.
  2. File category is `video`, rule matches `category: ['image']` → no match.
  3. EXIF date 2023-01-01, rule `dateBefore: '2024-01-01'` → match.
  4. mtime-only date, rule `dateSourceMin: 'exif'` → no match.
  5. Path glob `**/Downloads/**` matches `/Users/x/Downloads/a.jpg`.
  6. Size 100, rule `minSizeBytes: 200` → no match.
  7. Source drive ID matches `sourceDrives` → match.

- [ ] **Step 2:** Implement using the spec's match shape from `Rule['match']`. Use the `picomatch` library for glob support; add it to `engine` deps.

```ts
import picomatch from 'picomatch';
import type { FileRecord, Rule } from '@fileorganizer/shared';

export function matches(file: FileRecord, rule: Rule): boolean {
  const m = rule.match;
  if (m.category && !m.category.includes(file.category)) return false;
  const d = file.exifDate ?? file.mtime;
  if (m.dateBefore && d >= m.dateBefore) return false;
  if (m.dateAfter && d <= m.dateAfter) return false;
  if (m.dateSourceMin === 'exif' && file.dateSource !== 'exif') return false;
  if (m.dateSourceMin === 'mtime' && file.dateSource === 'none') return false;
  if (m.minSizeBytes != null && file.sizeBytes < m.minSizeBytes) return false;
  if (m.maxSizeBytes != null && file.sizeBytes > m.maxSizeBytes) return false;
  if (m.pathGlob) {
    const isMatch = picomatch(m.pathGlob, { dot: true });
    if (!isMatch(file.path)) return false;
  }
  if (m.sourceDrives && !m.sourceDrives.includes(file.driveId)) return false;
  return true;
}

export function firstMatch(file: FileRecord, rules: Rule[]): Rule | null {
  for (const r of rules) {
    if (!r.enabled) continue;
    if (matches(file, r)) return r;
  }
  return null;
}
```

- [ ] **Step 3:** `npm install --workspace=@fileorganizer/engine picomatch @types/picomatch`
- [ ] **Step 4:** Run tests, PASS.
- [ ] **Step 5:** Commit:

```
git add packages/engine/src/rules/matcher.ts packages/engine/src/rules/matcher.test.ts packages/engine/package.json package-lock.json
git commit -m "feat(engine/rules): add rule matcher with glob support

Task: M5-T02"
```

### M5-T03: Destination template renderer

**Files:**
- Create: `packages/engine/src/rules/template.ts`
- Create: `packages/engine/src/rules/template.test.ts`

- [ ] **Step 1:** Test cases:
  1. `Photos/{year}/{month:02}/{filename}` with EXIF date 2023-08-15 and filename `a.jpg` → `Photos/2023/08/a.jpg`.
  2. `{category}/{stem}-{day:02}.{ext}` with category `image`, stem `IMG`, ext `jpg`, day 5 → `image/IMG-05.jpg`.
  3. Missing date with template referencing `{year}` → throws.
- [ ] **Step 2:** Implement:

```ts
import { extname, basename } from 'node:path';
import type { FileRecord } from '@fileorganizer/shared';
import { RuleError } from '@fileorganizer/shared';

const FIELD_RE = /\{(year|month|day|filename|stem|ext|category|drive_label)(?::(\d+))?\}/g;

export function renderTemplate(template: string, file: FileRecord, driveLabel: string): string {
  return template.replace(FIELD_RE, (_, field: string, pad?: string) => {
    const padN = pad ? parseInt(pad, 10) : 0;
    switch (field) {
      case 'year': return String(yearOf(file)).padStart(4, '0');
      case 'month': return padDigits(monthOf(file), padN || 1);
      case 'day': return padDigits(dayOf(file), padN || 1);
      case 'filename': return file.name;
      case 'stem': return basename(file.name, extname(file.name));
      case 'ext': return file.extension;
      case 'category': return file.category;
      case 'drive_label': return driveLabel;
      default: throw new RuleError('TEMPLATE_UNKNOWN_FIELD', `unknown field {${field}}`);
    }
  });
}

function yearOf(f: FileRecord): number {
  const d = f.exifDate ?? f.mtime;
  if (!d) throw new RuleError('TEMPLATE_NO_DATE', 'cannot render {year} without date');
  return new Date(d).getUTCFullYear();
}
function monthOf(f: FileRecord): number {
  const d = f.exifDate ?? f.mtime;
  if (!d) throw new RuleError('TEMPLATE_NO_DATE', 'cannot render {month} without date');
  return new Date(d).getUTCMonth() + 1;
}
function dayOf(f: FileRecord): number {
  const d = f.exifDate ?? f.mtime;
  if (!d) throw new RuleError('TEMPLATE_NO_DATE', 'cannot render {day} without date');
  return new Date(d).getUTCDate();
}
function padDigits(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
```

- [ ] **Step 3:** Run tests, PASS.
- [ ] **Step 4:** Commit:

```
git add packages/engine/src/rules/template.ts packages/engine/src/rules/template.test.ts
git commit -m "feat(engine/rules): add destination template renderer

Task: M5-T03"
```

### M5-T04: Role resolver

**Files:**
- Create: `packages/engine/src/rules/role-resolver.ts`
- Create: `packages/engine/src/rules/role-resolver.test.ts`

Resolves a role name to a destination drive ID using the role's priority list and the drives' fill thresholds.

- [ ] **Step 1:** Test cases:
  1. Role `media-archive` with priority `[d1, d2]`, both connected with plenty of space → returns `d1`.
  2. `d1` over its fill threshold → returns `d2`.
  3. Both over threshold → returns null with reason.
  4. `d1` not connected → returns `d2`.
- [ ] **Step 2:** Implement:

```ts
import type { DriveRecord, RoleDefinition } from '@fileorganizer/shared';

export interface ResolveOptions {
  role: RoleDefinition;
  drives: Map<string, DriveRecord>;
}

export interface ResolveResult {
  driveId: string | null;
  reason: string;
}

export function resolveRole(opts: ResolveOptions): ResolveResult {
  for (const driveId of opts.role.drivePriority) {
    const drive = opts.drives.get(driveId);
    if (!drive) continue;
    if (!drive.connected) continue;
    const usedPct = drive.totalBytes > 0 ? ((drive.totalBytes - drive.freeBytes) / drive.totalBytes) * 100 : 0;
    if (usedPct >= opts.role.fillThresholdPercent) continue;
    return { driveId: drive.id, reason: `selected ${drive.label}` };
  }
  return { driveId: null, reason: `no drive in role "${opts.role.name}" available` };
}
```

- [ ] **Step 3:** Run tests, PASS. Commit.

### M5-T05: Organize planner

**Files:**
- Create: `packages/engine/src/organize/planner.ts`
- Create: `packages/engine/src/organize/planner.test.ts`

Combines rules + matcher + template + role resolver into a complete plan.

- [ ] **Step 1:** Test cases:
  1. Two files match a rule that lands them at different paths → two `same-drive-move` ops.
  2. Rule destination role resolves to a different drive → `cross-drive-move`.
  3. File path equals rendered destination path → `noop`.
  4. File matches no rule → not in plan; appears in `unmatched` list.
- [ ] **Step 2:** Implement (key decisions inline):

```ts
import { resolve, dirname, isAbsolute, join } from 'node:path';
import type { Catalog } from '../catalog/connection.js';
import type { FileRecord, Rule, DriveRecord, RoleDefinition } from '@fileorganizer/shared';
import { firstMatch } from '../rules/matcher.js';
import { renderTemplate } from '../rules/template.js';
import { resolveRole } from '../rules/role-resolver.js';
import { RulesRepo } from '../rules/repo.js';
import { DriveRepo } from '../drives/repo.js';

export type OperationKindPlanned = 'same-drive-move' | 'cross-drive-move' | 'noop';

export interface PlannedOperation {
  fileId: number;
  ruleId: string;
  sourceDriveId: string;
  sourcePath: string;
  destDriveId: string;
  destPath: string;
  kind: OperationKindPlanned;
  estimatedBytes: number;
}

export interface OrganizePlan {
  operations: PlannedOperation[];
  unmatched: number[];
  unresolvedRoles: { ruleId: string; reason: string }[];
}

export interface PlanInput {
  db: Catalog;
  driveRoots: Map<string, string>; // driveId → absolute root path on disk
  roles: RoleDefinition[];
}

export function planOrganize(input: PlanInput): OrganizePlan {
  const rules = new RulesRepo(input.db).list();
  const drives = new DriveRepo(input.db).list();
  const drivesById = new Map<string, DriveRecord>(drives.map((d) => [d.id, { ...d, connected: input.driveRoots.has(d.id) }]));
  const roleById = new Map<string, RoleDefinition>(input.roles.map((r) => [r.name, r]));
  const operations: PlannedOperation[] = [];
  const unmatched: number[] = [];
  const unresolvedRoles: { ruleId: string; reason: string }[] = [];

  const rows = input.db
    .prepare(`SELECT * FROM files WHERE state = 'indexed'`)
    .all() as Record<string, unknown>[];
  const files = rows.map(rowToFileRecord);

  for (const file of files) {
    const rule = firstMatch(file, rules);
    if (!rule) { unmatched.push(file.id); continue; }
    const role = roleById.get(rule.destinationRole);
    if (!role) { unresolvedRoles.push({ ruleId: rule.id, reason: `unknown role ${rule.destinationRole}` }); continue; }
    const r = resolveRole({ role, drives: drivesById });
    if (!r.driveId) { unresolvedRoles.push({ ruleId: rule.id, reason: r.reason }); continue; }
    const destDrive = drivesById.get(r.driveId)!;
    const destDriveRoot = input.driveRoots.get(r.driveId);
    if (!destDriveRoot) { unresolvedRoles.push({ ruleId: rule.id, reason: `no driveRoot for ${r.driveId}` }); continue; }
    const rendered = renderTemplate(rule.destinationTemplate, file, destDrive.label);
    const destPath = isAbsolute(rendered) ? rendered : resolve(destDriveRoot, rendered);
    const kind: OperationKindPlanned = destPath === file.path ? 'noop' : file.driveId === r.driveId ? 'same-drive-move' : 'cross-drive-move';
    operations.push({
      fileId: file.id, ruleId: rule.id, sourceDriveId: file.driveId, sourcePath: file.path,
      destDriveId: r.driveId, destPath, kind, estimatedBytes: file.sizeBytes,
    });
  }
  return { operations, unmatched, unresolvedRoles };
}

function rowToFileRecord(r: Record<string, unknown>): FileRecord {
  return {
    id: r['id'] as number, driveId: r['drive_id'] as string, path: r['path'] as string,
    name: r['name'] as string, extension: r['extension'] as string, sizeBytes: r['size_bytes'] as number,
    category: r['category'] as FileRecord['category'], sha256: r['sha256'] as string,
    mtime: r['mtime'] as string, ctime: r['ctime'] as string,
    exifDate: (r['exif_date'] as string | null) ?? null, dateSource: r['date_source'] as FileRecord['dateSource'],
    width: (r['width'] as number | null) ?? null, height: (r['height'] as number | null) ?? null,
    durationSeconds: (r['duration_seconds'] as number | null) ?? null,
    ntfsFileId: (r['ntfs_file_id'] as string | null) ?? null,
    state: r['state'] as FileRecord['state'], lastVerifiedAt: r['last_verified_at'] as string,
    scanId: r['scan_id'] as string,
  };
}
```

- [ ] **Step 3:** Run tests. Commit:

```
git add packages/engine/src/organize/planner.ts packages/engine/src/organize/planner.test.ts packages/engine/src/rules/role-resolver.ts packages/engine/src/rules/role-resolver.test.ts
git commit -m "feat(engine/organize): add organize planner with role resolution

Task: M5-T04+T05"
```

### M5-T06: Same-drive and cross-drive move executors

**Files:**
- Create: `packages/engine/src/organize/move-same-drive.ts`
- Create: `packages/engine/src/organize/move-cross-drive.ts`
- Create: `packages/engine/src/organize/move-same-drive.test.ts`
- Create: `packages/engine/src/organize/move-cross-drive.test.ts`

**Same-drive** (atomic rename):

```ts
import { renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Catalog } from '../catalog/connection.js';

export function moveSameDrive(input: {
  db: Catalog; fileId: number; destPath: string;
}): void {
  const row = input.db.prepare(`SELECT path FROM files WHERE id = ?`).get(input.fileId) as { path: string } | undefined;
  if (!row) throw new Error(`file ${input.fileId} not found`);
  mkdirSync(dirname(input.destPath), { recursive: true });
  renameSync(row.path, input.destPath);
  input.db.prepare(`UPDATE files SET path = ?, state = 'moved' WHERE id = ?`).run(input.destPath, input.fileId);
}
```

**Cross-drive** (copy + verify + quarantine source):

```ts
import { createReadStream, createWriteStream, mkdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname } from 'node:path';
import type { Catalog } from '../catalog/connection.js';
import { hashFile } from '../scan/hasher.js';
import { quarantineFile } from '../quarantine/quarantine.js';
import { IntegrityError } from '@fileorganizer/shared';

export async function moveCrossDrive(input: {
  db: Catalog; fileId: number; destPath: string; destDriveId: string;
  sourceDriveRoot: string; batchId: string; chunkBytes: number;
}): Promise<void> {
  const row = input.db.prepare(
    `SELECT path, sha256, drive_id AS driveId, size_bytes AS sizeBytes, mtime FROM files WHERE id = ?`
  ).get(input.fileId) as { path: string; sha256: string; driveId: string; sizeBytes: number; mtime: string } | undefined;
  if (!row) throw new Error(`file ${input.fileId} not found`);
  mkdirSync(dirname(input.destPath), { recursive: true });
  await pipeline(createReadStream(row.path), createWriteStream(input.destPath));
  const liveHash = await hashFile(input.destPath, { chunkBytes: input.chunkBytes, sleepMs: 0 });
  if (liveHash !== row.sha256) {
    throw new IntegrityError('CROSS_DRIVE_HASH_MISMATCH', `dest hash ${liveHash} != catalog ${row.sha256}`);
  }
  quarantineFile({
    db: input.db, batchId: input.batchId, driveId: row.driveId, driveRoot: input.sourceDriveRoot,
    sourcePath: row.path, sha256: row.sha256, sizeBytes: row.sizeBytes, mtime: row.mtime,
  });
  input.db.prepare(`UPDATE files SET path = ?, drive_id = ?, state = 'moved' WHERE id = ?`)
    .run(input.destPath, input.destDriveId, input.fileId);
}
```

- [ ] **Step 1:** Tests for both: `moveSameDrive` renames a temp file and updates the row; `moveCrossDrive` copies between two temp drive roots, verifies the destination, source ends up under quarantine.
- [ ] **Step 2:** Run tests. Commit:

```
git add packages/engine/src/organize/move-*.ts packages/engine/src/organize/move-*.test.ts
git commit -m "feat(engine/organize): add same-drive and cross-drive move executors

Task: M5-T06"
```

### M5-T07: Apply orchestrator

**Files:**
- Create: `packages/engine/src/organize/applier.ts`
- Create: `packages/engine/src/organize/applier.test.ts`

Walks a list of `PlannedOperation`s. For each:
- Auto-applies same-drive moves under rules with `move_policy='same-drive-auto'` without batch approval (creates a `auto-batch` per planner run).
- Returns the rest as a "review queue" to be approved separately.
- A separate `applyApprovedBatch` function takes a batch ID + approved ops and runs them, including cross-drive copies.

- [ ] **Step 1:** Test the auto-apply path: same-drive moves with `same-drive-auto` rule policy execute immediately and produce a batch with `kind='move'`.
- [ ] **Step 2:** Test the review-queue path: cross-drive ops are returned as a list, *not* executed, until `applyApprovedBatch` is called.
- [ ] **Step 3:** Implement (skeleton):

```ts
import type { Catalog } from '../catalog/connection.js';
import type { PlannedOperation } from './planner.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { RulesRepo } from '../rules/repo.js';
import { moveSameDrive } from './move-same-drive.js';
import { moveCrossDrive } from './move-cross-drive.js';

export interface AutoApplyResult { autoBatchId: string | null; autoApplied: number; reviewQueue: PlannedOperation[]; }

export async function autoApply(input: {
  db: Catalog; operations: PlannedOperation[]; sourceDriveRoots: Map<string, string>;
}): Promise<AutoApplyResult> {
  const rules = new RulesRepo(input.db).list();
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const auto: PlannedOperation[] = [];
  const review: PlannedOperation[] = [];
  for (const op of input.operations) {
    const rule = ruleById.get(op.ruleId);
    if (!rule) { review.push(op); continue; }
    if (op.kind === 'noop') continue;
    if (op.kind === 'same-drive-move' && rule.movePolicy === 'same-drive-auto') auto.push(op);
    else review.push(op);
  }
  if (auto.length === 0) return { autoBatchId: null, autoApplied: 0, reviewQueue: review };
  const batches = new BatchesRepo(input.db);
  const batch = batches.start({ kind: 'move', description: 'auto same-drive moves' });
  for (const op of auto) {
    const dbOp = batches.recordOperation(batch.id, {
      kind: 'move', fileId: op.fileId, sourceDriveId: op.sourceDriveId,
      sourcePath: op.sourcePath, destDriveId: op.destDriveId, destPath: op.destPath, status: 'in-progress',
    });
    try {
      moveSameDrive({ db: input.db, fileId: op.fileId, destPath: op.destPath });
      batches.updateOperationStatus(dbOp.id, 'completed');
    } catch (err) {
      batches.updateOperationStatus(dbOp.id, 'failed', { errorMessage: (err as Error).message });
    }
  }
  batches.finish(batch.id, 'completed', { count: auto.length });
  return { autoBatchId: batch.id, autoApplied: auto.length, reviewQueue: review };
}

export async function applyApprovedBatch(input: {
  db: Catalog; description: string; operations: PlannedOperation[]; driveRoots: Map<string, string>;
  chunkBytes: number;
}): Promise<{ batchId: string; completed: number; failed: number }> {
  const batches = new BatchesRepo(input.db);
  const batch = batches.start({ kind: 'move', description: input.description });
  let completed = 0, failed = 0;
  for (const op of input.operations) {
    const dbOp = batches.recordOperation(batch.id, {
      kind: op.kind === 'cross-drive-move' ? 'copy' : 'move',
      fileId: op.fileId, sourceDriveId: op.sourceDriveId, sourcePath: op.sourcePath,
      destDriveId: op.destDriveId, destPath: op.destPath, status: 'in-progress',
    });
    try {
      if (op.kind === 'same-drive-move') moveSameDrive({ db: input.db, fileId: op.fileId, destPath: op.destPath });
      else if (op.kind === 'cross-drive-move') {
        const sourceRoot = input.driveRoots.get(op.sourceDriveId);
        if (!sourceRoot) throw new Error(`no driveRoot for ${op.sourceDriveId}`);
        await moveCrossDrive({ db: input.db, fileId: op.fileId, destPath: op.destPath,
          destDriveId: op.destDriveId, sourceDriveRoot: sourceRoot, batchId: batch.id, chunkBytes: input.chunkBytes });
      }
      batches.updateOperationStatus(dbOp.id, 'completed');
      completed += 1;
    } catch (err) {
      batches.updateOperationStatus(dbOp.id, 'failed', { errorMessage: (err as Error).message });
      failed += 1;
    }
  }
  batches.finish(batch.id, failed === 0 ? 'completed' : 'failed', { completed, failed });
  return { batchId: batch.id, completed, failed };
}
```

- [ ] **Step 4:** Run tests. Commit:

```
git add packages/engine/src/organize/applier.ts packages/engine/src/organize/applier.test.ts
git commit -m "feat(engine/organize): add auto-apply + approved-batch orchestrators

Task: M5-T07"
```

### M5-T08: Undo

**Files:**
- Create: `packages/engine/src/organize/undo.ts`
- Create: `packages/engine/src/organize/undo.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/src/organize/undo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { FilesRepo } from '../catalog/files-repo.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { moveSameDrive } from './move-same-drive.js';
import { moveCrossDrive } from './move-cross-drive.js';
import { undoBatch } from './undo.js';

let dir: string; let db: Catalog;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-undo-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => { closeCatalog(db); rmSync(dir, { recursive: true, force: true }); });

describe('undoBatch', () => {
  it('reverses a same-drive move', async () => {
    const driveRoot = join(dir, 'd1');
    mkdirSync(driveRoot, { recursive: true });
    const driveId = new DriveRepo(db).upsert({
      volumeSerial: 'V1', label: 'D1', currentLetter: null, kind: 'local',
      roles: [], totalBytes: 1, freeBytes: 1,
    }).id;
    db.prepare(`INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?,?,?,?,?)`)
      .run('s1', driveId, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');
    const src = join(driveRoot, 'a.jpg');
    writeFileSync(src, 'content');
    const file = new FilesRepo(db);
    file.upsertOne({
      driveId, path: src, name: 'a.jpg', extension: 'jpg', sizeBytes: 7,
      category: 'image', sha256: sha('content'), mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z', exifDate: null, dateSource: 'mtime',
      width: null, height: null, durationSeconds: null, ntfsFileId: null,
      state: 'indexed', scanId: 's1',
    });
    const fileId = file.findByPath(driveId, src)!.id;
    const dest = join(driveRoot, 'sub', 'a.jpg');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'move', description: 'test' });
    const op = batches.recordOperation(batch.id, {
      kind: 'move', fileId, sourceDriveId: driveId, sourcePath: src,
      destDriveId: driveId, destPath: dest, preHash: sha('content'), status: 'in-progress',
    });
    moveSameDrive({ db, fileId, destPath: dest });
    batches.updateOperationStatus(op.id, 'completed', { postHash: sha('content') });
    batches.finish(batch.id, 'completed', {});
    const result = await undoBatch({ db, batchId: batch.id, driveRoots: new Map([[driveId, driveRoot]]) });
    expect(result.reverted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(existsSync(src)).toBe(true);
    expect(existsSync(dest)).toBe(false);
    expect(file.findByPath(driveId, src)?.state).toBe('indexed');
  });

  it('reverses a cross-drive move via quarantine restore', async () => {
    const dRoot1 = join(dir, 'd1'); const dRoot2 = join(dir, 'd2');
    mkdirSync(dRoot1, { recursive: true }); mkdirSync(dRoot2, { recursive: true });
    const drives = new DriveRepo(db);
    const d1 = drives.upsert({ volumeSerial: 'V1', label: 'D1', currentLetter: null, kind: 'local', roles: [], totalBytes: 1, freeBytes: 1 }).id;
    const d2 = drives.upsert({ volumeSerial: 'V2', label: 'D2', currentLetter: null, kind: 'local', roles: [], totalBytes: 1, freeBytes: 1 }).id;
    db.prepare(`INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?,?,?,?,?)`)
      .run('s1', d1, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');
    const src = join(dRoot1, 'a.jpg');
    writeFileSync(src, 'content');
    const fr = new FilesRepo(db);
    fr.upsertOne({
      driveId: d1, path: src, name: 'a.jpg', extension: 'jpg', sizeBytes: 7,
      category: 'image', sha256: sha('content'), mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z', exifDate: null, dateSource: 'mtime',
      width: null, height: null, durationSeconds: null, ntfsFileId: null,
      state: 'indexed', scanId: 's1',
    });
    const fileId = fr.findByPath(d1, src)!.id;
    const dest = join(dRoot2, 'a.jpg');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'move', description: 't' });
    const op = batches.recordOperation(batch.id, {
      kind: 'copy', fileId, sourceDriveId: d1, sourcePath: src,
      destDriveId: d2, destPath: dest, preHash: sha('content'), status: 'in-progress',
    });
    await moveCrossDrive({
      db, fileId, destPath: dest, destDriveId: d2,
      sourceDriveRoot: dRoot1, batchId: batch.id, chunkBytes: 1024,
    });
    batches.updateOperationStatus(op.id, 'completed', { postHash: sha('content') });
    batches.finish(batch.id, 'completed', {});
    const result = await undoBatch({ db, batchId: batch.id, driveRoots: new Map([[d1, dRoot1], [d2, dRoot2]]) });
    expect(result.reverted).toBe(1);
    expect(existsSync(src)).toBe(true);
    expect(existsSync(dest)).toBe(false);
  });

  it('skips ops where destination hash changed since the move', async () => {
    const driveRoot = join(dir, 'd1');
    mkdirSync(driveRoot, { recursive: true });
    const driveId = new DriveRepo(db).upsert({
      volumeSerial: 'V1', label: 'D1', currentLetter: null, kind: 'local',
      roles: [], totalBytes: 1, freeBytes: 1,
    }).id;
    db.prepare(`INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?,?,?,?,?)`)
      .run('s1', driveId, '2024-01-01T00:00:00.000Z', 'completed', 'balanced');
    const src = join(driveRoot, 'a.jpg');
    writeFileSync(src, 'content');
    const fr = new FilesRepo(db);
    fr.upsertOne({
      driveId, path: src, name: 'a.jpg', extension: 'jpg', sizeBytes: 7,
      category: 'image', sha256: sha('content'), mtime: '2024-01-01T00:00:00.000Z',
      ctime: '2024-01-01T00:00:00.000Z', exifDate: null, dateSource: 'mtime',
      width: null, height: null, durationSeconds: null, ntfsFileId: null,
      state: 'indexed', scanId: 's1',
    });
    const fileId = fr.findByPath(driveId, src)!.id;
    const dest = join(driveRoot, 'sub', 'a.jpg');
    const batches = new BatchesRepo(db);
    const batch = batches.start({ kind: 'move', description: 't' });
    const op = batches.recordOperation(batch.id, {
      kind: 'move', fileId, sourceDriveId: driveId, sourcePath: src,
      destDriveId: driveId, destPath: dest, preHash: sha('content'), status: 'in-progress',
    });
    moveSameDrive({ db, fileId, destPath: dest });
    batches.updateOperationStatus(op.id, 'completed', { postHash: sha('content') });
    // Tamper: rewrite the destination so the live hash no longer matches post_hash
    writeFileSync(dest, 'tampered');
    const result = await undoBatch({ db, batchId: batch.id, driveRoots: new Map([[driveId, driveRoot]]) });
    expect(result.reverted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(existsSync(dest)).toBe(true); // still at dest
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```
npm test --workspace=@fileorganizer/engine -- undo
```

- [ ] **Step 3: Implement `packages/engine/src/organize/undo.ts`**

```ts
import { existsSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Catalog } from '../catalog/connection.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import { hashFile } from '../scan/hasher.js';
import { restoreFromQuarantine } from '../quarantine/quarantine.js';

export interface UndoOptions {
  db: Catalog;
  batchId: string;
  driveRoots: Map<string, string>;
  chunkBytes?: number;
}

export interface UndoResult {
  undoBatchId: string;
  reverted: number;
  skipped: number;
  errors: { operationId: number; reason: string }[];
}

export async function undoBatch(opts: UndoOptions): Promise<UndoResult> {
  const batches = new BatchesRepo(opts.db);
  const original = batches.findById(opts.batchId);
  if (!original) {
    throw new Error(`batch ${opts.batchId} not found`);
  }
  const ops = batches.listOperations(opts.batchId).reverse();
  const undoBatch_ = batches.start({
    kind: 'undo',
    description: `undo of ${opts.batchId}`,
  });
  const chunkBytes = opts.chunkBytes ?? 1024 * 1024;
  let reverted = 0;
  let skipped = 0;
  const errors: { operationId: number; reason: string }[] = [];

  for (const op of ops) {
    if (op.status !== 'completed' && op.status !== 'completed-via-existing') {
      skipped += 1;
      batches.recordOperation(undoBatch_.id, {
        kind: op.kind, fileId: op.fileId, sourceDriveId: op.destDriveId,
        sourcePath: op.destPath, destDriveId: op.sourceDriveId, destPath: op.sourcePath,
        status: 'reverted',
      });
      continue;
    }
    try {
      if (op.kind === 'move') {
        await undoSameDriveMove(opts, op, chunkBytes, batches, undoBatch_.id);
        reverted += 1;
      } else if (op.kind === 'copy') {
        await undoCrossDriveMove(opts, op, chunkBytes, batches, undoBatch_.id);
        reverted += 1;
      } else if (op.kind === 'quarantine') {
        await undoQuarantine(opts, op, batches, undoBatch_.id);
        reverted += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      const reason = (err as Error).message;
      errors.push({ operationId: op.id, reason });
      skipped += 1;
      batches.recordOperation(undoBatch_.id, {
        kind: op.kind, fileId: op.fileId, sourceDriveId: op.destDriveId,
        sourcePath: op.destPath, destDriveId: op.sourceDriveId, destPath: op.sourcePath,
        status: 'failed',
      });
    }
  }
  batches.finish(undoBatch_.id, errors.length === 0 ? 'completed' : 'failed', {
    reverted, skipped, errors: errors.length,
  });
  return { undoBatchId: undoBatch_.id, reverted, skipped, errors };
}

async function undoSameDriveMove(
  opts: UndoOptions,
  op: { id: number; fileId: number | null; sourcePath: string | null; destPath: string | null; postHash: string | null },
  chunkBytes: number,
  batches: BatchesRepo,
  undoBatchId: string,
): Promise<void> {
  if (!op.destPath || !op.sourcePath || !op.fileId) throw new Error('op missing paths');
  if (!existsSync(op.destPath)) throw new Error(`destination ${op.destPath} no longer exists`);
  if (op.postHash) {
    const live = await hashFile(op.destPath, { chunkBytes, sleepMs: 0 });
    if (live !== op.postHash) throw new Error(`hash drift at ${op.destPath}`);
  }
  if (existsSync(op.sourcePath)) throw new Error(`original path ${op.sourcePath} occupied`);
  mkdirSync(dirname(op.sourcePath), { recursive: true });
  renameSync(op.destPath, op.sourcePath);
  opts.db.prepare(`UPDATE files SET path = ?, state = 'indexed' WHERE id = ?`).run(op.sourcePath, op.fileId);
  batches.recordOperation(undoBatchId, {
    kind: 'move', fileId: op.fileId, sourceDriveId: op.destDriveId ?? null,
    sourcePath: op.destPath, destDriveId: op.sourceDriveId ?? null, destPath: op.sourcePath,
    status: 'completed',
  });
}

async function undoCrossDriveMove(
  opts: UndoOptions,
  op: { id: number; fileId: number | null; sourcePath: string | null; destPath: string | null; sourceDriveId: string | null; destDriveId: string | null; postHash: string | null },
  chunkBytes: number,
  batches: BatchesRepo,
  undoBatchId: string,
): Promise<void> {
  if (!op.destPath || !op.sourcePath || !op.fileId) throw new Error('op missing paths');
  if (!existsSync(op.destPath)) throw new Error(`destination ${op.destPath} no longer exists`);
  if (op.postHash) {
    const live = await hashFile(op.destPath, { chunkBytes, sleepMs: 0 });
    if (live !== op.postHash) throw new Error(`hash drift at ${op.destPath}`);
  }
  if (!op.sourceDriveId) throw new Error('missing sourceDriveId');
  const sourceRoot = opts.driveRoots.get(op.sourceDriveId);
  if (!sourceRoot) throw new Error(`no driveRoot for ${op.sourceDriveId}`);
  // The source was quarantined into the same batch's quarantine folder.
  const qRow = opts.db.prepare(
    `SELECT id FROM quarantine WHERE original_path = ? AND batch_id = ? ORDER BY id DESC LIMIT 1`,
  ).get(op.sourcePath, op.batchId) as { id: number } | undefined;
  if (!qRow) throw new Error(`quarantine entry for ${op.sourcePath} not found`);
  restoreFromQuarantine({ db: opts.db, driveRoot: sourceRoot, quarantineId: qRow.id });
  unlinkSync(op.destPath);
  opts.db.prepare(`UPDATE files SET path = ?, drive_id = ?, state = 'indexed' WHERE id = ?`)
    .run(op.sourcePath, op.sourceDriveId, op.fileId);
  batches.recordOperation(undoBatchId, {
    kind: 'restore', fileId: op.fileId, sourceDriveId: op.destDriveId ?? null,
    sourcePath: op.destPath, destDriveId: op.sourceDriveId, destPath: op.sourcePath,
    status: 'completed',
  });
}

async function undoQuarantine(
  opts: UndoOptions,
  op: { id: number; fileId: number | null; sourcePath: string | null; sourceDriveId: string | null; quarantinePath: string | null },
  batches: BatchesRepo,
  undoBatchId: string,
): Promise<void> {
  if (!op.fileId || !op.sourcePath || !op.sourceDriveId || !op.quarantinePath) {
    throw new Error('op missing fields');
  }
  const root = opts.driveRoots.get(op.sourceDriveId);
  if (!root) throw new Error(`no driveRoot for ${op.sourceDriveId}`);
  const qRow = opts.db.prepare(
    `SELECT id FROM quarantine WHERE quarantine_path = ? LIMIT 1`,
  ).get(op.quarantinePath) as { id: number } | undefined;
  if (!qRow) throw new Error(`quarantine entry not found for ${op.quarantinePath}`);
  restoreFromQuarantine({ db: opts.db, driveRoot: root, quarantineId: qRow.id });
  opts.db.prepare(`UPDATE files SET state = 'indexed' WHERE id = ?`).run(op.fileId);
  batches.recordOperation(undoBatchId, {
    kind: 'restore', fileId: op.fileId, sourceDriveId: op.sourceDriveId,
    sourcePath: op.quarantinePath, destDriveId: op.sourceDriveId, destPath: op.sourcePath,
    status: 'completed',
  });
}
```

> **Note:** `OperationRecord` types include `batchId` already; the helper functions destructure exactly the fields they need. The cross-drive undo uses `restoreFromQuarantine` which removes the `quarantine` row, so re-running undo on the same batch correctly fails the second time.

- [ ] **Step 4: Run tests, PASS**

```
npm test --workspace=@fileorganizer/engine
```

- [ ] **Step 5: Commit**

```
git add packages/engine/src/organize/undo.ts packages/engine/src/organize/undo.test.ts
git commit -m "feat(engine/organize): add undo with hash re-verification

Task: M5-T08"
```

### M5-T09: Rules + plan + apply + undo API endpoints

**Files:**
- Modify: `packages/engine/src/api/server.ts`
- Modify: `packages/engine/src/api/server.test.ts`

- [ ] **Step 1: Write failing API integration tests**

Append to `packages/engine/src/api/server.test.ts`:

```ts
describe('rules endpoints', () => {
  it('CRUD round-trip on /api/rules', async () => {
    const create = await fetch(`http://127.0.0.1:${handle.port}/api/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'photos archive',
        priority: 100,
        match: { category: ['image'], dateBefore: '2024-01-01' },
        destinationRole: 'media-archive',
        destinationTemplate: 'Photos/{year}/{month:02}/{filename}',
        movePolicy: 'cross-drive-review',
        quarantinePolicy: 'default',
      }),
    });
    expect(create.status).toBe(201);
    const { rule } = (await create.json()) as { rule: { id: string; name: string } };
    expect(rule.name).toBe('photos archive');

    const list = await fetch(`http://127.0.0.1:${handle.port}/api/rules`);
    const listBody = (await list.json()) as { rules: Array<{ id: string }> };
    expect(listBody.rules.some((r) => r.id === rule.id)).toBe(true);

    const update = await fetch(`http://127.0.0.1:${handle.port}/api/rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'photos renamed' }),
    });
    expect(update.status).toBe(200);
    const updated = (await update.json()) as { rule: { name: string } };
    expect(updated.rule.name).toBe('photos renamed');

    const del = await fetch(`http://127.0.0.1:${handle.port}/api/rules/${rule.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
  });
});

describe('batches endpoints', () => {
  it('lists empty batches initially', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/batches`);
    const body = (await res.json()) as { batches: unknown[] };
    expect(Array.isArray(body.batches)).toBe(true);
  });
});

describe('plan organize endpoint', () => {
  it('returns a plan shape', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/plan/organize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ driveRoots: {}, roles: [] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { operations: unknown[]; unmatched: number[]; unresolvedRoles: unknown[] };
    expect(Array.isArray(body.operations)).toBe(true);
    expect(Array.isArray(body.unmatched)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL** for all three new describes (endpoints don't exist).

- [ ] **Step 3: Add the endpoints to `packages/engine/src/api/server.ts`**

In `createServer`, add the imports at the top of the file:

```ts
import { RulesRepo } from '../rules/repo.js';
import { planOrganize } from '../organize/planner.js';
import { autoApply, applyApprovedBatch } from '../organize/applier.js';
import { undoBatch } from '../organize/undo.js';
import { BatchesRepo } from '../catalog/batches-repo.js';
import type { RoleDefinition } from '@fileorganizer/shared';
```

…and add inside `createServer`, before the static-files block:

```ts
const rules = new RulesRepo(opts.db);
const batches = new BatchesRepo(opts.db);

app.get('/api/rules', (c) => c.json({ rules: rules.list() }));

app.post('/api/rules', async (c) => {
  const body = (await c.req.json()) as Parameters<RulesRepo['create']>[0];
  const rule = rules.create(body);
  return c.json({ rule }, 201);
});

app.put('/api/rules/:id', async (c) => {
  const id = c.req.param('id');
  const patch = (await c.req.json()) as Parameters<RulesRepo['update']>[1];
  try {
    const rule = rules.update(id, patch);
    return c.json({ rule });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

app.delete('/api/rules/:id', (c) => {
  rules.delete(c.req.param('id'));
  return c.body(null, 204);
});

app.post('/api/plan/organize', async (c) => {
  const body = (await c.req.json()) as { driveRoots: Record<string, string>; roles?: RoleDefinition[] };
  const plan = planOrganize({
    db: opts.db,
    driveRoots: new Map(Object.entries(body.driveRoots)),
    roles: body.roles ?? [],
  });
  return c.json(plan);
});

app.post('/api/organize/auto-apply', async (c) => {
  const body = (await c.req.json()) as {
    operations: import('../organize/planner.js').PlannedOperation[];
    sourceDriveRoots: Record<string, string>;
  };
  const result = await autoApply({
    db: opts.db,
    operations: body.operations,
    sourceDriveRoots: new Map(Object.entries(body.sourceDriveRoots)),
  });
  events.publish({ type: 'batch-status', batchId: result.autoBatchId ?? '', status: 'completed' });
  return c.json(result);
});

app.post('/api/organize/apply', async (c) => {
  const body = (await c.req.json()) as {
    description: string;
    operations: import('../organize/planner.js').PlannedOperation[];
    driveRoots: Record<string, string>;
    dryRun?: boolean;
  };
  const result = await applyApprovedBatch({
    db: opts.db,
    description: body.description,
    operations: body.operations,
    driveRoots: new Map(Object.entries(body.driveRoots)),
    chunkBytes: 1024 * 1024,
    dryRun: body.dryRun === true,
  });
  events.publish({ type: 'batch-status', batchId: result.batchId, status: 'completed' });
  return c.json(result);
});

app.post('/api/organize/undo/:batchId', async (c) => {
  const batchId = c.req.param('batchId');
  const body = (await c.req.json()) as { driveRoots: Record<string, string> };
  try {
    const result = await undoBatch({
      db: opts.db,
      batchId,
      driveRoots: new Map(Object.entries(body.driveRoots)),
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get('/api/batches', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 1000);
  return c.json({ batches: batches.list({ limit }) });
});

app.get('/api/batches/:id', (c) => {
  const id = c.req.param('id');
  const batch = batches.findById(id);
  if (!batch) return c.json({ error: 'not-found' }, 404);
  const operations = batches.listOperations(id);
  return c.json({ batch, operations });
});
```

- [ ] **Step 4: Run tests, PASS**

> **Note:** the `dryRun` flag on `applyApprovedBatch` is added by §M5-T07b in Section 11. If you have not implemented §M5-T07b yet, drop the `dryRun` field from the body extraction and the call. Re-add when §M5-T07b lands.

- [ ] **Step 5: Commit**

```
git add packages/engine/src/api/server.ts packages/engine/src/api/server.test.ts
git commit -m "feat(engine/api): add rules CRUD, plan, apply, undo, batches endpoints

Task: M5-T09"
```

### M5-T10: Rules editor UI

**Files:**
- Create: `packages/ui/src/routes/organize.tsx`
- Create: `packages/ui/src/components/rule-form.tsx`
- Create: `packages/ui/src/components/drive-roots-prompt.tsx`
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/ui/src/app.tsx`
- Modify: `packages/ui/src/components/sidebar.tsx`

- [ ] **Step 1: Extend `ApiClient` with rules and plan methods**

Add to `packages/ui/src/api/client.ts`:

```ts
async listRules(): Promise<unknown[]> {
  const data = await this.get<{ rules: unknown[] }>('/api/rules');
  return data.rules;
}

async createRule(input: unknown): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/rules`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`createRule: ${res.status}`);
  return (await res.json()) as { rule: unknown };
}

async updateRule(id: string, patch: unknown): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/rules/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateRule: ${res.status}`);
  return (await res.json()) as { rule: unknown };
}

async deleteRule(id: string): Promise<void> {
  const res = await fetch(`${this.opts.baseUrl}/api/rules/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`deleteRule: ${res.status}`);
}

async planOrganize(driveRoots: Record<string, string>, roles: unknown[]): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/plan/organize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ driveRoots, roles }),
  });
  if (!res.ok) throw new Error(`planOrganize: ${res.status}`);
  return res.json();
}

async organizeApply(input: { description: string; operations: unknown[]; driveRoots: Record<string, string>; dryRun?: boolean }): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/organize/apply`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`organizeApply: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Implement `packages/ui/src/components/drive-roots-prompt.tsx`**

A reusable modal that asks the user for the drive root path of every drive in the catalog. Returned as `Record<driveId, rootPath>`. The user types each path into a text field; the component validates that they're absolute.

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord } from '@fileorganizer/shared';

export function DriveRootsPrompt({ onResolve, onCancel }: { onResolve: (roots: Record<string, string>) => void; onCancel: () => void }) {
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [roots, setRoots] = useState<Record<string, string>>({});

  useEffect(() => {
    defaultApiClient().listDrives().then(setDrives);
  }, []);

  const allFilled = drives.length > 0 && drives.every((d) => roots[d.id]?.trim().length);

  return (
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10">
      <div class="card" style="width:500px;max-width:90vw">
        <h3>Drive roots</h3>
        <p class="muted">Enter the absolute path on this machine for each drive's root.</p>
        {drives.map((d) => (
          <div key={d.id} style="margin:8px 0">
            <label>{d.label} ({d.currentLetter ?? '—'}):</label>
            <input
              style="width:100%"
              placeholder={d.currentLetter ? `${d.currentLetter}\\` : '/path/to/drive'}
              value={roots[d.id] ?? ''}
              onInput={(e) => setRoots({ ...roots, [d.id]: (e.target as HTMLInputElement).value })}
            />
          </div>
        ))}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="secondary" onClick={onCancel}>Cancel</button>
          <button disabled={!allFilled} onClick={() => onResolve(roots)}>Continue</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `packages/ui/src/components/rule-form.tsx`**

```tsx
import { useState } from 'preact/hooks';
import type { Rule, Category } from '@fileorganizer/shared';
import { CATEGORIES } from '@fileorganizer/shared';

interface Props {
  initial?: Partial<Rule>;
  onSubmit: (rule: Omit<Rule, 'id'>) => void;
  onCancel: () => void;
}

export function RuleForm({ initial, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [priority, setPriority] = useState(initial?.priority ?? 100);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [categories, setCategories] = useState<Category[]>(initial?.match.category ?? []);
  const [dateBefore, setDateBefore] = useState(initial?.match.dateBefore ?? '');
  const [dateAfter, setDateAfter] = useState(initial?.match.dateAfter ?? '');
  const [pathGlob, setPathGlob] = useState(initial?.match.pathGlob ?? '');
  const [destinationRole, setDestinationRole] = useState(initial?.destinationRole ?? '');
  const [destinationTemplate, setDestinationTemplate] = useState(initial?.destinationTemplate ?? '');
  const [movePolicy, setMovePolicy] = useState<Rule['movePolicy']>(initial?.movePolicy ?? 'cross-drive-review');

  const submit = () => {
    onSubmit({
      name, priority, enabled,
      match: {
        category: categories.length ? categories : undefined,
        dateBefore: dateBefore || undefined,
        dateAfter: dateAfter || undefined,
        pathGlob: pathGlob || undefined,
      },
      destinationRole, destinationTemplate, movePolicy,
      quarantinePolicy: 'default',
    });
  };

  const toggleCategory = (c: Category) => {
    setCategories(categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c]);
  };

  return (
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10">
      <div class="card" style="width:600px;max-width:90vw;max-height:90vh;overflow:auto">
        <h3>{initial?.id ? 'Edit rule' : 'New rule'}</h3>
        <label>Name<input style="width:100%" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <label>Priority<input type="number" value={priority} onInput={(e) => setPriority(parseInt((e.target as HTMLInputElement).value, 10))} /></label>
        <label><input type="checkbox" checked={enabled} onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)} /> Enabled</label>
        <h4>Match</h4>
        <div>Categories: {CATEGORIES.map((c) => (
          <label key={c} style="margin-right:8px"><input type="checkbox" checked={categories.includes(c)} onChange={() => toggleCategory(c)} /> {c}</label>
        ))}</div>
        <label>Date before (ISO)<input value={dateBefore} onInput={(e) => setDateBefore((e.target as HTMLInputElement).value)} /></label>
        <label>Date after (ISO)<input value={dateAfter} onInput={(e) => setDateAfter((e.target as HTMLInputElement).value)} /></label>
        <label>Path glob<input style="width:100%" value={pathGlob} onInput={(e) => setPathGlob((e.target as HTMLInputElement).value)} /></label>
        <h4>Destination</h4>
        <label>Role<input value={destinationRole} onInput={(e) => setDestinationRole((e.target as HTMLInputElement).value)} /></label>
        <label>Template<input style="width:100%" value={destinationTemplate} onInput={(e) => setDestinationTemplate((e.target as HTMLInputElement).value)} placeholder="Photos/{year}/{month:02}/{filename}" /></label>
        <label>Move policy
          <select value={movePolicy} onChange={(e) => setMovePolicy((e.target as HTMLSelectElement).value as Rule['movePolicy'])}>
            <option value="same-drive-auto">same-drive-auto</option>
            <option value="cross-drive-review">cross-drive-review</option>
            <option value="always-review">always-review</option>
          </select>
        </label>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="secondary" onClick={onCancel}>Cancel</button>
          <button onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `packages/ui/src/routes/organize.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import { RuleForm } from '../components/rule-form.js';
import { DriveRootsPrompt } from '../components/drive-roots-prompt.js';
import type { Rule } from '@fileorganizer/shared';

type Tab = 'rules' | 'plan' | 'unsorted';

interface PlanResponse {
  operations: Array<{ fileId: number; ruleId: string; sourceDriveId: string; sourcePath: string; destDriveId: string; destPath: string; kind: string; estimatedBytes: number; }>;
  unmatched: number[];
  unresolvedRoles: Array<{ ruleId: string; reason: string }>;
}

export function Organize() {
  const api = defaultApiClient();
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [showRoots, setShowRoots] = useState<null | 'plan' | 'apply'>(null);
  const [pendingApply, setPendingApply] = useState<Array<PlanResponse['operations'][number]>>([]);
  const [error, setError] = useState<string | null>(null);

  const reloadRules = () => {
    api.listRules().then((r) => setRules(r as Rule[])).catch((e) => setError((e as Error).message));
  };

  useEffect(reloadRules, []);

  const onPlan = (roots: Record<string, string>) => {
    setShowRoots(null);
    api.planOrganize(roots, []).then((p) => setPlan(p as PlanResponse)).catch((e) => setError((e as Error).message));
  };

  const onApply = async (roots: Record<string, string>) => {
    setShowRoots(null);
    try {
      await api.organizeApply({ description: 'manual approval', operations: pendingApply, driveRoots: roots });
      setPendingApply([]);
      setPlan(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <h1>Organize</h1>
      <div class="card">
        <button class={tab === 'rules' ? '' : 'secondary'} onClick={() => setTab('rules')}>Rules ({rules.length})</button>{' '}
        <button class={tab === 'plan' ? '' : 'secondary'} onClick={() => setTab('plan')}>Plan</button>{' '}
        <button class={tab === 'unsorted' ? '' : 'secondary'} onClick={() => setTab('unsorted')}>Unsorted</button>
      </div>
      {error ? <div class="card" style="color:var(--danger)">{error}</div> : null}

      {tab === 'rules' ? (
        <div class="card">
          <button onClick={() => setCreating(true)}>New rule</button>
          <table style="margin-top:16px">
            <thead><tr><th>Pri</th><th>Name</th><th>Match</th><th>Destination</th><th>Policy</th><th></th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={r.enabled ? '' : 'opacity:0.5'}>
                  <td>{r.priority}</td>
                  <td>{r.name}</td>
                  <td>{summarizeMatch(r)}</td>
                  <td><code>{r.destinationRole}/{r.destinationTemplate}</code></td>
                  <td>{r.movePolicy}</td>
                  <td>
                    <button class="secondary" onClick={() => setEditing(r)}>Edit</button>{' '}
                    <button class="secondary" onClick={async () => { await api.deleteRule(r.id); reloadRules(); }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'plan' ? (
        <div class="card">
          <button onClick={() => setShowRoots('plan')}>Run planner</button>
          {plan ? (
            <div style="margin-top:16px">
              <p>{plan.operations.length} operations · {plan.unmatched.length} unmatched · {plan.unresolvedRoles.length} unresolved roles</p>
              {plan.unresolvedRoles.length ? (
                <div class="muted">Unresolved: {plan.unresolvedRoles.map((u) => u.reason).join('; ')}</div>
              ) : null}
              <table>
                <thead><tr><th></th><th>Source</th><th>Destination</th><th>Kind</th><th>Bytes</th></tr></thead>
                <tbody>
                  {plan.operations.map((op) => (
                    <tr key={op.fileId}>
                      <td><input type="checkbox" checked={pendingApply.some((p) => p.fileId === op.fileId)} onChange={(e) => {
                        if ((e.target as HTMLInputElement).checked) setPendingApply([...pendingApply, op]);
                        else setPendingApply(pendingApply.filter((p) => p.fileId !== op.fileId));
                      }} /></td>
                      <td>{op.sourcePath}</td>
                      <td>{op.destPath}</td>
                      <td>{op.kind}</td>
                      <td>{op.estimatedBytes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button disabled={pendingApply.length === 0} onClick={() => setShowRoots('apply')} style="margin-top:8px">
                Apply selected ({pendingApply.length})
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'unsorted' ? (
        <div class="card"><p class="muted">Run the planner to populate this view (uses unmatched IDs).</p></div>
      ) : null}

      {creating ? (
        <RuleForm onCancel={() => setCreating(false)} onSubmit={async (r) => {
          await api.createRule(r); setCreating(false); reloadRules();
        }} />
      ) : null}
      {editing ? (
        <RuleForm initial={editing} onCancel={() => setEditing(null)} onSubmit={async (r) => {
          await api.updateRule(editing.id, r); setEditing(null); reloadRules();
        }} />
      ) : null}
      {showRoots ? (
        <DriveRootsPrompt
          onResolve={(roots) => (showRoots === 'plan' ? onPlan(roots) : onApply(roots))}
          onCancel={() => setShowRoots(null)}
        />
      ) : null}
    </div>
  );
}

function summarizeMatch(r: Rule): string {
  const parts: string[] = [];
  if (r.match.category) parts.push(r.match.category.join('|'));
  if (r.match.dateBefore) parts.push(`<${r.match.dateBefore}`);
  if (r.match.dateAfter) parts.push(`>${r.match.dateAfter}`);
  if (r.match.pathGlob) parts.push(`glob:${r.match.pathGlob}`);
  return parts.join(' · ') || '*';
}
```

- [ ] **Step 5: Wire into `packages/ui/src/app.tsx`**

```tsx
import { Organize } from './routes/organize.js';
// ...inside <Router>
<Route path="/organize" component={Organize} />
```

…and add `<a href="/organize">Organize</a>` to `packages/ui/src/components/sidebar.tsx`.

- [ ] **Step 6: Typecheck and build**

```
npm run typecheck --workspace=@fileorganizer/ui
npm run build --workspace=@fileorganizer/ui
```

- [ ] **Step 7: Commit**

```
git add packages/ui/src/api/client.ts packages/ui/src/routes/organize.tsx packages/ui/src/components/rule-form.tsx packages/ui/src/components/drive-roots-prompt.tsx packages/ui/src/app.tsx packages/ui/src/components/sidebar.tsx
git commit -m "feat(ui): add Organize screen with Rules, Plan, Unsorted tabs

Task: M5-T10"
```

### M5-T11: History UI

**Files:**
- Create: `packages/ui/src/routes/history.tsx`
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/ui/src/app.tsx`
- Modify: `packages/ui/src/components/sidebar.tsx`

- [ ] **Step 1: Extend `ApiClient`**

```ts
async listBatches(limit = 100): Promise<unknown[]> {
  const data = await this.get<{ batches: unknown[] }>(`/api/batches?limit=${limit}`);
  return data.batches;
}

async getBatch(id: string): Promise<unknown> {
  return this.get(`/api/batches/${id}`);
}

async undoBatch(batchId: string, driveRoots: Record<string, string>): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/organize/undo/${batchId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ driveRoots }),
  });
  if (!res.ok) throw new Error(`undoBatch: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Implement `packages/ui/src/routes/history.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import { DriveRootsPrompt } from '../components/drive-roots-prompt.js';
import type { BatchRecord, OperationRecord } from '@fileorganizer/shared';

export function History() {
  const api = defaultApiClient();
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ops, setOps] = useState<Record<string, OperationRecord[]>>({});
  const [filterKind, setFilterKind] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [undoFor, setUndoFor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = () => {
    api.listBatches(200).then((b) => setBatches(b as BatchRecord[]));
  };
  useEffect(reload, []);

  const expand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!ops[id]) {
      const data = (await api.getBatch(id)) as { operations: OperationRecord[] };
      setOps({ ...ops, [id]: data.operations });
    }
  };

  const filtered = batches.filter((b) =>
    (!filterKind || b.kind === filterKind) &&
    (!filterStatus || b.status === filterStatus),
  );

  const onUndo = async (driveRoots: Record<string, string>) => {
    if (!undoFor) return;
    setUndoFor(null);
    try {
      const result = (await api.undoBatch(undoFor, driveRoots)) as { reverted: number; skipped: number };
      setMessage(`Undo: reverted=${result.reverted}, skipped=${result.skipped}`);
      reload();
    } catch (e) {
      setMessage(`Undo failed: ${(e as Error).message}`);
    }
  };

  return (
    <div>
      <h1>History</h1>
      <div class="card">
        Kind:
        <select value={filterKind} onChange={(e) => setFilterKind((e.target as HTMLSelectElement).value)}>
          <option value="">all</option>
          <option value="scan">scan</option>
          <option value="move">move</option>
          <option value="dedupe">dedupe</option>
          <option value="undo">undo</option>
          <option value="restore">restore</option>
        </select>
        {' '}Status:
        <select value={filterStatus} onChange={(e) => setFilterStatus((e.target as HTMLSelectElement).value)}>
          <option value="">all</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="in-progress">in-progress</option>
        </select>
        {message ? <span style="margin-left:16px">{message}</span> : null}
      </div>
      <div class="card">
        <table>
          <thead><tr><th></th><th>Started</th><th>Kind</th><th>Description</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {filtered.map((b) => (
              <>
                <tr key={b.id}>
                  <td><button class="secondary" onClick={() => expand(b.id)}>{expanded === b.id ? '−' : '+'}</button></td>
                  <td>{b.startedAt}</td>
                  <td>{b.kind}</td>
                  <td>{b.description}</td>
                  <td>{b.status}</td>
                  <td>
                    {b.kind !== 'undo' && b.status === 'completed' ? (
                      <button class="secondary" onClick={() => setUndoFor(b.id)}>Undo</button>
                    ) : null}
                  </td>
                </tr>
                {expanded === b.id && ops[b.id] ? (
                  <tr key={`${b.id}-detail`}>
                    <td colspan={6}>
                      <table>
                        <thead><tr><th>Kind</th><th>Source</th><th>Dest</th><th>Status</th><th>Error</th></tr></thead>
                        <tbody>
                          {ops[b.id]!.map((o) => (
                            <tr key={o.id}>
                              <td>{o.kind}</td>
                              <td>{o.sourcePath ?? '—'}</td>
                              <td>{o.destPath ?? o.quarantinePath ?? '—'}</td>
                              <td>{o.status}</td>
                              <td>{o.errorMessage ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null}
              </>
            ))}
          </tbody>
        </table>
      </div>
      {undoFor ? (
        <DriveRootsPrompt onResolve={onUndo} onCancel={() => setUndoFor(null)} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Wire route**

In `packages/ui/src/app.tsx`:

```tsx
import { History } from './routes/history.js';
// ...
<Route path="/history" component={History} />
```

…and add `<a href="/history">History</a>` to the sidebar.

- [ ] **Step 4: Typecheck and build**

```
npm run typecheck --workspace=@fileorganizer/ui
npm run build --workspace=@fileorganizer/ui
```

- [ ] **Step 5: Commit**

```
git add packages/ui/src/api/client.ts packages/ui/src/routes/history.tsx packages/ui/src/app.tsx packages/ui/src/components/sidebar.tsx
git commit -m "feat(ui): add History screen with batch detail and undo

Task: M5-T11"
```

### M5-T12: Milestone gate for M5

- [ ] **Step 1:** `npm test`, `npm run build`, all PASS.
- [ ] **Step 2:** Smoke test: scan a directory with mixed photos/docs; create rules; run planner; approve a cross-drive batch; verify files moved and quarantine populated; undo the batch; verify files restored.
- [ ] **Step 3:** Merge to main and stop.

---

## Section M6 — Roles + Schedules

**Goal:** First-class role model, schedule-driven throttle profile switching, and persisted role-to-drive priority that the planner consults.

### M6-T01: Roles repository

**Files:**
- Create: `packages/engine/src/rules/roles-repo.ts`
- Create: `packages/engine/src/rules/roles-repo.test.ts`

Roles live in `settings.roles` (an array of `RoleDefinition`). `RolesRepo` is a thin wrapper around `SettingsRepo` that adds validation.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from '../catalog/connection.js';
import { migrate } from '../catalog/migrate.js';
import { DriveRepo } from '../drives/repo.js';
import { RolesRepo } from './roles-repo.js';

let dir: string; let db: Catalog; let d1: string; let d2: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-roles-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
  d1 = new DriveRepo(db).upsert({ volumeSerial: 'V1', label: 'D1', currentLetter: null, kind: 'local', roles: [], totalBytes: 1, freeBytes: 1 }).id;
  d2 = new DriveRepo(db).upsert({ volumeSerial: 'V2', label: 'D2', currentLetter: null, kind: 'local', roles: [], totalBytes: 1, freeBytes: 1 }).id;
});

afterEach(() => { closeCatalog(db); rmSync(dir, { recursive: true, force: true }); });

describe('RolesRepo', () => {
  it('creates a role with a drive priority list', () => {
    const repo = new RolesRepo(db);
    const role = repo.create({ name: 'media-archive', drivePriority: [d1, d2], fillThresholdPercent: 90 });
    expect(role.name).toBe('media-archive');
    expect(role.drivePriority).toEqual([d1, d2]);
  });

  it('lists roles and returns the same instance on findByName', () => {
    const repo = new RolesRepo(db);
    repo.create({ name: 'a', drivePriority: [d1], fillThresholdPercent: 90 });
    repo.create({ name: 'b', drivePriority: [d2], fillThresholdPercent: 90 });
    expect(repo.list().map((r) => r.name).sort()).toEqual(['a', 'b']);
    expect(repo.findByName('a')).not.toBeNull();
  });

  it('updates priority and threshold', () => {
    const repo = new RolesRepo(db);
    repo.create({ name: 'r', drivePriority: [d1, d2], fillThresholdPercent: 90 });
    repo.update('r', { drivePriority: [d2, d1], fillThresholdPercent: 80 });
    const r = repo.findByName('r')!;
    expect(r.drivePriority).toEqual([d2, d1]);
    expect(r.fillThresholdPercent).toBe(80);
  });

  it('rejects roles referencing unknown drive ids', () => {
    const repo = new RolesRepo(db);
    expect(() => repo.create({ name: 'x', drivePriority: ['nope'], fillThresholdPercent: 90 })).toThrow(/unknown drive/);
  });

  it('deletes a role', () => {
    const repo = new RolesRepo(db);
    repo.create({ name: 'r', drivePriority: [d1], fillThresholdPercent: 90 });
    repo.delete('r');
    expect(repo.findByName('r')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `packages/engine/src/rules/roles-repo.ts`**

```ts
import type { Catalog } from '../catalog/connection.js';
import type { RoleDefinition } from '@fileorganizer/shared';
import { RuleError } from '@fileorganizer/shared';
import { SettingsRepo } from '../catalog/settings-repo.js';
import { DriveRepo } from '../drives/repo.js';

export class RolesRepo {
  private readonly settings: SettingsRepo;
  private readonly drives: DriveRepo;
  constructor(private readonly db: Catalog) {
    this.settings = new SettingsRepo(db);
    this.drives = new DriveRepo(db);
  }

  list(): RoleDefinition[] {
    return this.settings.load().roles;
  }

  findByName(name: string): RoleDefinition | null {
    return this.list().find((r) => r.name === name) ?? null;
  }

  create(role: RoleDefinition): RoleDefinition {
    this.validateDrives(role.drivePriority);
    const s = this.settings.load();
    if (s.roles.some((r) => r.name === role.name)) {
      throw new RuleError('ROLE_EXISTS', `role ${role.name} already exists`);
    }
    s.roles.push(role);
    this.settings.save(s);
    return role;
  }

  update(name: string, patch: Partial<RoleDefinition>): RoleDefinition {
    if (patch.drivePriority) this.validateDrives(patch.drivePriority);
    const s = this.settings.load();
    const idx = s.roles.findIndex((r) => r.name === name);
    if (idx < 0) throw new RuleError('ROLE_NOT_FOUND', `role ${name} not found`);
    s.roles[idx] = { ...s.roles[idx]!, ...patch };
    this.settings.save(s);
    return s.roles[idx]!;
  }

  delete(name: string): void {
    const s = this.settings.load();
    s.roles = s.roles.filter((r) => r.name !== name);
    this.settings.save(s);
  }

  private validateDrives(driveIds: string[]): void {
    const known = new Set(this.drives.list().map((d) => d.id));
    for (const id of driveIds) {
      if (!known.has(id)) {
        throw new RuleError('UNKNOWN_DRIVE_IN_ROLE', `unknown drive id ${id}`);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests, PASS**

- [ ] **Step 5: Commit**

```
git add packages/engine/src/rules/roles-repo.ts packages/engine/src/rules/roles-repo.test.ts
git commit -m "feat(engine/rules): add roles repository with drive validation

Task: M6-T01"
```

### M6-T02: Roles API endpoints

**Files:**
- Modify: `packages/engine/src/api/server.ts`

- [ ] **Step 1: Add endpoints**

```ts
import { RolesRepo } from '../rules/roles-repo.js';
// ...inside createServer:
const roles = new RolesRepo(opts.db);

app.get('/api/roles', (c) => c.json({ roles: roles.list() }));

app.post('/api/roles', async (c) => {
  const body = (await c.req.json()) as Parameters<RolesRepo['create']>[0];
  try {
    return c.json({ role: roles.create(body) }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put('/api/roles/:name', async (c) => {
  const name = c.req.param('name');
  const patch = (await c.req.json()) as Parameters<RolesRepo['update']>[1];
  try {
    return c.json({ role: roles.update(name, patch) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete('/api/roles/:name', (c) => {
  roles.delete(c.req.param('name'));
  return c.body(null, 204);
});
```

- [ ] **Step 2: Add an integration test** that creates a role, updates its priority, and asserts the change persists.

- [ ] **Step 3: Run tests, PASS, commit:**

```
git add packages/engine/src/api/server.ts packages/engine/src/api/server.test.ts
git commit -m "feat(engine/api): add roles CRUD endpoints

Task: M6-T02"
```

### M6-T03: Roles UI

**Files:**
- Create: `packages/ui/src/routes/roles.tsx`
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/ui/src/app.tsx`
- Modify: `packages/ui/src/components/sidebar.tsx`

- [ ] **Step 1: Extend `ApiClient`**

```ts
async listRoles(): Promise<unknown[]> {
  const data = await this.get<{ roles: unknown[] }>('/api/roles');
  return data.roles;
}

async createRole(input: unknown): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/roles`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`createRole: ${res.status}`);
  return res.json();
}

async updateRole(name: string, patch: unknown): Promise<unknown> {
  const res = await fetch(`${this.opts.baseUrl}/api/roles/${encodeURIComponent(name)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateRole: ${res.status}`);
  return res.json();
}

async deleteRole(name: string): Promise<void> {
  const res = await fetch(`${this.opts.baseUrl}/api/roles/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`deleteRole: ${res.status}`);
}
```

- [ ] **Step 2: Implement `packages/ui/src/routes/roles.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import type { DriveRecord, RoleDefinition } from '@fileorganizer/shared';

export function Roles() {
  const api = defaultApiClient();
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [drives, setDrives] = useState<DriveRecord[]>([]);
  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState(90);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    Promise.all([api.listRoles(), api.listDrives()]).then(([r, d]) => {
      setRoles(r as RoleDefinition[]);
      setDrives(d);
    });
  };
  useEffect(reload, []);

  const create = async () => {
    setError(null);
    try {
      await api.createRole({ name, drivePriority: picked, fillThresholdPercent: threshold });
      setName(''); setPicked([]); setThreshold(90);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reorder = async (roleName: string, from: number, to: number) => {
    const role = roles.find((r) => r.name === roleName)!;
    const next = [...role.drivePriority];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    await api.updateRole(roleName, { drivePriority: next });
    reload();
  };

  const driveLabel = (id: string) => drives.find((d) => d.id === id)?.label ?? id;

  return (
    <div>
      <h1>Roles</h1>
      <div class="card">
        <h3>New role</h3>
        <input placeholder="name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />{' '}
        <input type="number" placeholder="fill %" value={threshold} onInput={(e) => setThreshold(parseInt((e.target as HTMLInputElement).value, 10))} />
        <div>
          {drives.map((d) => (
            <label key={d.id} style="margin-right:8px">
              <input type="checkbox" checked={picked.includes(d.id)} onChange={(e) => {
                if ((e.target as HTMLInputElement).checked) setPicked([...picked, d.id]);
                else setPicked(picked.filter((x) => x !== d.id));
              }} /> {d.label}
            </label>
          ))}
        </div>
        <button disabled={!name || picked.length === 0} onClick={create}>Create</button>
        {error ? <p style="color:var(--danger)">{error}</p> : null}
      </div>
      {roles.map((r) => (
        <div class="card" key={r.name}>
          <h3>{r.name} <span class="muted">· fill threshold {r.fillThresholdPercent}%</span></h3>
          <ol>
            {r.drivePriority.map((id, i) => (
              <li key={id} style="display:flex;gap:8px;align-items:center">
                <span>{driveLabel(id)}</span>
                <button class="secondary" disabled={i === 0} onClick={() => reorder(r.name, i, i - 1)}>↑</button>
                <button class="secondary" disabled={i === r.drivePriority.length - 1} onClick={() => reorder(r.name, i, i + 1)}>↓</button>
              </li>
            ))}
          </ol>
          <button class="secondary" onClick={async () => { await api.deleteRole(r.name); reload(); }}>Delete role</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire route + sidebar link.** Add `<Route path="/roles" component={Roles} />` to `app.tsx` and `<a href="/roles">Roles</a>` to the sidebar.

- [ ] **Step 4: Typecheck, build, commit:**

```
git add packages/ui/src/routes/roles.tsx packages/ui/src/api/client.ts packages/ui/src/app.tsx packages/ui/src/components/sidebar.tsx
git commit -m "feat(ui): add Roles screen with reorder controls

Task: M6-T03"
```

### M6-T04: Throttle profile + schedule editor UI

**Files:**
- Create: `packages/ui/src/routes/throttle.tsx`
- Modify: `packages/engine/src/api/server.ts` (add settings endpoints)
- Modify: `packages/ui/src/api/client.ts`

- [ ] **Step 1: Add settings endpoints to the engine API**

```ts
import { SettingsRepo } from '../catalog/settings-repo.js';
// inside createServer:
const settingsRepo = new SettingsRepo(opts.db);
app.get('/api/settings', (c) => c.json({ settings: settingsRepo.load() }));
app.put('/api/settings', async (c) => {
  const body = (await c.req.json()) as { settings: import('@fileorganizer/shared').Settings };
  settingsRepo.save(body.settings);
  return c.json({ settings: body.settings });
});
```

- [ ] **Step 2: Add `getSettings`, `saveSettings` to `ApiClient`** following the pattern from previous tasks.

- [ ] **Step 3: Implement `packages/ui/src/routes/throttle.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { defaultApiClient } from '../api/client.js';
import type { Settings, ThrottleProfileName, ThrottleScheduleEntry } from '@fileorganizer/shared';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function Throttle() {
  const api = defaultApiClient();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => setSettings((s as { settings: Settings }).settings));
  }, []);

  if (!settings) return <div class="card">Loading…</div>;

  const profileAt = (day: number, hour: number): ThrottleProfileName | null => {
    for (const e of settings.throttleSchedule) {
      if (e.dayOfWeek !== day) continue;
      if (e.startHour <= e.endHour ? hour >= e.startHour && hour < e.endHour : hour >= e.startHour || hour < e.endHour) {
        return e.profile;
      }
    }
    return null;
  };

  const setHour = (day: number, hour: number, profile: ThrottleProfileName | null) => {
    const next = settings.throttleSchedule.filter((e) => !(e.dayOfWeek === day && e.startHour === hour && e.endHour === hour + 1));
    if (profile) {
      next.push({ dayOfWeek: day, startHour: hour, endHour: hour + 1, profile });
    }
    setSettings({ ...settings, throttleSchedule: next });
  };

  const save = async () => {
    await api.saveSettings(settings);
    setSavedMessage('Saved');
    setTimeout(() => setSavedMessage(null), 1500);
  };

  return (
    <div>
      <h1>Throttle</h1>
      <div class="card">
        <h2>Profiles</h2>
        {(['idle', 'balanced', 'full-send'] as ThrottleProfileName[]).map((name) => {
          const p = settings.throttleProfiles[name];
          return (
            <div key={name} style="margin-bottom:12px">
              <strong>{name}</strong>
              <div class="muted">workers: local {p.localHashWorkers} / nas {p.networkHashWorkers} · chunk {p.readChunkBytes}B · sleep {p.interChunkSleepMs}ms</div>
              <input type="number" min={1} max={32} value={p.localHashWorkers} onInput={(e) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                setSettings({
                  ...settings,
                  throttleProfiles: { ...settings.throttleProfiles, [name]: { ...p, localHashWorkers: v } },
                });
              }} /> local workers
            </div>
          );
        })}
      </div>
      <div class="card">
        <h2>Weekly schedule</h2>
        <table style="font-size:11px">
          <thead><tr><th></th>{HOURS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {DAYS.map((d, di) => (
              <tr key={d}>
                <td>{d}</td>
                {HOURS.map((h) => {
                  const p = profileAt(di, h);
                  const color = p === 'idle' ? '#444' : p === 'balanced' ? '#5c8bff' : p === 'full-send' ? '#ff6b6b' : 'transparent';
                  return (
                    <td key={h} style={`background:${color};cursor:pointer`} onClick={() => {
                      const next: ThrottleProfileName | null = !p ? 'idle' : p === 'idle' ? 'balanced' : p === 'balanced' ? 'full-send' : null;
                      setHour(di, h, next);
                    }} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted">Click a cell to cycle through profiles: empty → idle → balanced → full-send → empty.</p>
      </div>
      <button onClick={save}>Save settings</button>
      {savedMessage ? <span style="margin-left:8px">{savedMessage}</span> : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire route + sidebar link.** Commit:

```
git add packages/engine/src/api/server.ts packages/ui/src/api/client.ts packages/ui/src/routes/throttle.tsx packages/ui/src/app.tsx packages/ui/src/components/sidebar.tsx
git commit -m "feat(api+ui): add settings endpoint and Throttle editor

Task: M6-T04"
```

### M6-T05: Throttle scheduler runtime

**Files:**
- Create: `packages/engine/src/throttle/scheduler.ts`
- Create: `packages/engine/src/throttle/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThrottleManager } from './manager.js';
import { ThrottleScheduler } from './scheduler.js';
import { defaultThrottleProfiles } from '@fileorganizer/shared';
import { EventBus } from '../api/events.js';

describe('ThrottleScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits an event when the schedule changes the profile', () => {
    const bus = new EventBus();
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', [
      { dayOfWeek: new Date('2024-01-08T00:00:00Z').getUTCDay(), startHour: 0, endHour: 6, profile: 'full-send' },
    ]);
    vi.setSystemTime(new Date('2024-01-08T01:00:00Z'));
    const events: Array<{ type: string; profile?: string }> = [];
    bus.subscribe((e) => events.push(e as { type: string; profile?: string }));
    const scheduler = new ThrottleScheduler({ manager, events: bus, intervalMs: 60_000 });
    scheduler.start();
    scheduler.tick();
    expect(manager.current().name).toBe('full-send');
    expect(events.some((e) => e.type === 'throttle-changed')).toBe(true);
    scheduler.stop();
  });

  it('does not emit when the profile is unchanged', () => {
    const bus = new EventBus();
    const manager = new ThrottleManager(defaultThrottleProfiles(2), 'idle', []);
    vi.setSystemTime(new Date('2024-01-08T12:00:00Z'));
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    const scheduler = new ThrottleScheduler({ manager, events: bus, intervalMs: 60_000 });
    scheduler.tick();
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement `packages/engine/src/throttle/scheduler.ts`**

```ts
import type { ThrottleManager } from './manager.js';
import type { EventBus } from '../api/events.js';
import type { EngineEvent } from '../api/events.js';

export interface SchedulerOptions {
  manager: ThrottleManager;
  events: EventBus;
  intervalMs: number;
}

export class ThrottleScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: SchedulerOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  tick(): void {
    const before = this.opts.manager.current().name;
    const next = this.opts.manager.profileForDate(new Date());
    if (next.name !== before) {
      this.opts.manager.setProfile(next.name);
      this.opts.events.publish({ type: 'throttle-changed', profile: next.name } as unknown as EngineEvent);
    }
  }
}
```

> **Note:** The `EngineEvent` union doesn't include `throttle-changed` yet. Add it: in `packages/engine/src/api/events.ts`, extend the union with `| { type: 'throttle-changed'; profile: string }` and ensure the test's `events.push` typing tolerates the extension.

- [ ] **Step 3: Wire into `runServe`** so the scheduler starts when the engine boots and stops on shutdown.

```ts
// in packages/engine/src/cli/serve.ts, after createServer:
import { ThrottleScheduler } from '../throttle/scheduler.js';
import { ThrottleManager } from '../throttle/manager.js';
import { SettingsRepo } from '../catalog/settings-repo.js';

const s = new SettingsRepo(db).load();
const manager = new ThrottleManager(s.throttleProfiles, 'balanced', s.throttleSchedule);
const scheduler = new ThrottleScheduler({ manager, events: server.events, intervalMs: 60_000 });
scheduler.start();
// in shutdown:
scheduler.stop();
```

- [ ] **Step 4: Run tests. Commit.**

### M6-T06: Planner consumes roles from the catalog

**Files:**
- Modify: `packages/engine/src/organize/planner.ts`
- Modify: `packages/engine/src/api/server.ts`
- Add: `packages/engine/src/organize/planner.test.ts` integration test

The planner already accepts `roles: RoleDefinition[]`, but the API endpoint receives roles from the request body. Change it to read from `RolesRepo`.

- [ ] **Step 1: In `app.post('/api/plan/organize', ...)`**, replace the body's `roles ?? []` with `new RolesRepo(opts.db).list()`.

- [ ] **Step 2: Add an integration test** that demonstrates role-priority changes affect plan output:

```ts
it('plan output follows role priority changes', () => {
  // ...set up files, two drives, one role priority [d1, d2], assert plan picks d1
  // ...update role priority to [d2, d1], re-run plan, assert plan picks d2
});
```

- [ ] **Step 3: Commit:**

```
git add packages/engine/src/api/server.ts packages/engine/src/organize/planner.test.ts
git commit -m "feat(engine/api): planner reads roles from catalog rather than request body

Task: M6-T06"
```

### M6-T07: Milestone gate for M6

- [ ] **Step 1:** `npm test`, `npm run build`, all PASS.
- [ ] **Step 2:** Smoke test: create a role with two drives, run planner, change priority, re-run, observe destination drive change without editing any rule.
- [ ] **Step 3:** `git checkout main && git merge --no-ff m6-roles-schedules -m "merge: M6 roles + schedules"`. Stop.

---

## Section M7 — Polish + Hardening

**Goal:** Reconciliation pass on engine startup, error path completeness, performance tuning, keyboard shortcuts, install script polish, the "v1 trusted to run unattended overnight" outcome.

### M7-T01: Startup reconciliation

**Files:**
- Create: `packages/engine/src/catalog/reconcile.ts`
- Create: `packages/engine/src/catalog/reconcile.test.ts`
- Modify: `packages/engine/src/cli/serve.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { reconcileOnStartup } from './reconcile.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

let dir: string; let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-rec-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => { closeCatalog(db); rmSync(dir, { recursive: true, force: true }); });

function insertOp(values: Record<string, unknown>): number {
  const result = db.prepare(
    `INSERT INTO operations (batch_id, kind, source_path, dest_path, pre_hash, post_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(values['batch_id'], values['kind'], values['source_path'], values['dest_path'],
        values['pre_hash'], values['post_hash'], values['status']);
  return Number(result.lastInsertRowid);
}

describe('reconcileOnStartup', () => {
  beforeEach(() => {
    db.prepare(`INSERT INTO batches (id, kind, started_at, status, description, summary) VALUES (?,?,?,?,?,?)`)
      .run('b1', 'move', '2024-01-01T00:00:00Z', 'in-progress', 't', '{}');
  });

  it('marks an op completed when destination has the recorded post_hash', () => {
    const dest = join(dir, 'a.jpg');
    writeFileSync(dest, 'content');
    const opId = insertOp({ batch_id: 'b1', kind: 'move', source_path: join(dir, 'never'), dest_path: dest, pre_hash: sha('content'), post_hash: sha('content'), status: 'in-progress' });
    const result = reconcileOnStartup(db);
    const op = db.prepare(`SELECT status FROM operations WHERE id = ?`).get(opId) as { status: string };
    expect(op.status).toBe('completed');
    expect(result.fixed).toBeGreaterThanOrEqual(1);
  });

  it('marks an op failed when destination is missing and source still exists with pre_hash', () => {
    const src = join(dir, 'a.jpg');
    writeFileSync(src, 'content');
    const opId = insertOp({ batch_id: 'b1', kind: 'move', source_path: src, dest_path: join(dir, 'gone'), pre_hash: sha('content'), post_hash: null, status: 'in-progress' });
    reconcileOnStartup(db);
    const op = db.prepare(`SELECT status, error_message FROM operations WHERE id = ?`).get(opId) as { status: string; error_message: string };
    expect(op.status).toBe('failed');
    expect(op.error_message).toMatch(/never finished/);
  });

  it('marks ambiguous ops failed with explanatory message', () => {
    const opId = insertOp({ batch_id: 'b1', kind: 'move', source_path: join(dir, 'gone'), dest_path: join(dir, 'also-gone'), pre_hash: 'x', post_hash: 'y', status: 'in-progress' });
    reconcileOnStartup(db);
    const op = db.prepare(`SELECT status, error_message FROM operations WHERE id = ?`).get(opId) as { status: string; error_message: string };
    expect(op.status).toBe('failed');
    expect(op.error_message).toMatch(/ambiguous/);
  });

  it('finalizes batches whose ops are now all terminal', () => {
    insertOp({ batch_id: 'b1', kind: 'move', source_path: join(dir, 'gone'), dest_path: join(dir, 'gone2'), pre_hash: 'x', post_hash: 'y', status: 'in-progress' });
    reconcileOnStartup(db);
    const batch = db.prepare(`SELECT status FROM batches WHERE id = 'b1'`).get() as { status: string };
    expect(batch.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Implement `packages/engine/src/catalog/reconcile.ts`**

```ts
import { existsSync } from 'node:fs';
import type { Catalog } from './connection.js';
import { hashFile } from '../scan/hasher.js';

export interface ReconcileResult {
  scanned: number;
  fixed: number;
  ambiguous: number;
}

export async function reconcileOnStartup(db: Catalog): Promise<ReconcileResult> {
  const ops = db.prepare(
    `SELECT id, batch_id, kind, source_path, dest_path, pre_hash, post_hash, status, quarantine_path
     FROM operations WHERE status = 'in-progress'`,
  ).all() as Array<{
    id: number; batch_id: string; kind: string;
    source_path: string | null; dest_path: string | null;
    pre_hash: string | null; post_hash: string | null;
    status: string; quarantine_path: string | null;
  }>;
  let fixed = 0, ambiguous = 0;
  for (const op of ops) {
    const decision = await decide(op);
    db.prepare(`UPDATE operations SET status = ?, error_message = ? WHERE id = ?`)
      .run(decision.status, decision.message, op.id);
    if (decision.status === 'completed') fixed += 1;
    else if (decision.message?.includes('ambiguous')) ambiguous += 1;
    else fixed += 1;
  }
  // Finalize batches that are all-terminal
  const inProgressBatches = db.prepare(
    `SELECT DISTINCT batch_id FROM operations WHERE status NOT IN ('pending','in-progress')`,
  ).all() as Array<{ batch_id: string }>;
  for (const { batch_id } of inProgressBatches) {
    const counts = db.prepare(
      `SELECT
         SUM(CASE WHEN status IN ('pending','in-progress') THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM operations WHERE batch_id = ?`,
    ).get(batch_id) as { active: number | null; failed: number | null };
    if ((counts.active ?? 0) === 0) {
      const finalStatus = (counts.failed ?? 0) > 0 ? 'failed' : 'completed';
      db.prepare(`UPDATE batches SET status = ?, finished_at = ? WHERE id = ? AND status = 'in-progress'`)
        .run(finalStatus, new Date().toISOString(), batch_id);
    }
  }
  return { scanned: ops.length, fixed, ambiguous };
}

async function decide(op: {
  source_path: string | null; dest_path: string | null;
  pre_hash: string | null; post_hash: string | null;
  quarantine_path: string | null;
}): Promise<{ status: 'completed' | 'failed'; message: string | null }> {
  const destPresent = op.dest_path != null && existsSync(op.dest_path);
  const sourcePresent = op.source_path != null && existsSync(op.source_path);
  if (destPresent && op.post_hash) {
    try {
      const live = await hashFile(op.dest_path!, { chunkBytes: 1024 * 1024, sleepMs: 0 });
      if (live === op.post_hash) return { status: 'completed', message: 'reconciled: destination matches post_hash' };
    } catch { /* fallthrough */ }
  }
  if (!destPresent && sourcePresent) {
    return { status: 'failed', message: 'reconciled: never finished; source intact, dest missing' };
  }
  if (!destPresent && !sourcePresent) {
    return { status: 'failed', message: 'reconciled: ambiguous (both source and dest missing)' };
  }
  return { status: 'failed', message: 'reconciled: ambiguous' };
}
```

- [ ] **Step 3: Wire into `runServe`**

In `packages/engine/src/cli/serve.ts`, between `migrate(db)` and `createServer`, add:

```ts
import { reconcileOnStartup } from '../catalog/reconcile.js';
// ...
const reconciled = await reconcileOnStartup(db);
console.log(`Reconciled ${reconciled.scanned} in-progress operations (${reconciled.ambiguous} ambiguous)`);
```

- [ ] **Step 4: Run tests, PASS, commit:**

```
git add packages/engine/src/catalog/reconcile.ts packages/engine/src/catalog/reconcile.test.ts packages/engine/src/cli/serve.ts
git commit -m "feat(engine/catalog): add startup reconciliation for interrupted operations

Task: M7-T01"
```

### M7-T02: Daily catalog optimization

**Files:**
- Create: `packages/engine/src/catalog/optimizer.ts`
- Create: `packages/engine/src/catalog/optimizer.test.ts`
- Modify: `packages/engine/src/cli/serve.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, closeCatalog, type Catalog } from './connection.js';
import { migrate } from './migrate.js';
import { Optimizer } from './optimizer.js';

let dir: string; let db: Catalog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fileorg-opt-'));
  db = openCatalog(join(dir, 'cat.db'));
  migrate(db);
});

afterEach(() => { closeCatalog(db); rmSync(dir, { recursive: true, force: true }); });

describe('Optimizer', () => {
  it('runs PRAGMA optimize on first call and persists last-run timestamp', () => {
    const opt = new Optimizer(db);
    expect(opt.shouldRun()).toBe(true);
    opt.runIfDue();
    expect(opt.shouldRun()).toBe(false);
  });

  it('runs again after 24h elapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const opt = new Optimizer(db);
    opt.runIfDue();
    vi.setSystemTime(new Date('2024-01-02T01:00:00Z'));
    expect(opt.shouldRun()).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Implement `packages/engine/src/catalog/optimizer.ts`**

```ts
import type { Catalog } from './connection.js';

const KEY = 'lastOptimizedAt';
const INTERVAL_MS = 24 * 60 * 60 * 1000;

export class Optimizer {
  constructor(private readonly db: Catalog) {}

  shouldRun(): boolean {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
    if (!row) return true;
    const last = Date.parse(row.value);
    if (Number.isNaN(last)) return true;
    return Date.now() - last >= INTERVAL_MS;
  }

  runIfDue(): void {
    if (!this.shouldRun()) return;
    this.db.exec(`PRAGMA optimize`);
    this.db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(KEY, new Date().toISOString());
  }

  startInterval(intervalMs = INTERVAL_MS): NodeJS.Timeout {
    return setInterval(() => this.runIfDue(), intervalMs);
  }
}
```

- [ ] **Step 3: Wire into `runServe`** — `new Optimizer(db).runIfDue()` after migrations, and start the interval.

- [ ] **Step 4: Run tests, commit:**

```
git add packages/engine/src/catalog/optimizer.ts packages/engine/src/catalog/optimizer.test.ts packages/engine/src/cli/serve.ts
git commit -m "feat(engine/catalog): add daily PRAGMA optimize runner

Task: M7-T02"
```

### M7-T03: Free-space safety check

**Files:**
- Modify: `packages/engine/src/organize/applier.ts`
- Modify: `packages/engine/src/organize/applier.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `packages/engine/src/organize/applier.test.ts`:

```ts
it('aborts batch when destination drives lack free space', async () => {
  const drives = new DriveRepo(db);
  const d1Root = join(dir, 'd1');
  const d2Root = join(dir, 'd2');
  mkdirSync(d1Root, { recursive: true });
  mkdirSync(d2Root, { recursive: true });
  const d1 = drives.upsert({
    volumeSerial: 'V1', label: 'D1', currentLetter: null, kind: 'local',
    roles: [], totalBytes: 1_000_000_000, freeBytes: 1_000_000_000,
  }).id;
  const d2 = drives.upsert({
    volumeSerial: 'V2', label: 'D2', currentLetter: null, kind: 'local',
    roles: [], totalBytes: 200_000_000, freeBytes: 100_000_000,
  }).id;
  db.prepare(
    `INSERT INTO scans (id, drive_id, started_at, status, throttle_profile) VALUES (?, ?, ?, ?, ?)`,
  ).run('s1', d1, new Date().toISOString(), 'completed', 'balanced');
  const filesRepo = new FilesRepo(db);
  const srcPath = join(d1Root, 'a.bin');
  writeFileSync(srcPath, 'x');
  filesRepo.upsertOne({
    driveId: d1, path: srcPath, name: 'a.bin', extension: 'bin', sizeBytes: 1,
    category: 'image', sha256: 'h', mtime: '2024-01-01T00:00:00.000Z',
    ctime: '2024-01-01T00:00:00.000Z', exifDate: null, dateSource: 'mtime',
    width: null, height: null, durationSeconds: null, ntfsFileId: null,
    state: 'indexed', scanId: 's1',
  });
  const fileId = filesRepo.findByPath(d1, srcPath)!.id;
  const planned: PlannedOperation[] = [{
    fileId, ruleId: 'r', sourceDriveId: d1, sourcePath: srcPath,
    destDriveId: d2, destPath: join(d2Root, 'a.bin'),
    kind: 'cross-drive-move', estimatedBytes: 500_000_000,
  }];
  await expect(applyApprovedBatch({
    db, description: 'over capacity', operations: planned,
    driveRoots: new Map([[d1, d1Root], [d2, d2Root]]), chunkBytes: 1024,
  })).rejects.toThrow(/insufficient free space/);
  // Source still exists, no copy occurred.
  expect(existsSync(srcPath)).toBe(true);
  expect(existsSync(join(d2Root, 'a.bin'))).toBe(false);
});
```

Imports needed at the top of the test file (add if missing): `mkdirSync, writeFileSync, existsSync` from `node:fs`, `DriveRepo` from `../drives/repo.js`, `FilesRepo` from `../catalog/files-repo.js`, `PlannedOperation` from `./planner.js`.

- [ ] **Step 2: Implement free-space pre-flight in `applyApprovedBatch`**

Add at the top of the function, after the batch is created:

```ts
const drives = new DriveRepo(input.db).list();
const driveById = new Map(drives.map((d) => [d.id, d]));
const bytesPerDrive = new Map<string, number>();
for (const op of input.operations) {
  if (op.kind !== 'cross-drive-move') continue;
  bytesPerDrive.set(op.destDriveId, (bytesPerDrive.get(op.destDriveId) ?? 0) + op.estimatedBytes);
}
for (const [driveId, bytesNeeded] of bytesPerDrive) {
  const drive = driveById.get(driveId);
  if (!drive) continue;
  const safetyMargin = Math.floor(drive.freeBytes * 0.05);
  if (drive.freeBytes - safetyMargin < bytesNeeded) {
    new BatchesRepo(input.db).finish(batch.id, 'failed', { reason: 'insufficient free space' });
    throw new Error(`insufficient free space on ${drive.label}: need ${bytesNeeded} bytes, have ${drive.freeBytes - safetyMargin} bytes after 5% safety margin`);
  }
}
```

- [ ] **Step 3: Run tests, commit.**

### M7-T04: NAS disconnect handling

**Files:**
- Modify: `packages/engine/src/organize/move-cross-drive.ts`
- Modify: `packages/engine/src/organize/applier.ts`
- Modify: `packages/engine/src/api/server.ts`
- Modify: `packages/engine/src/organize/applier.test.ts`

- [ ] **Step 1: In `moveCrossDrive`,** wrap the `pipeline(...)` call with a try/catch that detects ENOENT/EBUSY/ETIMEDOUT/network-class errors and re-throws as a typed `DriveError`:

```ts
try {
  await pipeline(createReadStream(row.path), createWriteStream(input.destPath));
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'EBUSY' || code === 'ETIMEDOUT' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
    throw new DriveError('DRIVE_DISCONNECTED', `cross-drive copy failed: ${code}`, err);
  }
  throw err;
}
```

- [ ] **Step 2: In `applyApprovedBatch`,** when a `DriveError` of code `DRIVE_DISCONNECTED` is thrown, set the batch status to `paused-disconnected` and stop iterating instead of marking the op `failed`. Persist the remaining ops as `pending` so resume can pick them up.

- [ ] **Step 3: Add `OperationStatus` value** `'paused-disconnected'` to `@fileorganizer/shared` types and the SQL CHECK constraint via a new migration `0002_paused_disconnected.sql`:

```sql
-- Loosen the operations.status CHECK constraint by recreating the table
-- (SQLite doesn't support ALTER for CHECK).
CREATE TABLE operations_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    file_id INTEGER,
    source_drive_id TEXT,
    source_path TEXT,
    dest_drive_id TEXT,
    dest_path TEXT,
    pre_hash TEXT,
    post_hash TEXT,
    quarantine_path TEXT,
    status TEXT NOT NULL,
    error_message TEXT
);
INSERT INTO operations_new SELECT * FROM operations;
DROP TABLE operations;
ALTER TABLE operations_new RENAME TO operations;
CREATE INDEX idx_operations_batch ON operations (batch_id);
CREATE INDEX idx_operations_status ON operations (status);

CREATE TABLE batches_new (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO batches_new SELECT * FROM batches;
DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;
CREATE INDEX idx_batches_started_at ON batches (started_at);
```

> **Note:** v1 schema already has loose batch status. Migration is for operations only if your earlier CHECK was tight. Keep the file even if it's a no-op so the migration index advances cleanly.

- [ ] **Step 4: Add a `POST /api/organize/resume/:batchId` endpoint** that:
  - Loads the batch + its `pending` ops.
  - Re-runs `applyApprovedBatch` with just those ops, attached to the same batch.
  - Returns the new partial result.

- [ ] **Step 5: Add a test using a synthetic ENOENT** by deleting the source file mid-batch (between op N and op N+1). Assert the batch is `paused-disconnected`, ops after the error are `pending`. Resume after restoring the source; assert completion.

- [ ] **Step 6: Run tests, commit.**

### M7-T05: Keyboard shortcuts

**Files:**
- Create: `packages/ui/src/hooks/use-keyboard.ts`
- Create: `packages/ui/src/hooks/use-keyboard.test.tsx`
- Modify: `packages/ui/src/app.tsx`

- [ ] **Step 1: Implement the hook**

```ts
import { useEffect } from 'preact/hooks';
import { route } from 'preact-router';

export interface ShortcutMap {
  [chord: string]: () => void;
}

export function useKeyboardShortcuts(map: ShortcutMap): void {
  useEffect(() => {
    let lastKey = '';
    let lastTime = 0;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const now = Date.now();
      const chord = lastKey && now - lastTime < 1000 ? `${lastKey}${e.key}` : e.key;
      if (map[chord]) {
        e.preventDefault();
        map[chord]!();
        lastKey = '';
      } else {
        lastKey = e.key;
        lastTime = now;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map]);
}

export function defaultShortcuts(): ShortcutMap {
  return {
    'gd': () => route('/'),
    'gb': () => route('/browse'),
    'gs': () => route('/scans'),
    'go': () => route('/organize'),
    'gu': () => route('/duplicates'),
    'gh': () => route('/history'),
    'gq': () => route('/quarantine'),
    'gr': () => route('/roles'),
    'gt': () => route('/throttle'),
    '/': () => {
      const search = document.querySelector<HTMLInputElement>('input[type="search"]');
      search?.focus();
    },
  };
}
```

- [ ] **Step 2: Wire into `App`**

```tsx
import { useKeyboardShortcuts, defaultShortcuts } from './hooks/use-keyboard.js';
// ...inside App() {
useKeyboardShortcuts(defaultShortcuts());
```

- [ ] **Step 3: Test (via vitest with jsdom):**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/preact';
import { useKeyboardShortcuts } from './use-keyboard.js';

function Probe({ onG }: { onG: () => void }) {
  useKeyboardShortcuts({ 'gd': onG });
  return null;
}

describe('useKeyboardShortcuts', () => {
  it('fires the chord callback', () => {
    const cb = vi.fn();
    render(<Probe onG={cb} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run tests, commit:**

```
git add packages/ui/src/hooks/ packages/ui/src/app.tsx
git commit -m "feat(ui): add keyboard shortcuts (g+letter chord navigation)

Task: M7-T05"
```

### M7-T06: Install script polish (extract zips properly)

**Files:**
- Modify: `scripts/fetch-binaries.ts`
- Modify: `package.json` (add `unzipper` to devDependencies)

- [ ] **Step 1: Install `unzipper`**

```
npm install --save-dev unzipper @types/unzipper
```

- [ ] **Step 2: Replace the body of `fetch-binaries.ts`** so that after downloading the zip it extracts the binary into `packages/engine/bin/` and removes the zip:

```ts
import { mkdirSync, existsSync, createReadStream, createWriteStream, unlinkSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import unzipper from 'unzipper';

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
    outName: 'mediainfo.exe',
  },
];

async function ensureBinary(b: Binary): Promise<void> {
  const outPath = join(BIN_DIR, b.outName);
  if (existsSync(outPath)) {
    console.log(`[fetch-binaries] ${b.name} present at ${outPath}`);
    return;
  }
  mkdirSync(BIN_DIR, { recursive: true });
  console.log(`[fetch-binaries] downloading ${b.name}`);
  const res = await fetch(b.url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${b.url}`);
  const tmpZip = join(BIN_DIR, `${b.name}.zip`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmpZip));
  console.log(`[fetch-binaries] extracting ${b.archiveEntry} → ${outPath}`);
  await new Promise<void>((res2, rej) => {
    createReadStream(tmpZip)
      .pipe(unzipper.Parse())
      .on('entry', (entry) => {
        if (entry.path === b.archiveEntry || entry.path.endsWith(`/${b.archiveEntry}`)) {
          entry.pipe(createWriteStream(outPath)).on('finish', () => res2()).on('error', rej);
        } else {
          entry.autodrain();
        }
      })
      .on('error', rej);
  });
  unlinkSync(tmpZip);
  if (process.platform !== 'win32') chmodSync(outPath, 0o755);
}

async function main(): Promise<void> {
  let failed = 0;
  for (const b of BINARIES) {
    try { await ensureBinary(b); } catch (err) {
      console.error(`[fetch-binaries] ${b.name} failed: ${(err as Error).message}`);
      failed += 1;
    }
  }
  if (failed > 0) process.exit(1);
}

main();
```

- [ ] **Step 3: Smoke test** the script in a clean clone. If the download fails, the engine code already tolerates a missing mediainfo binary, so it's safe to skip and install manually.

- [ ] **Step 4: Commit:**

```
git add scripts/fetch-binaries.ts package.json package-lock.json
git commit -m "chore(scripts): extract mediainfo zip cleanly with unzipper

Task: M7-T06"
```

### M7-T07: README + user guide

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` with the full guide**

```markdown
# FileOrganizer

A local tool to organize personal files (photos, videos, documents) across multiple drives. See:
- Spec: [docs/superpowers/specs/2026-04-25-file-organizer-design.md](docs/superpowers/specs/2026-04-25-file-organizer-design.md)
- Plan: [docs/superpowers/plans/2026-04-25-file-organizer-implementation.md](docs/superpowers/plans/2026-04-25-file-organizer-implementation.md)

## Install (Windows-targeted, runs on POSIX too)

Requires Node 22 or 24 LTS (24 recommended) and git.

```
git clone <this-repo>
cd FileOrganizer
npm install
npm run fetch-binaries     # downloads mediainfo CLI into packages/engine/bin/
npm run build
```

## Daily use

```
# First time only:
npx tsx packages/engine/src/cli/index.ts init --catalog D:\FileOrganizer\catalog.db

# Scan a drive:
npx tsx packages/engine/src/cli/index.ts scan --path E:\

# Run the local UI:
npm run start
# Then open the URL printed in the console (typically http://127.0.0.1:<port>).
```

## What works in v1

- Drive registration and indexing (M0–M2).
- Read-only UI: Dashboard, Drives, Scans, Browse (M3).
- Duplicate detection and quarantine-based dedupe (M4).
- Rules + organize planner + cross-drive move with undo (M5).
- Drive role abstraction with priority/overflow + throttle profile schedule (M6).
- Startup reconciliation, free-space safety, NAS disconnect handling, keyboard shortcuts (M7).

## Troubleshooting

- **"catalog file is locked"** — another FileOrganizer process is running. Close it (`taskkill /IM node.exe` if necessary) and retry.
- **"NAS not reachable"** — your NAS drive went offline mid-scan. Reconnect the drive and resume the scan from the Scans screen.
- **"mediainfo not found"** — run `npm run fetch-binaries`. If the download fails (e.g., behind a corporate proxy), download `mediainfo.exe` from <https://mediaarea.net/en/MediaInfo> manually and place it in `packages/engine/bin/`.
- **"insufficient free space"** — the planner's pre-flight saw a destination drive too full for the proposed moves. Adjust the role's overflow drive priority, or move some files manually first.

## Architecture

Three packages in this monorepo:
- `packages/shared` — types and constants used by both engine and UI.
- `packages/engine` — Node 22 + TypeScript headless service. Owns SQLite catalog, scanning, organizing, deduping, and the local HTTP API.
- `packages/ui` — Preact + Vite frontend served by the engine on `127.0.0.1`.

See the spec linked above for the full architecture description.
```

- [ ] **Step 2: Commit:**

```
git add README.md
git commit -m "docs: replace stub README with v1 user guide

Task: M7-T07"
```

### M7-T08: Performance pass

**Files:**
- Modify: `packages/engine/src/scan/orchestrator.ts` (only if the perf review finds an N+1)
- Create: `docs/superpowers/notes-from-implementation.md` (if missing) and append findings.

- [ ] **Step 1: Profile a real scan**

Generate a synthetic 10 GB tree:

```
node --experimental-vm-modules -e "
const {writeFileSync, mkdirSync} = require('fs');
const {join} = require('path');
const root = '/tmp/perf-tree';
mkdirSync(root, {recursive:true});
const buf = Buffer.alloc(1024*1024); // 1 MB
for (let i = 0; i < 10000; i++) {
  const dir = join(root, String(Math.floor(i/100)));
  mkdirSync(dir, {recursive:true});
  writeFileSync(join(dir, i + '.jpg'), buf);
}
"
```

…then time a scan with `time npx tsx packages/engine/src/cli/index.ts scan --path /tmp/perf-tree --profile full-send --mediainfo /no/such`.

- [ ] **Step 2: Look for N+1 patterns**

In `orchestrator.ts`, the `quickCheck` and `bumpLastVerified` calls re-prepare statements per file via `better-sqlite3`'s `prepare()`. `better-sqlite3` already caches prepared statements internally if you keep the same SQL string, but you can also hoist the prepared statements once at the start of the loop. If profiling shows >5% time in `Statement.run`, refactor `FilesRepo` to expose pre-prepared statements via a long-lived `transaction` callback.

- [ ] **Step 3: Verify the unchanged-skip works at scale**

Re-run the scan a second time. Expected: zero re-hashes, completion in seconds, not minutes.

- [ ] **Step 4: API pagination check**

```
time curl "http://127.0.0.1:<port>/api/files?driveId=<id>&limit=1000&offset=0"
```

Expected: well under 100 ms for 1000 rows on an SSD-backed catalog.

- [ ] **Step 5: Document findings**

Append a `## Performance review (M7-T08)` section to `docs/superpowers/notes-from-implementation.md` with the timing numbers and any code changes made.

- [ ] **Step 6: Commit (docs only — perf fixes get separate commits):**

```
git add docs/superpowers/notes-from-implementation.md
git commit -m "docs: M7-T08 performance review findings

Task: M7-T08"
```

### M7-T09: Final milestone gate

- [ ] **Step 1:** `npm test` — PASS for all workspaces.
- [ ] **Step 2:** `npm run build` — PASS.
- [ ] **Step 3:** `npm run typecheck` — PASS.
- [ ] **Step 4:** `npm run lint` — PASS or warnings only.
- [ ] **Step 5: Manual end-to-end smoke test.** Walk through the script below in a fresh temp directory:
  1. `mkdir -p /tmp/v1-smoke/{d1,d2,d3}/data`
  2. Populate `d1/data` with two duplicates of the same JPEG.
  3. Populate `d2/data` with three documents.
  4. `npx tsx packages/engine/src/cli/index.ts init --pointer /tmp/v1-smoke/ptr.json --catalog /tmp/v1-smoke/cat.db`
  5. `npx tsx packages/engine/src/cli/index.ts scan --pointer /tmp/v1-smoke/ptr.json --path /tmp/v1-smoke/d1/data`
  6. `npx tsx packages/engine/src/cli/index.ts scan --pointer /tmp/v1-smoke/ptr.json --path /tmp/v1-smoke/d2/data`
  7. `npm run start` — open the UI.
  8. Define role `archive` with priority `[d3, d2]`.
  9. Create rule: images → `archive`, template `Photos/{year}/{month:02}/{filename}`.
  10. Run planner; observe operations targeting d3.
  11. Approve cross-drive batch; verify files moved into `/tmp/v1-smoke/d3/Photos/...`.
  12. Open Duplicates; observe the JPEG duplicate group; apply dedup.
  13. Open Quarantine; observe the quarantined non-keeper.
  14. Open History; click Undo on the move batch; provide drive roots; verify files restored.
  15. Stop the server (Ctrl+C). Restart with `npm run start`. Reconciliation log line should report `0 ambiguous`.

- [ ] **Step 6: Tag and merge:**

```
git checkout main
git merge --no-ff m7-polish -m "merge: M7 polish + v1"
git tag -a v0.1.0 -m "FileOrganizer v0.1.0"
```


---

## Section 9 — Acceptance criteria for v1

The user accepts v1 when, all together:

1. `npm test` passes across all three workspaces.
2. `npm run build` succeeds across all three workspaces.
3. `fileorganizer init` creates a catalog at a user-chosen path and writes the pointer file.
4. `fileorganizer scan <path>` indexes files in the path, applies category and exclusion filters, and reports a non-zero `indexed` count for a directory containing personal-content files.
5. `fileorganizer serve` boots an HTTP server on `127.0.0.1`, the UI opens in the browser, and Dashboard/Drives/Scans/Browse/Organize/Duplicates/History/Quarantine all render data.
6. Running the dedupe planner against a catalog with known duplicates produces a non-empty plan with sensible keepers chosen.
7. Applying a dedupe batch moves non-keepers to `_FileOrganizer_quarantine/<batch-id>/...` and updates `files.state` to `quarantined`.
8. A cross-drive move batch copies, verifies hash, quarantines the source, and updates the catalog atomically.
9. `undo <batch-id>` reverses a dedupe batch and a cross-drive move batch correctly.
10. Throttle profiles can be switched mid-scan and the active profile is reflected in scan throughput.
11. Restarting the engine after a kill mid-batch reconciles the catalog cleanly with no manual SQL.

---

## Section 10 — Glossary

- **Catalog** — the SQLite database that holds all persistent state.
- **Drive ID** — the engine's internal stable UUID for a physical drive, persistent across drive-letter changes (looked up by volume serial).
- **Drive root** — the absolute filesystem path that maps to the root of a drive (e.g., `E:\` on Windows, or a temp directory in tests).
- **Rule** — a user-defined match + destination policy that the planner uses to decide where files should live.
- **Role** — a named drive group (`media-archive`, `active-documents`, etc.) used in rule destinations so rules don't hardcode drive IDs.
- **Plan** — the planner's output: a list of `PlannedOperation`s describing what would happen if applied.
- **Batch** — a grouping of `operations` with a UUID, used for atomic apply, audit, and undo.
- **Quarantine** — per-drive tool-managed folder (`_FileOrganizer_quarantine`) holding files removed by the tool. Files there are recoverable until purged.
- **Auto-apply** — same-drive moves under rules with `move_policy='same-drive-auto'` execute without batch approval.
- **Review queue** — cross-drive moves and any rule with `move_policy='cross-drive-review'` or `'always-review'` land here pending user approval.
- **Reconciliation** — engine-startup pass that fixes catalog rows whose ops were `in-progress` when the engine last stopped.

---

*End of plan body. Addenda below.*

---

## Section 11 — Spec coverage addenda

A self-review against the spec turned up five requirements that were not adequately covered by the milestone tasks above. The tasks below are extensions, not replacements — slot them into the milestone branch indicated.

### M2-T03b: Hardlink (NTFS file ID) capture in scan (extends §M2-T03 / spec §8.4)

When scanning on Windows, populate `files.ntfs_file_id` so the dedupe detection can later exclude same-physical-file groups.

- **Files:** modify `packages/engine/src/scan/orchestrator.ts`.
- **Add a helper** `packages/engine/src/scan/ntfs-id.ts`:

```ts
import { execFileSync } from 'node:child_process';

export function readNtfsFileId(path: string): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Item -LiteralPath '${path.replace(/'/g, "''")}' -Force).LinkType, (fsutil file queryfileid '${path.replace(/'/g, "''")}')`],
      { encoding: 'utf-8', timeout: 5000 },
    );
    const match = /File ID is\s+(0x[0-9A-Fa-f]+)/.exec(out);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
```

- **Wire into the orchestrator:** in the per-file branch, call `readNtfsFileId(entry.path)` and pass into `upsertOne` as `ntfsFileId`.
- **Test:** on POSIX, the helper returns null and the orchestrator continues to work. On Windows, hardlinked files in a fixture share the same returned ID. (On non-Windows hosts only the POSIX-null path is exercised.)
- **Commit** as `M2-T03b`.

### M4-T03b: Hardlink exclusion in duplicate detection (spec §8.4)

Modify `detectDuplicates` to exclude groups where every copy shares the same `(drive_id, ntfs_file_id)` — those are literal same-physical-file references, no space to reclaim.

- **Files:** `packages/engine/src/dedupe/detect.ts`, `packages/engine/src/dedupe/detect.test.ts`.
- **Add test:** four files with the same hash; two share an `ntfs_file_id` on `d1`, two are real distinct copies on `d2`. The group should still be detected (because of the d2 distinct copies), but the d1 hardlinked pair should not be proposed for removal.
- **Implementation sketch:** after fetching `copies` for each group, filter out copies whose `(drive_id, ntfs_file_id)` matches another already-included copy when both are non-null.
- **Commit** as `M4-T03b`.

### M5-T05b: Filename collision policy in movers (spec §6.4)

Both `moveSameDrive` and `moveCrossDrive` must handle destination collisions per spec:

1. Same hash at destination → quarantine the source, mark op `completed-via-existing`, do not copy.
2. Different hash at destination → suffix the source's filename with `_1`, `_2`, etc. until unique.
3. Never overwrite.

- **Files:** modify `packages/engine/src/organize/move-same-drive.ts`, `packages/engine/src/organize/move-cross-drive.ts`, plus their tests.

Add a shared helper `packages/engine/src/organize/collision.ts`:

```ts
import { existsSync, statSync } from 'node:fs';
import { extname, basename, join, dirname } from 'node:path';
import { hashFile } from '../scan/hasher.js';

export type CollisionDecision =
  | { kind: 'use-as-is'; path: string }
  | { kind: 'suffix'; path: string }
  | { kind: 'same-content'; path: string };

export async function resolveCollision(destPath: string, sourceHash: string, chunkBytes: number): Promise<CollisionDecision> {
  if (!existsSync(destPath)) return { kind: 'use-as-is', path: destPath };
  const existingHash = await hashFile(destPath, { chunkBytes, sleepMs: 0 });
  if (existingHash === sourceHash) return { kind: 'same-content', path: destPath };
  const dir = dirname(destPath);
  const ext = extname(destPath);
  const stem = basename(destPath, ext);
  for (let i = 1; i < 1000; i += 1) {
    const candidate = join(dir, `${stem}_${i}${ext}`);
    if (!existsSync(candidate)) return { kind: 'suffix', path: candidate };
  }
  throw new Error(`exhausted suffixes for ${destPath}`);
}
```

- Update both movers to call `resolveCollision` first and branch on the decision. Same-content path: source goes to quarantine (cross-drive) or simply gets deleted via quarantine (same-drive); op recorded as `completed-via-existing`.
- Add tests:
  1. Cross-drive move with same-content collision → no copy performed, source quarantined, op `completed-via-existing`.
  2. Cross-drive move with different-content collision → destination written with `_1` suffix, both files end up distinct.
- **Commit** as `M5-T05b`.

### M5-T07b: Dry-run mode (spec §6.8)

`applyApprovedBatch` accepts a `dryRun: true` flag. When set:

- The batch is created with `kind='move'` but every operation row is written with `status='dry-run'`.
- No filesystem writes occur.
- Free-space pre-flight (M7-T03) still runs.
- Hash re-verification of source files still runs (so dry-run surfaces hash drift).

- **Files:** modify `packages/engine/src/organize/applier.ts`, add tests.
- **API:** add `?dryRun=true` to `POST /api/organize/apply`.
- **UI:** "Dry-run" button next to "Apply" in the Plan tab.
- **Commit** as `M5-T07b`.

### M5-T01b: Default organizing rules seeded on init (spec §6.9)

When `runInit` is called, after migrations and settings load, if the `rules` table is empty, seed the default ruleset:

- Photos: `images` → role `media-archive`, template `Photos/{year}/{month:02}/{filename}`, `cross-drive-review`.
- Video: `video` → role `media-archive`, template `Videos/{year}/{month:02}/{filename}`, `cross-drive-review`.
- Documents recent: `[document, spreadsheet, presentation, ebook]` with `dateAfter = today - 2 years` → role `active-documents`, template `Documents/{category}/{filename}`, `cross-drive-review`.
- Documents archive: same categories with `dateBefore = today - 2 years` → role `document-archive`, template `Documents/_archive/{year}/{category}/{filename}`, `cross-drive-review`.
- Audio: same hybrid recent/archive treatment → roles `active-documents` / `document-archive`.

- **Files:** `packages/engine/src/cli/init.ts`, plus a new `packages/engine/src/rules/defaults.ts` exporting `seedDefaultRules(db)`.
- **Test:** `runInit` on a fresh catalog produces 6 rules with priorities 100, 110, 200, 210, 300, 310. A second `runInit` does not re-seed (the table is already non-empty).
- **Commit** as `M5-T01b`.

### M5-T10b: Rule shadow detection (spec §6.7)

The Plan tab in the Organize UI shows, per rule, two numbers:

- **Would match:** count of files that match this rule's `match` clause in isolation (ignoring priority order).
- **Actually matches:** count of files this rule wins under priority ordering.

When the gap is large, the rule is being shadowed by a higher-priority rule. Display a small warning indicator next to the rule.

- **Files:** modify `packages/engine/src/api/server.ts` (planner endpoint returns per-rule counts) and `packages/ui/src/routes/organize.tsx`.
- **Implementation:** the planner already iterates files and assigns to first match. To produce "would match," run a second pass that counts every rule independently. Cache both numbers in the plan response.
- **Test:** two rules where rule B has stricter match than rule A but lower priority → B's "actual" is 0 while "would match" is positive.
- **Commit** as `M5-T10b`.

---

*End of plan.*

