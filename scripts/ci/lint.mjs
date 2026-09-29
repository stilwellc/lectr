#!/usr/bin/env node
// `npm run lint` — ESLint over the repo IF a flat config exists. Until one
// lands (eslint.config.{js,mjs,cjs,ts}), this prints a notice and exits 0 so
// CI stays green; the moment the config is committed, the same command lints
// for real and fails on errors. Extra args pass through (e.g. --fix).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const configs = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts'];
const found = configs.find(f => fs.existsSync(path.join(ROOT, f)));

if (!found) {
  const msg = 'no ESLint flat config (eslint.config.*) yet — lint skipped';
  console.log(process.env.GITHUB_ACTIONS ? `::notice title=lint skipped::${msg}` : `[lint] ${msg}`);
  process.exit(0);
}

console.log(`[lint] eslint via ${found}`);
const r = spawnSync('npx', ['--no-install', 'eslint', '.', ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ESLINT_USE_FLAT_CONFIG: 'true' },
});
process.exit(r.status ?? 1);
