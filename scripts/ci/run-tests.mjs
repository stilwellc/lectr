#!/usr/bin/env node
// `npm test` — runs every test file under scripts/__tests__/ and app/**/__tests__/
// with the node:test runner, TypeScript loaded through tsx. Files are found
// here (not by a shell glob) so a tree with no app tests yet does not fail
// on an unmatched pattern. Each file runs in its own process; a file that
// throws, fails an assert, or exits non-zero fails the run.
//
// RAY_SKIP_MAIN=1: several scripts under test (assemble.ts, …) run their
// main() on import unless it is set.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const TEST_RE = /\.test\.(m?[jt]sx?)$/;

function walk(dir, inTests, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, inTests || e.name === '__tests__', out);
    else if (inTests && TEST_RE.test(e.name)) out.push(path.relative(ROOT, p));
  }
}

const files = [];
walk(path.join(ROOT, 'scripts', '__tests__'), true, files);
walk(path.join(ROOT, 'app'), false, files);
files.sort();

if (!files.length) {
  console.log('[test] no test files found under scripts/__tests__ or app/**/__tests__');
  process.exit(0);
}
console.log(`[test] ${files.length} file(s):\n  ${files.join('\n  ')}`);

const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, RAY_SKIP_MAIN: '1' },
});
process.exit(r.status ?? 1);
