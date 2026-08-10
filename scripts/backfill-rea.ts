// REA FULL-DEPTH backfill — concurrent itemid enumeration over the whole range.
// REA is plain HTTP (no CF), so it parallelizes freely; a bounded pool makes
// ~210K lots feasible in ~1-2h instead of ~30h sequential. Batches + incremental
// writes = durable. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/backfill-rea.ts --start 1 --end 210000 --conc 12 --write
import type { AuctionLot } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { getHtml, mapPool, writeMergedSegment, settledOnly, installCrashGuard } from './lib/sports-crawl';
import { parseReaLot } from './crawl-rea';

const LOT_BASE = 'https://bid.collectrea.com/lots';
const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d; };

async function main() {
  const write = process.argv.includes('--write');
  if (write) installCrashGuard('REA-BF');
  const start = arg('start', 1);
  const end = arg('end', 210000);
  const conc = arg('conc', 12);
  const batch = arg('batch', 3000);
  console.log(`[rea-bf] itemid ${start}..${end}, concurrency ${conc}, batches of ${batch}`);

  let sold = 0, miss = 0, total = 0;
  for (let lo = start; lo <= end; lo += batch) {
    const hi = Math.min(lo + batch - 1, end);
    const ids: number[] = [];
    for (let id = lo; id <= hi; id++) ids.push(id);
    const lots = (await mapPool(ids, conc, async (id) => {
      const html = await getHtml(`${LOT_BASE}/${id}`);
      if (!html) return null;
      try { return parseReaLot(html, id); } catch { return null; }
    })).filter((x): x is AuctionLot => !!x);
    sold += lots.length; miss += ids.length - lots.length;
    if (write) {
      const { good } = settledOnly(lots);
      const clean = good.filter((l) => assertInvariants([l]).fatal.length === 0); // drop any stray FATAL, keep the rest
      if (clean.length) { const r = writeMergedSegment('rea', clean); total = r.total; }
    }
    console.log(`  [rea-bf] ${lo}..${hi}: +${lots.length} sold (${sold} total sold, segment ${total})`);
  }
  console.log(`[rea-bf] DONE: ${sold} sold, ${miss} skipped/gaps`);
}
main().catch((e) => { console.error('[rea-bf] fatal', e); process.exit(1); });
