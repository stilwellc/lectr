/**
 * W32 (Oct 11 2026) — prove the live-lot engine gate is IDENTICAL under the
 * estimate carry: validate-engine run twice on the same corpus — the W24
 * engine, then the W32 engine (estCarry) — and the two reports diffed with
 * their clocks stripped. The carry is ×1 on every holdout lot by
 * construction (the replay's index is built as of the lot's own quarter), so
 * every value, tier, flag and gate line must match byte for byte.
 *
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/oneoff/qa/w32-gate-identity.ts [--sample 6000]
 */
import * as fs from 'fs';
import * as path from 'path';
import { runValidateEngine } from '../../validate-engine';
import { readCorpus } from '../../corpus-io';
import { setEngineFlags, ENGINE_FLAGS_W24, ENGINE_FLAGS_W32 } from '../../../app/lib/value';
import type { AuctionLot } from '../../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
const sample = Number(arg('sample') ?? 6000);

(async () => {
  const t0 = Date.now();
  const corpus = readCorpus() as unknown as AuctionLot[];
  console.log(`[w32-gate] ${corpus.length} rows · ${Math.round((Date.now() - t0) / 1000)}s`);
  const dir = path.join(process.cwd(), 'data', 'qa');
  fs.mkdirSync(dir, { recursive: true });
  const a = path.join(dir, 'w32-validate-w24.json'), b = path.join(dir, 'w32-validate-w32.json');
  setEngineFlags(ENGINE_FLAGS_W24);
  const ra = runValidateEngine({ corpus, sample, json: a });
  setEngineFlags(ENGINE_FLAGS_W32);
  const rb = runValidateEngine({ corpus, sample, json: b });
  setEngineFlags(null);
  const strip = (p: string) => { const c = JSON.parse(fs.readFileSync(p, 'utf8')); delete c.generatedAt; delete c.ranAt; delete c.elapsedMs; return JSON.stringify(c); };
  const same = strip(a) === strip(b);
  console.log(`[w32-gate] W24 vs W32 validate-engine report: ${same ? 'IDENTICAL' : 'DIFFERENT'} (failures ${ra.failures} / ${rb.failures}) · ${Math.round((Date.now() - t0) / 1000)}s`);
  if (!same) process.exit(2);
})().catch(e => { console.error(e); process.exit(1); });
