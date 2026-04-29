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
];
