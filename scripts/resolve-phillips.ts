/**
 * Resolve stuck-result Phillips lots against the public maker-lots API.
 *
 * A Phillips lot the crawler caught right after its sale closed rots as
 * bought_in (or unknown-result, for the ones with no saleDate) — the realized
 * price hadn't posted yet. But api.phillips.com/api/maker/{id}/lots (the same
 * endpoint crawlPhillips walks) republishes every closed lot with its price:
 *   hammerPlusBP  — the buyer-premium-INCLUSIVE realized total (the sold price)
 *   currencySign  — "$" / "£" / "€" / "HK$" …            (→ nativeCurrency)
 *   auctionStartDateTimeOffset — the sale date            (→ dated FX)
 * `hammerPlusBP > 0` is SOLD; `hammerPlusBP === 0` on a closed lot is an
 * EXPLICIT unsold verdict (bought-in). There is NO per-lot detail API (every
 * /api/lot/<id> shape 404s), so the maker endpoint is the only structured
 * source — but it returns a maker's WHOLE history, so one deep walk resolves
 * every stuck lot of that artist at once (batched by maker, like
 * resolve-christies batches by sale).
 *
 * We match a stuck lot to its API record on the numeric id in its detail URL
 * (phillips.com/detail/<slug>/<id>), which the API echoes in `detailLink`. The
 * artist-slug → maker-id map is read (never executed) out of ray-crawl.ts's
 * ArtistConfig, the same table crawlPhillips uses.
 *
 * Doctrine (mirrors crawlPhillips): hammerPlusBP is premium-inclusive →
 * premiumNative, priceBasis 'realized', hammer null; currency sniffed from
 * currencySign → dated-FX stamp. A lot the API never returns (or whose maker we
 * can't map) is left UNTOUCHED — never guessed.
 *
 * DRY-RUN by default — prints what it would flip. `--write` rewrites the
 * phillips segment (local only; the nightly owns the R2 push).
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/resolve-phillips.ts [--write]
 */
import * as fs from 'fs';
import * as path from 'path';
import { readSegment, writeSegment } from './corpus-io';
import { toUsdDated, fxRateFor } from '../app/lib/normalize';
import type { AuctionLot, Currency, PriceBasis } from '../app/types';

const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CONC = 4;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// currency from Phillips' currencySign — same order as ray-crawl's detectCurrency
function detectCurrency(text: string): Currency {
  if (!text) return 'USD';
  if (text.includes('GBP') || text.includes('£')) return 'GBP';
  if (text.includes('EUR') || text.includes('€')) return 'EUR';
  if (text.includes('HKD') || text.includes('HK$')) return 'HKD';
  if (text.includes('CNY') || text.includes('¥')) return 'CNY';
  if (text.includes('AUD') || text.includes('AU$')) return 'AUD';
  if (text.includes('CHF')) return 'CHF';
  return 'USD';
}

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

/** artist-slug → phillips maker id, READ (not run) out of ray-crawl's ArtistConfig.
 *  Per-block parse: for each `slug: '…'`, take the nearest phillips id before the
 *  next slug. Falls back to an empty map if the source shape drifts. */
