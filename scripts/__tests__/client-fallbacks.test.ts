/**
 * (Oct 6 2026, pricing wave 4) NO CLIENT-SIDE VALUE FALLBACKS.
 *
 * A page prints the ENGINE's numbers (lot.value, built and backtested at
 * build time) or nothing. The client comp readers — appraiseLot,
 * signalWithPool, soldCompBand — computed a second number over whatever
 * slice of the corpus the browser had loaded, on exactly the lots the engine
 * had declined to value. They stay in app/lib/comps.ts for the build
 * (scripts/r2/comps.ts, emit-page-stats.ts, build-upcoming.ts); nothing under
 * app/** may import them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const BANNED = ['appraiseLot', 'signalWithPool', 'soldCompBand'];

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(e.name)) out.push(p);
  }
}

test('no file under app/ imports a client comp reader (appraiseLot / signalWithPool / soldCompBand)', () => {
  const files: string[] = [];
  walk(path.join(ROOT, 'app'), files);
  const defining = path.join(ROOT, 'app', 'lib', 'comps.ts');
  const hits: string[] = [];
  for (const f of files) {
    if (f === defining) continue;
    const src = fs.readFileSync(f, 'utf8');
    // every import / re-export clause (multi-line braces included) and every
    // dynamic import's destructure
    const clauses = src.match(/\b(?:import|export)\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"][^'"]+['"]/g) || [];
    const dyn = src.match(/\{[^}]*\}\s*=\s*(?:await\s+)?import\(/g) || [];
    for (const c of [...clauses, ...dyn]) {
      for (const name of BANNED) if (new RegExp(`\\b${name}\\b`).test(c)) hits.push(`${path.relative(ROOT, f)}: ${name}`);
    }
    // a namespace import of comps.ts calling one through the namespace
    if (/import\s+\*\s+as\s+(\w+)\s+from\s+['"][^'"]*lib\/comps['"]/.test(src)) {
      for (const name of BANNED) if (new RegExp(`\\.${name}\\s*\\(`).test(src)) hits.push(`${path.relative(ROOT, f)}: *.${name}`);
    }
  }
  assert.deepEqual(hits, [], `client comp readers imported under app/: ${hits.join(', ')}`);
});
