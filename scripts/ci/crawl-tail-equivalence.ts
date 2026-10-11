/**
 * crawl-tail-equivalence.ts — proves the segmented crawl leg's tail change
 * (scripts/ray-crawl.ts, Oct 11 2026) writes the SAME segment bytes.
 *
 * Before: a house leg ran buildUpcoming → buildBacktest (a full replay whose
 * backtest.json + state never leave the runner) → writeSegment. After: the
 * leg runs buildUpcoming → stampVectors (prepare()'s only in-place mutation:
 * `_v`/`_vn` on every lot) → writeSegment. This loads a real segment twice,
 * runs both tails, and compares the exact NDJSON writeSegment would write.
 *
 *   npx tsx scripts/ci/crawl-tail-equivalence.ts <segment.ndjson.gz> [more…]
 *
 * Exit 0 = byte-identical for every segment given; 1 = a difference (the
 * first differing row + keys are printed). Builders write only under a temp
 * dir. No network.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import type { AuctionLot } from '../../app/types';

function load(file: string): AuctionLot[] {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const out: AuctionLot[] = [];
  let s = 0;
  while (s < buf.length) {
    let e = buf.indexOf(10, s);
    if (e < 0) e = buf.length;
    if (e > s) out.push(JSON.parse(buf.toString('utf8', s, e)));
    s = e + 1;
  }
  return out;
}

/** writeSegment's exact serialization (scripts/corpus-io.ts) */
const lines = (lots: AuctionLot[]) => lots.map(l => JSON.stringify(l) + '\n');
const sha = (ls: string[]) => { const h = crypto.createHash('sha256'); for (const l of ls) h.update(l); return h.digest('hex'); };

async function main() {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!files.length) { console.error('usage: crawl-tail-equivalence.ts <segment.ndjson.gz> [more…]'); process.exit(2); }
  const { buildUpcoming } = await import('../build-upcoming');
  const { buildBacktest } = await import('../build-backtest');
  const { stampVectors } = await import('../backtest-core');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-tail-'));
  const cwd = process.cwd();
  for (const d of ['a', 'b']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
  process.chdir(tmp); // buildBacktest's state file resolves from cwd
  let bad = 0;
  try {
    for (const f of files) {
      const abs = path.resolve(cwd, f);
      // AFTER (stamp only) first: it touches no engine module state
      const b = load(abs);
      let t = Date.now();
      buildUpcoming(path.join(tmp, 'b'), b);
      stampVectors(b);
      const tB = (Date.now() - t) / 1000;
      const lb = lines(b);
      // BEFORE (full replay)
      const a = load(abs);
      t = Date.now();
      buildUpcoming(path.join(tmp, 'a'), a);
      try { buildBacktest(path.join(tmp, 'a'), a); } catch (e) { console.log(`[tail-eq] (buildBacktest threw, as the crawl tolerates: ${(e as Error).message.slice(0, 120)})`); }
      const tA = (Date.now() - t) / 1000;
      const la = lines(a);
      const same = la.length === lb.length && sha(la) === sha(lb);
      console.log(`[tail-eq] ${path.basename(f)}: ${la.length} rows · before ${tA.toFixed(1)}s · after ${tB.toFixed(1)}s · ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
      if (!same) {
        bad++;
        const i = la.findIndex((x, k) => x !== lb[k]);
        if (i >= 0) {
          const A = JSON.parse(la[i]), B = JSON.parse(lb[i]);
          const keys = Array.from(new Set([...Object.keys(A), ...Object.keys(B)])).filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k]));
          console.log(`  first diff row ${i} (${A.id}): keys ${keys.join(', ')}`);
        }
      }
    }
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
