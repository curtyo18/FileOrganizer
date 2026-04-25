# Implementation blockers

## Blocker: npm registry unreachable from cloud sandbox

- **Date:** 2026-04-25
- **Task:** M0-T03 (prereq for all subsequent tasks)
- **What I tried:**
  - `npm install` at the workspace root with the plan's verbatim `package.json`.
  - Probed `https://registry.npmjs.org/` and `https://registry.npmjs.org/@types/node` directly via `curl`.
  - Probed alternates: `registry.yarnpkg.com`, `nodejs.org`, `npm.pkg.github.com`, `mirror.npmjs.org`.
  - Probed common local mirror ports on `127.0.0.1` (80, 443, 4873, 8080, 8081, 8888, 5000, 3000) — all closed.
  - Probed the only listening local proxy at `127.0.0.1:44013` with several path shapes (`/`, `/npm`, `/registry/`, `/@types/node`, `/_npm/registry/`, `/-/all`) — all return HTTP 400 "Invalid path format". That proxy is configured by the harness only as the git remote (`origin = http://local_proxy@127.0.0.1:44013/git/curtyo18/FileOrganizer`); it does not pass through arbitrary HTTP.
  - Inspected `/opt/nvm/.npmrc` — only contains `package-lock=false`; no registry override.
  - No `.npmrc` anywhere under `/home`, `/root`, or the project tree.
- **What I observed:**
  - `npm install` exits with `npm error code E403` and `npm error 403 403 Forbidden - GET https://registry.npmjs.org/@types%2fnode`.
  - Direct `curl https://registry.npmjs.org/` returns body `Host not in allowlist` (sandbox firewall, not an npm-side rejection).
  - Same `Host not in allowlist` for every external host except the configured git proxy.
- **Why this blocks the plan:**
  M0-T03 step 2 (`npm install`) is the gate that brings TypeScript, vitest, prettier, eslint, `tsx`, and (later) `better-sqlite3`, `hono`, `exifr`, `sharp`, `uuid`, `zod` into the workspace. Without those, no later task can run its red/green test cycle (no vitest), build (no tsc), or even typecheck (no typescript binary). The plan tags M0-T03 `(prereq)`, and §0.8 #1 says I stop when a prereq is BLOCKED.
- **Proposed resolution (do not act on without authorization):**
  - **Option A (preferred):** allowlist `registry.npmjs.org` (and `registry.yarnpkg.com` for `sharp`'s install scripts) for outbound HTTPS in the sandbox, then re-run from M0-T03 step 2.
  - **Option B:** stand up a local Verdaccio (or similar) mirror at a known port, prepopulate it with the dependency closure, and add `registry=http://127.0.0.1:<port>/` to a tracked `.npmrc` so future cloud sessions resolve packages locally.
  - **Option C:** commit a vendored `node_modules/` (large; not recommended) or a vendored `.tgz` cache plus an offline `npm install --offline --prefer-offline` flow.
  - I have **not** taken any of these — each materially changes the plan or the environment and §0.5 forbids guessing.

## Status when halting

- Branch: `claude/review-fileorganizer-docs-iYrrV` (per the task brief; not the plan's `main`/`m1-foundations` because the user explicitly overrode that).
- Completed: M0-T01 (repo init artifacts), M0-T02 (already in repo on session start).
- Partial: M0-T03 — root `package.json` written verbatim from the plan; `npm install` failed; no `package-lock.json` produced.
- Not started: M0-T04 onward.
