// Huggins & Scott crawler — ISOLATED ('hugginsscott' segment; not in nightly/
// assemble). REA-owned, runs the SAME Laravel stack + <dt>/<dd> block, so it
// reuses parseReaLot. Difference is the URL scheme: the sold ARCHIVE lives on
// the main domain hugginsandscott.com/auction/{YR}/{Month}/{lot#}/{slug}
// (server-rendered, robots allow-all, plain curl 200), enumerated via /search →
// month indexes → paginated lots. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-hugginsscott.ts --months 2 [--write]
import * as cheerio from 'cheerio';
import type { AuctionLot } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { getHtml, writeMergedSegment, writeMergedSegmentWithLive, settledOnly, liveOnly, installCrashGuard, mapPool } from './lib/sports-crawl';
import { parseReaLot, crawlReaLive } from './crawl-rea';
import { readSegment } from './corpus-io';

const BASE = 'https://hugginsandscott.com';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

/** month-index URLs like /auction/2005/September/ from the /search seed */
async function monthIndexes(): Promise<string[]> {
  const html = await getHtml(`${BASE}/search`);
  if (!html) return [];
  const $ = cheerio.load(html);
  const set = new Set<string>();
  $('a[href*="/auction/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/auction\/\d{4}\/[A-Za-z]+\/?$/);
    if (m) set.add(href.startsWith('http') ? href : BASE + href);
  });
  return Array.from(set);
}

/** lot detail URLs from one month index, paginating ?page=N until empty */
async function lotUrlsForMonth(monthUrl: string, maxPages = 300): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await getHtml(`${monthUrl.replace(/\/$/, '')}/?page=${page}`);
    if (!html) break;
    const $ = cheerio.load(html);
    const found: string[] = [];
    $('a[href*="/auction/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      // detail = /auction/{yr}/{mo}/{lot#}/{slug}
      if (/\/auction\/\d{4}\/[A-Za-z]+\/\d+\/[a-z0-9-]+/i.test(href)) {
        out.push(href.startsWith('http') ? href : BASE + href);
        found.push(href);
      }
    });
    if (!found.length) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return Array.from(new Set(out));
}

function idFromUrl(url: string): string {
  const m = url.match(/\/auction\/(\d{4})\/([A-Za-z]+)\/(\d+)\//);
  return m ? `${m[1]}-${m[2].toLowerCase()}-${m[3]}` : url.replace(/[^0-9a-z]+/gi, '-').slice(-40);
}

async function main() {
  const monthsWanted = arg('months', 2);
  const delayMs = arg('delay', 200);
  const idx = await monthIndexes();
  // --oldest crawls the settled tail (the newest month is the CURRENT, unsold
  // auction — 0 realized prices). Sort by the year in the URL, not lexically.
  const yr = (u: string) => parseInt((u.match(/\/auction\/(\d{4})\//) || [])[1] || '0', 10);
  const sorted = idx.sort((a, b) => yr(a) - yr(b)); // oldest → newest
  const oldest = process.argv.includes('--oldest');
  const months = oldest ? sorted.slice(0, monthsWanted) : sorted.reverse().slice(0, monthsWanted);
  console.log(`[H&S] ${idx.length} month indexes; crawling ${oldest ? 'oldest' : 'newest'} ${monthsWanted}: ${months.map(m => m.split('/auction/')[1]).join(', ')}`);

  const write = process.argv.includes('--write');
  if (write) installCrashGuard('H&S');
  const lots: AuctionLot[] = [];
  let miss = 0;
  const conc = arg('conc', 1);
  for (const mu of months) {
    const urls = await lotUrlsForMonth(mu);
    console.log(`  [H&S] ${mu}: ${urls.length} lot urls`);
    // concurrent per-lot fetch (H&S is plain HTTP); conc 1 = sequential (default)
    const monthLots = (await mapPool(urls, conc, async (u) => {
      const html = await getHtml(u);
      if (!html) return null;
      try { return parseReaLot(html, idFromUrl(u), 'Huggins & Scott', u); } catch { return null; }
    })).filter((x): x is AuctionLot => !!x);
    miss += urls.length - monthLots.length;
    lots.push(...monthLots);
    if (conc <= 1) await new Promise(r => setTimeout(r, delayMs));
    // INCREMENTAL: persist after each month so a mid-run crash keeps progress
    if (write && monthLots.length) {
      const { good } = settledOnly(monthLots);
      if (good.length) { const r = writeMergedSegment('hugginsscott', good); console.log(`    [H&S] segment now ${r.total} lots`); }
    }
  }
  console.log(`[H&S] parsed ${lots.length} sold lots (${miss} skipped)`);

  // ── live leg: H&S live bidding runs on bid.hugginsandscott.com — the SAME
  // Livewire stack as bid.collectrea.com (REA owns H&S), so the REA live
  // crawler transfers verbatim. Pre-open the grid renders an "opening soon"
  // shell with zero lot links → 0 upcoming lots, which is a fact, not an error.
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  if (process.argv.includes('--live')) {
    const prevUpcoming = (readSegment('hugginsscott') as unknown as AuctionLot[]).filter(l => (l as { status?: string }).status === 'upcoming');
    const r = await crawlReaLive('https://bid.hugginsandscott.com', 'Huggins & Scott', prevUpcoming);
    liveOk = r.ok;
    lots.push(...r.resolved);
    const lg = liveOnly(r.live);
    if (lg.dropped) console.log(`[H&S] dropped ${lg.dropped} malformed live lots`);
    liveLots = lg.good;
    console.log(`[H&S] live: ${liveLots.length} upcoming lots (grid ${liveOk ? 'ok' : 'FAILED — keeping prior snapshot'})`);
  }

  const report = assertInvariants(lots.concat(liveLots));
  console.log(`[H&S] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));
  const byCat: Record<string, number> = {};
  for (const l of lots) { const c = (l as { subCat?: string }).subCat || '?'; byCat[c] = (byCat[c] || 0) + 1; }
  console.log('[H&S] by category:', byCat);

  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[H&S] dropped ${dropped} unsettled/future-dated lots (upcoming months)`);
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) { console.error(`[H&S] refusing to write: ${rep.fatal.length} FATALs remain after filtering`); rep.fatal.slice(0, 5).forEach(f => console.error('  ', f)); process.exit(1); }
    const r = process.argv.includes('--live')
      ? writeMergedSegmentWithLive('hugginsscott', good, liveLots, liveOk)
      : { ...writeMergedSegment('hugginsscott', good), upcoming: undefined as number | undefined };
    console.log(`[H&S] merged into segment 'hugginsscott': +${r.added} new, ${r.total} total${r.upcoming !== undefined ? `, ${r.upcoming} upcoming` : ''}.`);
  } else {
    const s = lots[0];
    if (s) console.log('[H&S] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 50), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd }, null, 0));
    console.log('[H&S] dry run (pass --write to persist)');
  }
}
main().catch(e => { console.error('[H&S] fatal', e); process.exit(1); });
