/**
 * Resolve stuck-pending Christie's lots against onlineonly.christies.com.
 *
 * www.christies.com artist pages never publish results for online-only sales,
 * so their lots rot as 'upcoming' (results-pending) forever. But onlineonly
 * serves realized prices publicly: every lot page — and, better, the sale's
 * own browse page — embeds `window.chrComponents` JSON with price_realised /
 * price_realised_txt per lot. Sale-page pagination is CUMULATIVE (page N
 * returns lots 1..N×84), so one sale resolves in ~3 fetches:
 *   lot sso (→ lot page, carries the sale sso link with the required SaleID)
 *   → sale sso (→ /s/<slug>/lots/<datasource>) → ?page=<total_pages>.
 * Per-lot fetch is the fallback for lots a sale page misses (www lot pages
 * also embed the price, in window.chrComponents.lotHeader_<id>).
 *
 * Doctrine (mirrors ray-crawl): price realised is buyer-inclusive →
 * premiumNative, converted via the dated-FX stampMoney shape; a resultless
 * lot within RESULT_PENDING_MS of its close stays held as pending; past the
 * window it settles to bought_in with null money.
 *
 * DRY-RUN by default — prints what it would flip. `--write` rewrites the
 * christies segment (local only; the nightly owns the R2 push).
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/resolve-christies.ts [--write]
 */
import { readSegment, writeSegment } from './corpus-io';
import { toUsdDated, fxRateFor } from '../app/lib/normalize';
import type { AuctionLot, Currency, PriceBasis } from '../app/types';

const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CONC = 4;
const RESULT_PENDING_MS = 14 * 86_400_000; // same window as ray-crawl
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// same currency sniff as ray-crawl's parseChristiesCurrency
function parseChristiesCurrency(txt: string): Currency {
  if (/HK\$|HKD/.test(txt)) return 'HKD';
  if (/£|GBP/.test(txt)) return 'GBP';
  if (/€|EUR/.test(txt)) return 'EUR';
  if (/CHF/.test(txt)) return 'CHF';
  if (/CN¥|RMB|CNY/.test(txt)) return 'CNY';
  if (/AU\$|AUD/.test(txt)) return 'AUD';
  return 'USD';
}

// ── money stamping — byte-identical to ray-crawl's stampMoney (not exported
// there; importing ray-crawl would run its main). Sold branch only + the
// non-sold null-price branch for bought-ins.
function stampSold(cur: Currency, saleDate: string, premiumNative: number, estLowNative: number | null, estHighNative: number | null) {
  const { rate, asOf } = fxRateFor(cur, saleDate);
  const conv = (n: number | null) => toUsdDated(n, cur, saleDate).usd;
  const estLowUsd = conv(estLowNative), estHighUsd = conv(estHighNative);
  const realizedUsd = conv(premiumNative);
  return {
    nativeCurrency: cur,
    hammerNative: null, premiumNative, realizedNative: premiumNative,
    buyerPremiumPct: null,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd: null, premiumUsd: realizedUsd, realizedUsd,
    estLowNative, estHighNative, estLowUsd, estHighUsd,
    priceBasis: 'realized' as PriceBasis,
    currency: cur, estimateLow: estLowUsd, estimateHigh: estHighUsd,
    hammerPrice: null, premiumPrice: premiumNative, priceUsd: realizedUsd,
  };
}
// bought_in: the non-sold-null-price invariant — strip every realized field
function stripMoney(l: Record<string, unknown>) {
  for (const f of ['realizedUsd', 'realizedNative', 'hammerUsd', 'hammerNative', 'premiumUsd', 'premiumNative', 'hammerPrice', 'premiumPrice', 'priceUsd', 'priceBasis']) l[f] = null;
}

// ── page plumbing ──────────────────────────────────────────────────────────
async function get(url: string): Promise<{ finalUrl: string; html: string } | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return { finalUrl: r.url, html: await r.text() };
  } catch { return null; }
}

/** Parse the FULL `window.chrComponents = {…}` assignment (onlineonly pages).
 *  Defensive: bad/missing JSON → null, never throws. */
function parseChrComponents(html: string): Record<string, any> | null {
  const m = html.match(/window\.chrComponents\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1].replace(/;\s*$/, '')); } catch { return null; }
}

// the raw fields we read off an embedded lot record (both sale + lot pages)
type RawLot = { lot_id_txt?: string; object_id?: string | number; url?: string; price_realised?: string | number | null; price_realised_txt?: string | null; estimate_txt?: string | null; estimate_low?: string | number | null; estimate_high?: string | number | null; lot_withdrawn?: boolean };

