// Migration note: Vitest 4 deprecates defineWorkspace() in favour of a
// `projects` array inside vitest.config.ts.
// See: https://vitest.dev/guide/workspace.html
// Migration is deferred to its own effort — not bundled into this audit.
// Our pinned version: ^2.1.0 (currently resolves to 2.1.9).
// Latest published version at audit time: 4.1.6.
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/engine',
  'packages/ui',
]);
