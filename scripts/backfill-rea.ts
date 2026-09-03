// REA FULL-DEPTH backfill — concurrent itemid enumeration over a range.
// REA is plain HTTP (no CF); a bounded pool + a per-request delay keeps it
// polite on a small-business server (the old 12-way zero-delay pool is gone —
// Sep 2 2026). A closed lot's bid.collectrea.com/lots/{id} 302s to the
// collectrea.com/archives/… page (getHtml follows it; parseReaLot reads the
// <dt>Sold For</dt> block there). Batches + incremental writes = durable. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/backfill-rea.ts --start 185118 --end 195743 --conc 4 --delay 150 --write
// (REA Summer 2026 recovery = exactly that window; the workflow
//  .github/workflows/backfill-rea.yml dispatches it with the R2 pull/push.)
import type { AuctionLot } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { getHtml, mapPool, writeMergedSegment, settledOnly, installCrashGuard, FETCH_STATS } from './lib/sports-crawl';
import { parseReaLot } from './crawl-rea';

const LOT_BASE = 'https://bid.collectrea.com/lots';
const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d; };

async function main() {
  const write = process.argv.includes('--write');
  if (write) installCrashGuard('REA-BF');
  const start = arg('start', 1);
  const end = arg('end', 210000);
  const conc = arg('conc', 4);
  const delayMs = arg('delay', 150);
  const batch = arg('batch', 3000);
  console.log(`[rea-bf] itemid ${start}..${end}, concurrency ${conc}, ${delayMs}ms per request, batches of ${batch}`);

  let sold = 0, miss = 0, total = 0, fetchedAll = 0;
  for (let lo = start; lo <= end; lo += batch) {
    const hi = Math.min(lo + batch - 1, end);
    const ids: number[] = [];
    for (let id = lo; id <= hi; id++) ids.push(id);
    let fetched = 0;
    const lots = (await mapPool(ids, conc, async (id) => {
      const html = await getHtml(`${LOT_BASE}/${id}`);
      await new Promise(r => setTimeout(r, delayMs)); // per-request pacing, inside the pool
      if (!html) return null;
      fetched++;
      try { return parseReaLot(html, id); } catch { return null; }
    }, 'rea-bf')).filter((x): x is AuctionLot => !!x);
    fetchedAll += fetched;
    sold += lots.length; miss += ids.length - lots.length;
    if (write) {
      const { good } = settledOnly(lots);
      const clean = good.filter((l) => assertInvariants([l]).fatal.length === 0); // drop any stray FATAL, keep the rest
      if (clean.length) { const r = writeMergedSegment('rea', clean); total = r.total; }
    }
    console.log(`  [rea-bf] ${lo}..${hi}: fetched ${fetched}/${ids.length} · +${lots.length} sold (${sold} total sold, segment ${total})`);
    // silent-zero tripwire: pages answered but NOTHING parsed → the archive
    // markup moved (or we're walled) — say so loudly rather than "no sales"
    if (fetched >= 50 && lots.length === 0) console.error(`  [rea-bf] WARNING: ${fetched} pages fetched in ${lo}..${hi} but 0 parsed as sold — check parseReaLot against the live markup`);
  }
  console.log(`[rea-bf] DONE: ${sold} sold, ${miss} skipped/gaps, ${fetchedAll} pages fetched, ${FETCH_STATS.non2xx} non-2xx, ${FETCH_STATS.rateLimited} rate-limit backoffs`);
}
main().catch((e) => { console.error('[rea-bf] fatal', e); process.exit(1); });
