// ESLint flat config — Next (App Router) + TypeScript.
//
// Deliberately small, and built only from plugins eslint-config-next already
// installs (@typescript-eslint/*, eslint-plugin-react-hooks,
// @next/eslint-plugin-next), so it works unchanged on eslint 8.57 (run with
// ESLINT_USE_FLAT_CONFIG=true by scripts/ci/lint.mjs) and on eslint 9.
// Rules that fire on large amounts of legacy code are set to "warn", never
// "off", so the count stays visible while `npm run lint` gates on errors only.
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

const nodeGlobals = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  require: 'readonly', module: 'writable', exports: 'writable', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', fetch: 'readonly', AbortController: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', structuredClone: 'readonly',
  performance: 'readonly', queueMicrotask: 'readonly', AbortSignal: 'readonly',
};
const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  innerHeight: 'readonly', innerWidth: 'readonly', scrollTo: 'readonly',
  localStorage: 'readonly', getComputedStyle: 'readonly', requestAnimationFrame: 'readonly',
};

const tsRecommended = tsPlugin.configs['flat/recommended'];

export default [
  {
    ignores: [
      'node_modules/**', '.next/**', 'out/**', 'build/**', 'public/**', 'data/**',
      'coverage/**', 'shots/**', '.claude/**', 'next-env.d.ts', '**/*.d.ts',
      // research harnesses, tsconfig-excluded and allowed to drift (see scripts/oneoff/README.md)
      'scripts/oneoff/qa/**',
    ],
  },
  js.configs.recommended,
  ...tsRecommended,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...nodeGlobals, ...browserGlobals },
    },
    plugins: { '@next/next': nextPlugin },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // typography: thin / hair spaces inside strings, templates and JSX text are deliberate
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipJSXText: true, skipComments: true }],
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }],

      // legacy-noise rules: visible as warnings, not gating
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true,
      }],
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-cond-assign': ['error', 'except-parens'],
      'prefer-const': 'warn',
    },
  },
  {
    // React rules only where React lives (scripts/ has plain functions named use*).
    files: ['app/**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // TypeScript resolves identifiers itself; core no-undef misfires on types.
    files: ['**/*.{ts,tsx}'],
    rules: { 'no-undef': 'off' },
  },
  {
    // CommonJS files (maker-worker.cjs, next/postcss configs).
    files: ['**/*.cjs', 'next.config.js', 'postcss.config.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off', '@typescript-eslint/no-var-requires': 'off' },
  },
];
