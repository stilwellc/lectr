// Huggins & Scott crawler — ISOLATED ('hugginsscott' segment; not in nightly/
// assemble). REA-owned, runs the SAME Laravel stack + <dt>/<dd> block, so it
// reuses parseReaLot. Difference is the URL scheme: the sold ARCHIVE lives on
// the main domain hugginsandscott.com/auction/{YR}/{Month}/{lot#}/{slug}
// (server-rendered, robots allow-all, plain curl 200), enumerated via /search →
// month indexes → paginated lots. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-hugginsscott.ts --months 2 [--write]
// Image backfill (the archive CDN is hs-image-archive.*; the parser only knew
// rea-image-archive.* until Sep 27 2026, so ~50K settled rows are imageless):
//   npx tsx scripts/crawl-hugginsscott.ts --months 200 --refetch-imageless --write
// re-reads ONLY the settled rows that have no image (exact close dates kept).
import * as cheerio from 'cheerio';
import type { AuctionLot } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { getHtml, writeMergedSegment, writeMergedSegmentWithLive, settledOnly, liveOnly, installCrashGuard, mapPool } from './lib/sports-crawl';
import { parseReaLot, crawlReaLive, openRowsForResolve, settledBidIds, summarizeSettled, reportReaLegHealth, type ReaLiveResult } from './crawl-rea';
import { readSegment } from './corpus-io';
import { reportAndExit } from './lib/leg-health';

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
  // A null page mid-pagination is NOT end-of-month: CI datacenter IPs get
  // rate-limited around page ~41, and treating the 429 as "done" capped every
  // month at exactly 400 lots (40 pages × 10) since 2022-11 (Aug 13 audit).
  // Back off and retry twice before believing the month ended.
  let pageMisses = 0;
  for (let page = 1; page <= maxPages; page++) {
    const html = await getHtml(`${monthUrl.replace(/\/$/, '')}/?page=${page}`);
    if (!html) {
      if (++pageMisses <= 3) { await new Promise(r => setTimeout(r, 4000 * pageMisses)); page--; continue; }
      console.log(`  [H&S] ${monthUrl} pagination truncated at page ${page} after retries`);
      break;
    }
    pageMisses = 0;
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
    await new Promise(r => setTimeout(r, 350));
  }
  return Array.from(new Set(out));
}