function makerIdMap(): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    const src = fs.readFileSync(path.join(process.cwd(), 'scripts', 'ray-crawl.ts'), 'utf8');
    const slugRe = /slug:\s*['"]([a-z0-9-]+)['"]/g;
    const idxs: { slug: string; pos: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = slugRe.exec(src))) idxs.push({ slug: m[1], pos: m.index });
    for (let i = 0; i < idxs.length; i++) {
      const block = src.slice(idxs[i].pos, i + 1 < idxs.length ? idxs[i + 1].pos : src.length);
      const pm = block.match(/phillips:\s*\{\s*id:\s*['"](\d+)['"]/);
      if (pm && !(idxs[i].slug in map)) map[idxs[i].slug] = pm[1];
    }
  } catch { /* empty map → every lot unmatched (untouched) */ }
  return map;
}

type RawLot = {
  detailLink?: string; url?: string; saleNumber?: string; lotNumber?: number | string;
  hammerPlusBP?: number | null; hammerPlusCommission?: number | null; hammerPrice?: number | null;
  currencySign?: string; lowEstimate?: number | null; highEstimate?: number | null;
  auctionStartDateTimeOffset?: string;
};

/** numeric id at the tail of a phillips detail URL (phillips.com/detail/<slug>/<id>). */
const detailId = (u: string) => (u.match(/\/detail\/[^/]+\/(\d+)/) || u.match(/(\d+)\/?$/) || [])[1] || null;

/** Walk a maker's full lot history (paginated API) → id → raw lot. try/caught
 *  per page: a failed fetch stops the walk with what we have (never throws). */
async function fetchMakerLots(makerId: string): Promise<Map<string, RawLot>> {
  const byId = new Map<string, RawLot>();
  const per = 100;
  let totalPages = 1;
  for (let p = 1; p <= totalPages; p++) {
    try {
      const r = await fetch(`https://api.phillips.com/api/maker/${makerId}/lots?page=${p}&resultsPerPage=${per}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) break;
      const j = await r.json() as { data?: RawLot[]; totalPages?: number };
      const data = Array.isArray(j.data) ? j.data : [];
      if (!data.length) break;
      if (p === 1) totalPages = Math.min(j.totalPages || 1, 40); // safety cap
      for (const lot of data) {
        const id = detailId(lot.detailLink || lot.url || '');
        if (id) byId.set(id, lot);
      }
      if (p < totalPages) await sleep(400);
    } catch { break; }
  }
  return byId;
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  const lots = readSegment('phillips') as unknown as AuctionLot[];
  const targets = lots.filter(l => (l.status === 'bought_in' || (l.status as string) === 'unknown-result')
    && /\/detail\//.test(l.url || ''));
  console.log(`[resolve] ${lots.length} phillips lots · ${targets.length} stuck (bought_in/unknown with a detail URL)${WRITE ? '' : ' · DRY-RUN'}`);
  if (!targets.length) return;

  const makers = makerIdMap();
  console.log(`[resolve] ${Object.keys(makers).length} artist→maker ids parsed from ray-crawl ArtistConfig`);

  // group by artist → one deep maker walk resolves every stuck lot of that artist
  const byArtist = new Map<string, AuctionLot[]>();
  const unmapped: AuctionLot[] = [];
  for (const l of targets) {
    const mid = makers[l.artist];
    if (mid) (byArtist.get(mid) || byArtist.set(mid, []).get(mid)!).push(l);
    else unmapped.push(l);
  }
  console.log(`[resolve] ${byArtist.size} makers to fetch · ${unmapped.length} lots with no mappable maker (left untouched)`);

  const results = new Map<string, RawLot | null>();
  let makersFailed = 0;
  const makerList = Array.from(byArtist.entries());
  for (let i = 0; i < makerList.length; i += CONC) {
    await Promise.all(makerList.slice(i, i + CONC).map(async ([mid, mLots]) => {
      const map = await fetchMakerLots(mid);
      if (!map.size) { makersFailed++; return; } // API gave nothing — its lots stay unresolved
      for (const l of mLots) results.set(l.id, map.get(detailId(l.url) || '') || null);
    }));
    await sleep(400);
    console.log(`[resolve]   ${Math.min(i + CONC, makerList.length)}/${makerList.length} makers fetched · ${results.size} lots mapped`);
  }

  // ── adjudicate ──
  const flipped: { lot: AuctionLot; from: string; usd: number; native: number; cur: Currency }[] = [];
  let confirmedUnsold = 0, unmatched = unmapped.length;
  for (const l of targets) {
    const raw = results.get(l.id);
    if (raw == null) { if (makers[l.artist]) unmatched++; continue; } // API missed it — keep state, never guess
    const L = l as unknown as Record<string, unknown>;
    const realized = raw.hammerPlusBP ?? raw.hammerPlusCommission ?? raw.hammerPrice ?? null;
    if (realized != null && realized > 0) {
      const cur = detectCurrency(raw.currencySign || '');
      // prefer the API's sale date (unknown-result lots have an empty saleDate)
      const saleDate = (raw.auctionStartDateTimeOffset || '').slice(0, 10) || l.saleDate || '';
      const estLow = raw.lowEstimate != null ? raw.lowEstimate : (l.estLowNative ?? null);
      const estHigh = raw.highEstimate != null ? raw.highEstimate : (l.estHighNative ?? null);
      const from = l.status as string;
      Object.assign(L, stampSold(cur, saleDate, realized, estLow, estHigh));
      if (saleDate && !l.saleDate) L.saleDate = saleDate; // backfill the missing sale date
      L.status = 'sold';
      L.resultsPending = false;
      flipped.push({ lot: l, from, usd: (L.realizedUsd as number) || 0, native: realized, cur });
      continue;
    }
    // present in the API with hammerPlusBP 0/null on a closed lot = explicit unsold
    if (l.status !== 'bought_in') { L.status = 'bought_in'; L.resultsPending = false; stripMoney(L); }
    confirmedUnsold++;
  }

  const totalUsd = flipped.reduce((s, f) => s + f.usd, 0);
  const fromUnknown = flipped.filter(f => f.from !== 'bought_in').length;
  console.log(`\n[resolve] would flip ${flipped.length}/${targets.length} to sold · $${Math.round(totalUsd).toLocaleString()} total realized`);
  console.log(`[resolve]   corrected from bought_in: ${flipped.length - fromUnknown} · from unknown-result: ${fromUnknown}`);
  console.log(`[resolve] confirmed unsold (explicit hammerPlusBP 0 on page): ${confirmedUnsold} · unmatched (untouched): ${unmatched} · makers failed: ${makersFailed}`);
  for (const f of flipped.slice(0, 15)) {
    console.log(`  ${f.lot.id}  [${f.from}] ${f.cur} ${f.native.toLocaleString()} → $${Math.round(f.usd).toLocaleString()}  ${f.lot.artist}  ${(f.lot.title || '').slice(0, 45)}`);
  }

  if (!WRITE) { console.log('\n[resolve] dry-run — pass --write to rewrite the phillips segment'); return; }
  writeSegment('phillips', lots as unknown as Record<string, unknown>[]);
  console.log(`[resolve] wrote ${lots.length} lots to segments/phillips.ndjson.gz (local only — nightly owns the R2 push)`);
})();
