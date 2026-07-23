/**
 * Resolve stuck/hidden Sotheby's results via the public Algolia search index.
 *
 * The LotCards GraphQL path gates realized prices PER-SALE (`ResultHidden`
 * with no premiums, no matter the auth) — so lots from gated sales rot as
 * 'upcoming', then mis-settle to bought_in when the pending window lapses.
 * But sothebys.com's own search UI renders those prices logged-out: they come
 * from a public Algolia index (`bsp_dotcom_prod_en`) whose search-only creds
 * are embedded in the search page HTML. Per hit: `salePrice` (realized total,
 * buyer-inclusive), `details` ("… | Sale price: 1,605,500 USD" → currency),
 * `soldStatus` ("SOLD"/"UNSOLD" — a POSITIVE unsold signal, not absence),
 * and the canonical lot `url` we match against our own.
 *
 * Scope: stuck pendings (sale closed, no result) PLUS bought_in and
 * unknown-result lots — the ones the hidden-result gap may have already
 * mis-settled. A matched SOLD hit flips to sold with dated-FX money; a
 * matched UNSOLD hit settles bought_in immediately (explicit result); an
 * unmatched lot is left untouched — never guessed.
 *
 * DRY-RUN by default — prints what it would flip. `--write` rewrites the
 * sothebys segment (local only; the nightly owns the R2 push).
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/resolve-sothebys.ts [--write]
 */
import { readSegment, writeSegment } from './corpus-io';
import { toUsdDated, fxRateFor } from '../app/lib/normalize';
import type { AuctionLot, Currency, PriceBasis } from '../app/types';

const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CONC = 4;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// last-known-good creds — the runtime scrape below self-heals a key rotation
const ALGOLIA_FALLBACK = { appId: 'O28SY4Q7WU', apiKey: 'e732e65c70ebf8b51d4e2f922b536496', index: 'bsp_dotcom_prod_en' };

// ── money stamping — same sold-branch shape as ray-crawl's stampMoney (not
// exported there; importing ray-crawl would run its main).
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

// ── Algolia plumbing ───────────────────────────────────────────────────────
type Creds = { appId: string; apiKey: string; index: string };

/** Scrape the public search-only creds off the search page; fall back to the
 *  last-known-good set (the page 307s for bot-ish fetches — that's fine). */
