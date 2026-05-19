import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  // Base recommended (non-type-checked) rules
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      // Type-checked rules: high-value subset that catches real bugs.
      // Full recommendedTypeChecked was not enabled because no-unsafe-* produces
      // excessive noise on legitimate use of untyped external libraries (exifr,
      // better-sqlite3 raw rows, MediaInfo subprocess output). These two rules
      // catch the load-bearing correctness issues without the noise.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          // JSX event-handler attributes (onClick, onChange, etc.) accept async
          // functions in Preact — false positives otherwise.
          checksVoidReturn: { attributes: false },
        },
      ],
    },
  },
  // Engine HTTP path: ban synchronous directory reads. Recursing
  // readdirSync blocks Node's event loop, stalling every concurrent API
  // request. Use fs.promises.readdir (await) instead. Boot-time code
  // (CLI commands, migrations, pointer-file resolution) is exempt — it
  // runs before the server accepts requests, so blocking is fine there.
  {
    files: ['packages/engine/src/**/*.ts'],
    ignores: [
      'packages/engine/src/cli/**',
      'packages/engine/src/catalog/migrate.ts',
      'packages/engine/src/catalog/locator.ts',
      'packages/engine/src/log.ts',
      '**/*.test.ts',
      '**/__fixtures__/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="readdirSync"]',
          message:
            'readdirSync blocks the Node event loop. On the engine HTTP path, recursing through it stalls every concurrent API request. Use fs.promises.readdir (await readdir) instead. (Boot-only code is exempt via eslint.config.js; if you have a one-shot use case, add an eslint-disable-next-line with a clear reason.)',
        },
        {
          selector: 'CallExpression[callee.name="readFileSync"]',
          message:
            'readFileSync blocks the Node event loop. Prefer fs.promises.readFile (await readFile) on the engine HTTP path. (Boot-only code is exempt via eslint.config.js.)',
        },
      ],
    },
  },
);