function idFromUrl(url: string): string {
  const m = url.match(/\/auction\/(\d{4})\/([A-Za-z]+)\/(\d+)\//);
  return m ? `${m[1]}-${m[2].toLowerCase()}-${m[3]}` : url.replace(/[^0-9a-z]+/gi, '-').slice(-40);
}

/** chronological rank of a month index url (/auction/2026/summer/): year,
 *  then the month/season inside it. The old sort compared the YEAR only and
 *  then reversed, which put a year's months OLDEST-first — so `--months N`
 *  could skip the newest (current) month entirely. */
const MONTH_RANK: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, winter: 2, mar: 3, march: 3, apr: 4, april: 4, spring: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, summer: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, fall: 10, autumn: 10, nov: 11, november: 11, dec: 12, december: 12,
};
export function monthIndexRank(u: string): number {
  const m = u.match(/\/auction\/(\d{4})\/([A-Za-z]+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 100 + (MONTH_RANK[m[2].toLowerCase()] ?? 6);
}

async function main() {
  const monthsWanted = arg('months', 2);
  const delayMs = arg('delay', 200);
  const idx = await monthIndexes();
  if (!idx.length) console.error('[H&S] /search returned no month indexes — archive leg skipped');
  // newest-first by (year, month/season). The newest index IS normally the
  // most recently CLOSED sale (the running auction lives on bid.* only), so it
  // must be covered — its lots are the freshest realized prices.
  const sorted = idx.slice().sort((a, b) => monthIndexRank(b) - monthIndexRank(a)); // newest → oldest
  const oldest = process.argv.includes('--oldest');
  const months = oldest ? sorted.slice().reverse().slice(0, monthsWanted) : sorted.slice(0, monthsWanted);
  console.log(`[H&S] ${idx.length} month indexes; crawling ${oldest ? 'oldest' : 'newest'} ${monthsWanted}: ${months.map(m => m.split('/auction/')[1]).join(', ')}`);

  const write = process.argv.includes('--write');
  if (write) installCrashGuard('H&S');
  const lots: AuctionLot[] = [];
  let miss = 0, skippedKnown = 0;
  const conc = arg('conc', 1);
  // A settled archive lot never changes: skip ids the segment already holds as
  // sold (the nightly used to re-fetch ~4.9K archive pages for +0 new). Pass
  // --refetch to force a full re-read of the selected months.
  // --refetch-imageless re-reads only settled rows that have NO image (the
  // archive CDN pattern missed hs-image-archive until Sep 27 2026: 49,901 rows)
  const refetch = process.argv.includes('--refetch');
  const refetchImageless = process.argv.includes('--refetch-imageless');
  const segRows = readSegment('hugginsscott') as unknown as AuctionLot[];
  const haveSold = new Set(
    segRows
      .filter(l => (l as { status?: string }).status === 'sold')
      .filter(l => !(refetchImageless && !l.imageUrl))
      .map(l => l.id),
  );
  const archiveById = new Map(segRows.filter(l => l.status === 'sold').map(l => [l.id, l]));
  let archFetched = 0;
  for (const mu of months) {
    const urls = await lotUrlsForMonth(mu);
    const todo = refetch ? urls : urls.filter(u => !haveSold.has(`hugginsscott-${idFromUrl(u)}`));
    skippedKnown += urls.length - todo.length;
    console.log(`  [H&S] ${mu}: ${urls.length} lot urls (${todo.length} to fetch, ${urls.length - todo.length} already settled in segment)`);
    // concurrent per-lot fetch (H&S is plain HTTP); conc 1 = sequential (default).
    // --delay applies PER LOT (it used to sleep once per month, i.e. never
    // between the lot pages that actually draw the rate limit).
    const monthLots = (await mapPool(todo, conc, async (u) => {
      const html = await getHtml(u);
      await new Promise(r => setTimeout(r, delayMs));
      if (!html) return null;
      archFetched++;
      try { return parseReaLot(html, idFromUrl(u), 'Huggins & Scott', u); } catch { return null; }
    }, 'H&S archive')).filter((x): x is AuctionLot => !!x);
    miss += todo.length - monthLots.length;
    // a re-read of an ALREADY exact-dated row (--refetch*) must not knock it
    // back to the archive's month stub — keep the real close + time
    for (const ml of monthLots) {
      const prev = archiveById.get(ml.id) as (AuctionLot & { datePrecision?: string; saleDateTime?: string }) | undefined;
      if (prev && prev.datePrecision !== 'month' && prev.saleDateTime) Object.assign(ml, { saleDate: prev.saleDate, saleDateTime: prev.saleDateTime, datePrecision: undefined, fxAsOf: (prev as { fxAsOf?: string }).fxAsOf });
      archiveById.set(ml.id, ml);
    }
    lots.push(...monthLots);
    // INCREMENTAL: persist after each month so a mid-run crash keeps progress
    if (write && monthLots.length) {
      const { good } = settledOnly(monthLots);
      if (good.length) { const r = writeMergedSegment('hugginsscott', good); console.log(`    [H&S] segment now ${r.total} lots`); }
    }
  }
  console.log(`[H&S] parsed ${lots.length} sold lots (${miss} skipped, ${skippedKnown} already in segment)`);

  // ── live leg: H&S live bidding runs on bid.hugginsandscott.com — the SAME
  // Livewire stack as bid.collectrea.com (REA owns H&S), so the REA live
  // crawler transfers verbatim — including its earned-ok gate: a 0-id grid
  // ("opening soon" shell) or pages that parse to nothing keeps last night's
  // upcoming snapshot instead of evicting it; the resolve pass still settles
  // closed rows to sold (the REA Summer 2026 lesson, Sep 2 2026).
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  let liveStats: ReaLiveResult['stats'] | null = null;
  if (process.argv.includes('--live')) {
    const seg = readSegment('hugginsscott') as unknown as AuctionLot[];
    const r = await crawlReaLive('https://bid.hugginsandscott.com', 'Huggins & Scott', openRowsForResolve(seg), settledBidIds(seg));
    liveOk = r.ok;
    liveStats = r.stats;
    // closed live lots settle under the ARCHIVE id (parseReaBidPage) — when
    // the archive row already exists, the live read re-dates it to the lot's
    // real close and adds the image, but the archive's own category read
    // (artist/subCat), year and cert parse are kept. Prices must agree; on a
    // mismatch the archive figure wins (it is what the house publishes).
    let mismatch = 0, redated = 0;
    for (const l of r.resolved) {
      const prev = archiveById.get(l.id) as (AuctionLot & { realizedNative?: number; subCat?: string }) | undefined;
      if (!prev) continue;
      redated++;
      const fresh = l as AuctionLot & { realizedNative?: number; saleDateTime?: string };
      if (l.status === 'sold' && prev.realizedNative && fresh.realizedNative !== prev.realizedNative) {
        if (mismatch++ < 5) console.warn(`[H&S] price mismatch ${l.id}: bid page $${fresh.realizedNative} vs archive $${prev.realizedNative} — keeping the archive row (image added only)`);
        Object.assign(l, { ...prev, saleDateTime: (prev as { saleDateTime?: string | null }).saleDateTime ?? null, imageUrl: prev.imageUrl || l.imageUrl });
        continue;
      }
      Object.assign(l, {
        artist: prev.artist, subCat: prev.subCat, year: prev.year,
        gradeLabel: (prev as { gradeLabel?: string }).gradeLabel ?? (l as { gradeLabel?: string }).gradeLabel,
        authCert: (prev as { authCert?: string }).authCert ?? (l as { authCert?: string }).authCert,
        authConfidence: (prev as { authConfidence?: string }).authConfidence ?? (l as { authConfidence?: string }).authConfidence,
      });
    }
    if (redated) console.log(`[H&S] live read re-dated ${redated} archive row(s) to their real close (${mismatch} price mismatch${mismatch === 1 ? '' : 'es'})`);
    lots.push(...r.resolved);
    const lg = liveOnly(r.live);
    if (lg.dropped) console.log(`[H&S] dropped ${lg.dropped} malformed live lots`);
    liveLots = lg.good;
    console.log(`[H&S] live: ${liveLots.length} upcoming lots, ${r.resolved.length} settled (grid ${liveOk ? 'ok' : 'FAILED — keeping prior snapshot, stale rows age out'})`);
    summarizeSettled('H&S', r.resolved);
  }

  // leg health: the archive leg is healthy when it had nothing new to read or
  // parsed what it fetched; the live leg per crawlReaLive's earned gate
  const archiveParsed = lots.length - (liveStats ? (liveStats.sold + liveStats.unsold + liveStats.resolveSettled) : 0);
  const archReason = !idx.length ? 'archive /search returned no month indexes'
    : (archFetched >= 20 && archiveParsed === 0 ? `archive fetched ${archFetched} lot pages and parsed 0` : null);
  reportReaLegHealth('hugginsscott', liveStats, { fetched: archFetched, parsed: archiveParsed, reason: archReason });

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
    if (rep.fatal.length) {
      console.error(`[H&S] refusing to write: ${rep.fatal.length} FATALs remain after filtering`); rep.fatal.slice(0, 5).forEach(f => console.error('  ', f));
      reportAndExit({ house: 'hugginsscott', fetched: archFetched + (liveStats?.fetched || 0), parsed: lots.length + liveLots.length, settled: 0, reason: `refused write: ${rep.fatal.length} invariant FATALs` });
    }
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
main().catch(e => { console.error('[H&S] fatal', e); reportAndExit({ house: 'hugginsscott', fetched: 0, parsed: 0, settled: 0, reason: `crashed: ${String((e as Error)?.message || e).slice(0, 200)}` }); });
