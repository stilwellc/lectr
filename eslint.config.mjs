// ESLint flat config (eslint 9) — Next's own presets + a few repo rules.
//
// eslint-config-next 16 ships flat configs: core-web-vitals (next, react,
// react-hooks, import, jsx-a11y) and typescript (typescript-eslint
// recommended). Rules that fire on large amounts of legacy code are set to
// "warn", never "off", so the count stays visible while `npm run lint`
// (scripts/ci/lint.mjs) gates on errors only.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores([
    'node_modules/**', '.next/**', 'out/**', 'build/**', 'public/**', 'data/**',
    'coverage/**', 'shots/**', '.claude/**', 'next-env.d.ts', '**/*.d.ts',
    // research harnesses, tsconfig-excluded and allowed to drift (see scripts/oneoff/README.md)
    'scripts/oneoff/qa/**',
  ]),
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      // typography: thin / hair spaces inside strings, templates and JSX text are deliberate
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipJSXText: true, skipComments: true }],
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }],

      // legacy-noise rules: visible as warnings, not gating
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true,
      }],
      '@typescript-eslint/no-require-imports': 'warn',
      'prefer-const': 'warn',
      // react-hooks 7 React-Compiler rules: new with the Next 16 preset, 69
      // pre-existing hits in app/ components — surfaced, fixed incrementally.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // global-error.tsx needs a full-reload <a href="/"> (the router may be the
      // thing that broke); the other hit is a same-page #hash link.
      '@next/next/no-html-link-for-pages': 'warn',
    },
  },
  {
    // scripts/ is Node tooling, not React: functions named use*() are not hooks.
    files: ['scripts/**', 'tests/**', '*.config.*'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  {
    // CommonJS files (maker-worker.cjs, next/postcss configs).
    files: ['**/*.cjs', 'next.config.js', 'postcss.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