/** Deep-hunt every object carrying a price_realised key (order-preserving). */
function huntRawLots(o: unknown, out: RawLot[] = []): RawLot[] {
  if (Array.isArray(o)) { for (const x of o) huntRawLots(x, out); return out; }
  if (o && typeof o === 'object') {
    if ('price_realised' in (o as object) && ('lot_id_txt' in (o as object) || 'estimate_txt' in (o as object))) out.push(o as RawLot);
    for (const v of Object.values(o as object)) huntRawLots(v, out);
  }
  return out;
}

/** Fetch a whole online-only sale's results via ONE stuck lot's sso url:
 *  lot page → sale sso link (SaleID required; SaleNumber alone bounces to the
 *  calendar) → sale browse page → last cumulative page = every lot. Returns
 *  lot-number → raw lot, or null when any hop fails. */
async function fetchSaleResults(seedLotUrl: string): Promise<Map<string, RawLot> | null> {
  const lotPage = await get(seedLotUrl);
  if (!lotPage) return null;
  const ssoM = lotPage.html.match(/https:\/\/onlineonly\.christies\.com\/sso\?SaleID=\d+&(?:amp;)?SaleNumber=\d+/);
  if (!ssoM) return null;
  const salePage = await get(ssoM[0].replace('&amp;', '&'));
  if (!salePage || !/\/lots\//.test(salePage.finalUrl)) return null;
  const readLots = (html: string): { lots: RawLot[]; totalPages: number } | null => {
    const d = parseChrComponents(html);
    const data = d?.lots?.data;
    if (!Array.isArray(data?.lots)) return null;
    return { lots: data.lots, totalPages: data.total_pages || 1 };
  };
  let page = readLots(salePage.html);
  if (!page) return null;
  if (page.totalPages > 1) { // cumulative: the last page carries the whole sale
    await sleep(300);
    const last = await get(`${salePage.finalUrl.split('?')[0]}?page=${page.totalPages}&sortby=lotnumber`);
    const full = last && readLots(last.html);
    if (full) page = full;
  }
  const byLotNo = new Map<string, RawLot>();
  for (const l of page.lots) if (l.lot_id_txt) byLotNo.set(String(l.lot_id_txt), l);
  return byLotNo;
}

/** Per-lot fallback: fetch the lot's own page (onlineonly sso OR www lot page)
 *  and pick ITS record out of the embedded JSON — match on the final url's
 *  object id so a sold "related lot" in a carousel can't masquerade as it. */
async function fetchLotResult(url: string): Promise<RawLot | null> {
  const page = await get(url);
  if (!page) return null;
  const objectId = (page.finalUrl.match(/\/(\d+)(?:[?#]|$)/) || [])[1] || (url.match(/lot-(\d+)/) || [])[1] || '';
  // www lot pages embed the price in window.chrComponents.lotHeader_<id>
  const header = page.html.match(/window\.chrComponents\.lotHeader_\d+\s*=\s*(\{[\s\S]*?\});/);
  if (header) { try { const h = JSON.parse(header[1]); if ('price_realised' in h) return h as RawLot; } catch { /* fall through */ } }
  const d = parseChrComponents(page.html);
  if (!d) return null;
  const candidates = huntRawLots(d);
  return candidates.find(c => objectId && (String(c.object_id || '') === objectId || String(c.url || '').includes(`/${objectId}`))) || null;
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  const lots = readSegment('christies') as unknown as AuctionLot[];
  const today = new Date().toISOString().slice(0, 10);
  const stuck = lots.filter(l => l.status === 'upcoming' && (l.saleDate || '').slice(0, 10) < today
    && /(?:onlineonly|www)\.christies\.com/.test(l.url || ''));
  console.log(`[resolve] ${lots.length} christies lots · ${stuck.length} stuck pending (sale closed, no result)${WRITE ? '' : ' · DRY-RUN'}`);
  if (!stuck.length) return;

  // group by sale number — christies-<saleNo>.<lotNo> ids / ObjectID sso params
  const saleNoOf = (l: AuctionLot) => (l.url.match(/ObjectID=(\d+)\./) || l.id.match(/christies-(\d+)\./) || [])[1] || null;
  const lotNoOf = (l: AuctionLot) => (l.url.match(/LotNumber=(\d+)/) || l.id.match(/christies-\d+\.(\d+)/) || [])[1] || null;
  const bySale = new Map<string, AuctionLot[]>();
  const loners: AuctionLot[] = []; // no derivable sale/lot number → per-lot fetch
  for (const l of stuck) {
    const s = saleNoOf(l), n = lotNoOf(l);
    if (s && n) (bySale.get(s) || bySale.set(s, []).get(s)!).push(l);
    else loners.push(l);
  }
  console.log(`[resolve] ${bySale.size} sales to batch-fetch, ${loners.length} per-lot fallbacks`);

  // (lot, raw|null after fetch attempts, pageFailed)
  const results = new Map<string, RawLot | null>();
  let pagesFailed = 0;
  const failedLots = new Set<string>();

  // per-sale batches (one lot page + sale page + last page ≈ 3 fetches/sale)
  const sales = Array.from(bySale.entries());
  for (let i = 0; i < sales.length; i += CONC) {
    await Promise.all(sales.slice(i, i + CONC).map(async ([saleNo, saleLots]) => {
      const map = await fetchSaleResults(saleLots[0].url);
      if (!map) { pagesFailed++; saleLots.forEach(l => loners.push(l)); return; } // sale fetch failed → per-lot fallback
      let missed = 0;
      for (const l of saleLots) {
        const raw = map.get(lotNoOf(l)!);
        if (raw) results.set(l.id, raw); else { loners.push(l); missed++; }
      }
      console.log(`[resolve]   sale ${saleNo}: ${map.size} lots on page, matched ${saleLots.length - missed}/${saleLots.length}`);
    }));
    await sleep(400);
  }

  // per-lot fallback for loners + sale misses
  for (let i = 0; i < loners.length; i += CONC) {
    await Promise.all(loners.slice(i, i + CONC).map(async l => {
      const raw = await fetchLotResult(l.url);
      if (raw) results.set(l.id, raw);
      else { pagesFailed++; failedLots.add(l.id); }
    }));
    await sleep(400);
  }

  // ── adjudicate ──
  const now = Date.now();
  const flipped: { lot: AuctionLot; usd: number; native: number; cur: Currency }[] = [];
  let boughtIn = 0, heldPending = 0, unresolved = 0, withdrawn = 0;
  for (const l of stuck) {
    const raw = results.get(l.id);
    if (raw === undefined) { unresolved++; continue; } // page failed — keep state, never guess
    const L = l as unknown as Record<string, unknown>;
    const realised = parseFloat(String(raw.price_realised ?? ''));
    if (realised > 0) {
      // sold: realised is buyer-inclusive → premiumNative; currency from the
      // display strings; keep the lot's own native estimates when the page has none
      const cur = parseChristiesCurrency(`${raw.price_realised_txt || ''} ${raw.estimate_txt || ''}`);
      const estLow = raw.estimate_low != null ? parseFloat(String(raw.estimate_low)) : (l.estLowNative ?? null);
      const estHigh = raw.estimate_high != null ? parseFloat(String(raw.estimate_high)) : (l.estHighNative ?? null);
      Object.assign(L, stampSold(cur, l.saleDate, realised, estLow, estHigh));
      L.status = 'sold';
      L.resultsPending = false;
      flipped.push({ lot: l, usd: (L.realizedUsd as number) || 0, native: realised, cur });
      continue;
    }
    if (raw.lot_withdrawn) withdrawn++;
    // resultless after close: within RESULT_PENDING_MS stay held as pending
    // (results may still post); past the window it is a genuine bought-in
    const closeMs = new Date(l.saleDate).getTime();
    if (!isNaN(closeMs) && now - closeMs <= RESULT_PENDING_MS) { heldPending++; continue; }
    L.status = 'bought_in';
    L.resultsPending = false;
    stripMoney(L);
    boughtIn++;
  }

  const totalUsd = flipped.reduce((s, f) => s + f.usd, 0);
  console.log(`\n[resolve] would flip ${flipped.length}/${stuck.length} to sold · $${Math.round(totalUsd).toLocaleString()} total realized`);
  console.log(`[resolve] bought_in (past ${RESULT_PENDING_MS / 86_400_000}d window): ${boughtIn} · still held pending (within window): ${heldPending} · withdrawn on page: ${withdrawn}`);
  console.log(`[resolve] pages failed: ${pagesFailed} · lots left unresolved: ${unresolved}${failedLots.size ? ` (${Array.from(failedLots).slice(0, 5).join(', ')}…)` : ''}`);
  for (const f of flipped.slice(0, 20)) {
    console.log(`  ${f.lot.id}  ${f.cur} ${f.native.toLocaleString()} → $${Math.round(f.usd).toLocaleString()}  ${f.lot.artist}  ${(f.lot.title || '').slice(0, 50)}`);
  }

  if (!WRITE) { console.log('\n[resolve] dry-run — pass --write to rewrite the christies segment'); return; }
  writeSegment('christies', lots as unknown as Record<string, unknown>[]);
  console.log(`[resolve] wrote ${lots.length} lots to segments/christies.ndjson.gz (local only — nightly owns the R2 push)`);
})();
