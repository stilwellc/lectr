/**
 * Backfill Wright/Rago estimates. The artist-search crawl path returns items
 * without estimate_low/high, so Rago lots show "estimate on request" (0%
 * coverage) and some Wright lots too — but each lot's AUCTION page carries the
 * full estimate in its Inertia data-page (props.items, keyed by lot id). This
 * fetches those auction pages and backfills estimateLow/High (+ USD/native
 * twins; Wright/Rago publish USD) onto the corpus, then rebuilds served payloads.
 * Run: npx tsx scripts/fix-wright-rago-estimates.ts
 */
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { runMarketBuild } from './build-market';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const readGz = (f: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) => fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Lot = { id: string; auctionHouse?: string; status?: string; url?: string; estimateLow?: number | null; estimateHigh?: number | null; [k: string]: unknown };

/** Pull every lot's estimate_low/high from an auction page's Inertia data-page,
 *  keyed by the numeric lot id (which the corpus id embeds: rago-390797). */
async function auctionEstimates(auctionUrl: string): Promise<Record<string, { low: number; high: number }>> {
  const r = await fetch(auctionUrl, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const $ = cheerio.load(await r.text());
  const dp = $('#app').attr('data-page');
  if (!dp) return {};
  const props = JSON.parse(dp)?.props || {};
  const out: Record<string, { low: number; high: number }> = {};
  const take = (item: any) => {
    if (!item || item.estimate_low == null || item.estimate_high == null) return;
    const key = String(item.fd_key || item.id);
    out[key] = { low: Number(item.estimate_low), high: Number(item.estimate_high) };
  };
  // Rago: props.items is an object keyed by id. Wright variants: paginator.data
  // / sorted_items.results (arrays) or results_grouped sessions.
  if (props.items && typeof props.items === 'object') Object.values(props.items).forEach(take);
  const pag = props?.results?.primary_results?.paginator?.items || props?.results?.primary_results?.sorted_items?.results;
  if (pag?.data && Array.isArray(pag.data)) pag.data.forEach(take);
  if (Array.isArray(props.results_grouped)) for (const g of props.results_grouped) for (const s of Object.values(g.sessions || {})) for (const it of ((s as any).items || [])) take(it);
  return out;
}

function setEstimate(lot: Lot, low: number, high: number) {
  const L = lot as Record<string, unknown>;
  L.estimateLow = low; L.estimateHigh = high;          // client-read aliases
  L.estLowUsd = low; L.estHighUsd = high;              // engine (USD)
  L.estLowNative = low; L.estHighNative = high;         // native == USD for Wright/Rago
  if (!L.nativeCurrency) L.nativeCurrency = 'USD';
}

(async () => {
  const lots: Lot[] = readGz('lots.json');
  const arch: Lot[] = readGz('sold-archive.json');
  const all = lots.concat(arch); // element refs shared with source arrays

  const targets = all.filter(l =>
    (l.auctionHouse === 'Rago' || l.auctionHouse === 'Wright') &&
    !((l.estimateLow || 0) > 0) && !!l.url && /\/\d+$/.test(l.url));
  console.log(`[fix] ${targets.length} Wright/Rago lots missing an estimate`);

  // group by auction page (strip the trailing /<lotNumber>)
  const byAuction = new Map<string, Lot[]>();
  for (const l of targets) {
    const auc = l.url!.replace(/\/\d+$/, '');
    (byAuction.get(auc) || byAuction.set(auc, []).get(auc)!).push(l);
  }
  console.log(`[fix] across ${byAuction.size} auction pages`);

  let filled = 0, failed = 0;
  for (const [auc, group] of Array.from(byAuction)) {
    try {
      const est = await auctionEstimates(auc);
      for (const l of group) {
        const key = l.id.replace(/^(rago|wright)-/, '').replace(/~$/, '');
        const e = est[key];
        if (e && e.low > 0 && e.high > 0) { setEstimate(l, e.low, e.high); filled++; }
      }
    } catch (e) { failed++; console.warn(`[fix]   ${auc}: ${(e as Error).message}`); }
    await sleep(150);
  }
  console.log(`[fix] filled ${filled} estimates, ${failed} auction pages unreachable`);

  writeGz('lots.json', lots);
  writeGz('sold-archive.json', arch);
  console.log('[fix] corpus written · rebuilding served payloads…');
  runMarketBuild();
})();