async function algoliaCreds(): Promise<Creds> {
  try {
    const r = await fetch('https://www.sothebys.com/en/search', { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const html = r.ok ? await r.text() : '';
    const appId = (html.match(/ALGOLIA_SEARCH_APP_ID['":\s]+([A-Z0-9]{8,12})/) || [])[1];
    const apiKey = (html.match(/ALGOLIA_SEARCH_API_KEY['":\s]+([a-f0-9]{32})/) || [])[1];
    const index = (html.match(/ALGOLIA_SEARCH_INDEX['":\s]+([a-z0-9_]+)/) || [])[1];
    if (appId && apiKey && index) return { appId, apiKey, index };
  } catch { /* fall through */ }
  return ALGOLIA_FALLBACK;
}

type Hit = { url?: string; salePrice?: number | null; details?: string | null; soldStatus?: string | null; title?: string };

async function algoliaQuery(c: Creds, query: string): Promise<Hit[]> {
  try {
    const r = await fetch(`https://${c.appId}-dsn.algolia.net/1/indexes/${c.index}/query`, {
      method: 'POST',
      headers: { 'x-algolia-application-id': c.appId, 'x-algolia-api-key': c.apiKey, 'content-type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query, hitsPerPage: 50, filters: 'type:Lot' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return [];
    return ((await r.json()) as { hits?: Hit[] }).hits || [];
  } catch { return []; }
}

/** Match key: the `/<year>/<sale-slug>/<lot-slug>` tail of a lot URL. */
const urlTail = (u: string) => {
  const m = (u || '').match(/\/(\d{4})\/([a-z0-9-]+)\/([a-z0-9-]+?)\/?(?:[?#]|$)/i);
  return m ? `${m[1]}/${m[2]}/${m[3]}`.toLowerCase() : null;
};

/** Find OUR lot among the hits — exact url-tail match only, never fuzzy. */
function matchHit(lot: AuctionLot, hits: Hit[]): Hit | null {
  const tail = urlTail(lot.url);
  if (!tail) return null;
  return hits.find(h => urlTail(h.url || '') === tail) || null;
}

/** Two query angles per lot: the title (brackets stripped), then the slug's
 *  words — search is blind to which one the index tokenized better. */
async function resolveLot(c: Creds, lot: AuctionLot): Promise<Hit | null> {
  const title = (lot.title || '').replace(/[[\]]/g, '').trim();
  if (title) {
    const hit = matchHit(lot, await algoliaQuery(c, title));
    if (hit) return hit;
  }
  const slugWords = (urlTail(lot.url)?.split('/')[2] || '').replace(/-/g, ' ').trim();
  if (slugWords && slugWords !== title.toLowerCase()) {
    const hit = matchHit(lot, await algoliaQuery(c, slugWords));
    if (hit) return hit;
  }
  return null;
}

// parse "… | Sale price: 1,605,500 USD" — amount cross-checks salePrice
const detailsCurrency = (details: string) => (details.match(/Sale price:\s*[\d,.]+\s*([A-Z]{3})/) || [])[1] as Currency | undefined;

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  const lots = readSegment('sothebys') as unknown as AuctionLot[];
  const today = new Date().toISOString().slice(0, 10);
  const stuck = lots.filter(l => l.status === 'upcoming' && (l.saleDate || '').slice(0, 10) < today);
  // the correction set: results the hidden-result gap may have mis-settled
  const settled = lots.filter(l => l.status === 'bought_in' || (l.status as string) === 'unknown-result');
  const targets = stuck.concat(settled);
  console.log(`[resolve] ${lots.length} sothebys lots · ${stuck.length} stuck pending + ${settled.length} settled-without-result (bought_in/unknown)${WRITE ? '' : ' · DRY-RUN'}`);
  if (!targets.length) return;

  const creds = await algoliaCreds();
  console.log(`[resolve] algolia ${creds.appId}/${creds.index}${creds === ALGOLIA_FALLBACK ? ' (fallback creds — page scrape missed)' : ' (live-scraped creds)'}`);

  const results = new Map<string, Hit>();
  for (let i = 0; i < targets.length; i += CONC) {
    await Promise.all(targets.slice(i, i + CONC).map(async l => {
      const hit = await resolveLot(creds, l);
      if (hit) results.set(l.id, hit);
    }));
    await sleep(250);
    if (i % 100 < CONC) console.log(`[resolve]   ${Math.min(i + CONC, targets.length)}/${targets.length} queried · ${results.size} matched`);
  }

  // ── adjudicate ──
  const flipped: { lot: AuctionLot; from: string; usd: number; native: number; cur: Currency }[] = [];
  let confirmedUnsold = 0, unmatched = 0;
  for (const l of targets) {
    const hit = results.get(l.id);
    if (!hit) { unmatched++; continue; } // no positive result — keep state, never guess
    const L = l as unknown as Record<string, unknown>;
    if ((hit.salePrice || 0) > 0 && hit.soldStatus !== 'UNSOLD') {
      // realized total ("Sale price") is buyer-inclusive → premiumNative; the
      // currency rides in the details string; keep the lot's own estimates
      const cur = detailsCurrency(hit.details || '') || (l.nativeCurrency as Currency) || 'USD';
      const from = l.status as string;
      Object.assign(L, stampSold(cur, l.saleDate, hit.salePrice!, l.estLowNative ?? null, l.estHighNative ?? null));
      L.status = 'sold';
      L.resultsPending = false;
      flipped.push({ lot: l, from, usd: (L.realizedUsd as number) || 0, native: hit.salePrice!, cur });
      continue;
    }
    if (hit.soldStatus === 'UNSOLD') {
      // an explicit unsold verdict — settle immediately, no window needed
      if (l.status !== 'bought_in') { L.status = 'bought_in'; L.resultsPending = false; stripMoney(L); }
      confirmedUnsold++;
    } else unmatched++; // hit without a usable verdict — leave untouched
  }

  const totalUsd = flipped.reduce((s, f) => s + f.usd, 0);
  const fromPending = flipped.filter(f => f.from === 'upcoming').length;
  console.log(`\n[resolve] would flip ${flipped.length}/${targets.length} to sold · $${Math.round(totalUsd).toLocaleString()} total realized`);
  console.log(`[resolve]   from pending: ${fromPending} · corrected from bought_in/unknown: ${flipped.length - fromPending}`);
  console.log(`[resolve] confirmed unsold (explicit UNSOLD): ${confirmedUnsold} · unmatched (untouched): ${unmatched}`);
  for (const f of flipped.slice(0, 25)) {
    console.log(`  ${f.lot.id.slice(0, 24)}  [${f.from}] ${f.cur} ${f.native.toLocaleString()} → $${Math.round(f.usd).toLocaleString()}  ${f.lot.artist}  ${(f.lot.title || '').slice(0, 45)}`);
  }

  if (!WRITE) { console.log('\n[resolve] dry-run — pass --write to rewrite the sothebys segment'); return; }
  writeSegment('sothebys', lots as unknown as Record<string, unknown>[]);
  console.log(`[resolve] wrote ${lots.length} lots to segments/sothebys.ndjson.gz (local only — nightly owns the R2 push)`);
})();
