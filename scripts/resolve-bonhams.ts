/**
 * Resolve gated / mis-settled Bonhams results against bonhams.com lot pages.
 *
 * Bonhams is a Next.js app: every lot page embeds a `<script id="__NEXT_DATA__">`
 * JSON blob whose `props.pageProps.lot` is THE lot's own record — not a carousel
 * or a highlights strip (those live under `auction.highlights` /
 * `dehydratedState…data[]` and carry OTHER lots' prices; parsing them is the
 * trap this resolver avoids). The lot record carries, in native currency:
 *   sLotStatus      "SOLD" | "CS" (both sold) · "BI" (bought-in) · "WD" (withdrawn)
 *   dHammerPrice    the hammer (hammer-only)
 *   dHammerPremium  hammer + buyer's premium (the buyer-inclusive REALIZED total)
 *   currency.iso_code   GBP | USD | EUR | HKD | …
 *   dEstimateLow/High   the native estimate band
 *   iSaleNo.iSaleNo / iSaleLotNo / sSaleLotNoA   identity, so a redirect or a
 *                       stray record can't masquerade as our lot (guarded).
 *
 * The bonhams segment holds ~4,286 bought_in + ~135 unknown-result lots. Some
 * are genuine no-sales (correctly settled); some are gated/mis-settled lots that
 * really hammered (sLotStatus "CS"/"SOLD" with a live dHammerPremium) we can
 * recover. Doctrine (mirrors resolve-christies / ray-crawl): the realized total
 * is buyer-inclusive → premiumNative, converted via the dated-FX stampSold shape
 * (priceBasis 'realized', hammer null).
 *
 * Adjudication is POSITIVE-signal only:
 *   • flip to 'sold' ONLY on a sold-type status WITH a realized total > 0;
 *   • confirm 'bought_in' ONLY on an EXPLICIT unsold/withdrawn status (BI/WD);
 *   • a 404 / parse miss / identity-mismatch / ambiguous page → LEAVE UNTOUCHED.
 * Never guess.
 *
 * Fails SAFE: every fetch is try/caught → null → the lot is left untouched.
 *
 * DRY-RUN by default — prints what it would flip. `--write` rewrites the
 * bonhams segment (local only; the nightly owns the R2 push).
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/resolve-bonhams.ts [--write]
 */
import { readSegment, writeSegment } from './corpus-io';
import { toUsdDated, fxRateFor } from '../app/lib/normalize';
import type { AuctionLot, Currency, PriceBasis } from '../app/types';

const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CONC = 4;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Bonhams sells in GBP/USD/EUR/HKD (and a few others) — the lot record hands us
// an ISO code, so we just validate it against the currencies we can convert.
const KNOWN: Currency[] = ['USD', 'GBP', 'EUR', 'HKD', 'CNY', 'AUD', 'CHF'];
function normCurrency(iso: string | undefined, fallback: Currency): Currency {
  const c = (iso || '').toUpperCase() as Currency;
  return KNOWN.includes(c) ? c : fallback;
}

// ── money stamping — byte-identical to resolve-christies' stampSold: realized
// total is buyer-inclusive → premiumNative, hammer null, priceBasis 'realized'.
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
async function get(url: string): Promise<{ finalUrl: string; html: string; status: number } | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const html = await r.text(); // read even on 404 — Next 404s still ship __NEXT_DATA__, but with no pp.lot
    if (!r.ok) return { finalUrl: r.url, html, status: r.status };
    return { finalUrl: r.url, html, status: r.status };
  } catch { return null; }
}

// the fields we read off a Bonhams lot record (props.pageProps.lot)
type BonhamsLot = {
  iSaleLotNo?: number; sSaleLotNoA?: string; iSaleNo?: { iSaleNo?: number };
  sLotStatus?: string; dHammerPrice?: number; dHammerPremium?: number;
  dEstimateLow?: number; dEstimateHigh?: number;
  currency?: { iso_code?: string };
};

/** Parse `<script id="__NEXT_DATA__">…</script>` and pull THIS lot's own record.
 *  Defensive: missing script / bad JSON / no lot → null, never throws. */
function parseLotRecord(html: string): BonhamsLot | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const nd = JSON.parse(m[1]);
    const lot = nd?.props?.pageProps?.lot;
    return lot && typeof lot === 'object' ? (lot as BonhamsLot) : null;
  } catch { return null; }
}

// Bonhams lot ids: bonhams-<saleId>-<lotNo>. The numeric form (32238-182) is the
// one we can identity-check; the hashed brk_ form (brk_1008619-DF9A09ED…) carries
// no numeric lot number, so we take its record at face value (still guarded by
// the requested-url redirect landing on the same slug id via the fetch itself).
const SALE_LOT = /bonhams-(\d+)-(\d+)([A-Za-z]*)$/; // saleId, lotNo, optional suffix (215A → 215 + "A")

/** Fetch a lot page and return its record ONLY if it is unambiguously OUR lot.
 *  For numeric ids we cross-check the embedded sale number + lot number so an
 *  adjacent/redirected record can't be mistaken for ours; hashed brk_ ids (which
 *  carry no numeric lot no.) are accepted as-is (the URL is deterministic). */
async function fetchLotResult(lot: AuctionLot): Promise<BonhamsLot | null> {
  const page = await get(lot.url);
  if (!page) return null;              // network error → untouched
  if (page.status === 404) return null; // lot page gone → untouched
  const rec = parseLotRecord(page.html);
  if (!rec) return null;               // no embedded lot → untouched
  const m = lot.id.match(SALE_LOT);
  if (m) {
    const [, saleId, lotNo, suffix] = m;
    const recSale = rec.iSaleNo?.iSaleNo != null ? String(rec.iSaleNo.iSaleNo) : null;
    const recLotNo = rec.iSaleLotNo != null ? String(rec.iSaleLotNo) : null;
    const recSuffix = (rec.sSaleLotNoA || '').trim();
    // identity guard: same sale, same lot number, same suffix (215A ≠ 215)
    if (recSale !== saleId || recLotNo !== lotNo || recSuffix.toUpperCase() !== suffix.toUpperCase()) return null;
  }
  return rec;
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  const lots = readSegment('bonhams') as unknown as AuctionLot[];
  // the correction set: bought_in + unknown-result — the gated-result gap may
  // have mis-settled real sales into these buckets.
  const targets = lots.filter(l => l.status === 'bought_in' || (l.status as string) === 'unknown-result');
  console.log(`[resolve] ${lots.length} bonhams lots · ${targets.length} settled-without-published-result (bought_in/unknown)${WRITE ? '' : ' · DRY-RUN'}`);
  if (!targets.length) return;

  const results = new Map<string, BonhamsLot | null>();
  const failed = new Set<string>();
  for (let i = 0; i < targets.length; i += CONC) {
    await Promise.all(targets.slice(i, i + CONC).map(async l => {
      const rec = await fetchLotResult(l);
      if (rec) results.set(l.id, rec);
      else failed.add(l.id); // 404 / network / parse / identity-mismatch → untouched
    }));
    await sleep(400);
    if (i % 400 < CONC) console.log(`[resolve]   ${Math.min(i + CONC, targets.length)}/${targets.length} fetched · ${results.size} parsed · ${failed.size} unparseable`);
  }

  // ── adjudicate ──
  const flipped: { lot: AuctionLot; from: string; usd: number; native: number; cur: Currency }[] = [];
  let confirmedUnsold = 0, confirmedWithdrawn = 0, ambiguous = 0;
  for (const l of targets) {
    const rec = results.get(l.id);
    if (rec == null) continue; // page failed / mismatch — keep state, never guess
    const L = l as unknown as Record<string, unknown>;
    const status = (rec.sLotStatus || '').toUpperCase();
    // realized total is buyer-inclusive (dHammerPremium); fall back to the
    // hammer only if the premium field is absent but the hammer is present.
    const premium = Number(rec.dHammerPremium) || 0;
    const hammer = Number(rec.dHammerPrice) || 0;
    const realized = premium > 0 ? premium : hammer;

    if ((status === 'SOLD' || status === 'CS') && realized > 0) {
      const cur = normCurrency(rec.currency?.iso_code, (l.nativeCurrency as Currency) || 'USD');
      const estLow = rec.dEstimateLow != null && rec.dEstimateLow > 0 ? Number(rec.dEstimateLow) : (l.estLowNative ?? null);
      const estHigh = rec.dEstimateHigh != null && rec.dEstimateHigh > 0 ? Number(rec.dEstimateHigh) : (l.estHighNative ?? null);
      const from = l.status as string;
      Object.assign(L, stampSold(cur, l.saleDate, realized, estLow, estHigh));
      L.status = 'sold';
      L.resultsPending = false;
      flipped.push({ lot: l, from, usd: (L.realizedUsd as number) || 0, native: realized, cur });
      continue;
    }
    if (status === 'BI' || status === 'WD') {
      // explicit unsold/withdrawn verdict → settle as bought_in immediately
      if (l.status !== 'bought_in') { L.status = 'bought_in'; L.resultsPending = false; stripMoney(L); }
      if (status === 'WD') confirmedWithdrawn++; else confirmedUnsold++;
      continue;
    }
    ambiguous++; // parsed record but no usable verdict — leave untouched
  }

  const totalUsd = flipped.reduce((s, f) => s + f.usd, 0);
  const rate = ((flipped.length / targets.length) * 100).toFixed(1);
  console.log(`\n[resolve] would flip ${flipped.length}/${targets.length} to sold (${rate}%) · $${Math.round(totalUsd).toLocaleString()} total realized`);
  console.log(`[resolve] confirmed unsold (BI): ${confirmedUnsold} · confirmed withdrawn→bought_in (WD): ${confirmedWithdrawn} · parsed-but-ambiguous (untouched): ${ambiguous}`);
  console.log(`[resolve] pages failed/404/mismatch (untouched): ${failed.size}${failed.size ? ` (${Array.from(failed).slice(0, 5).join(', ')}…)` : ''}`);
  for (const f of flipped.slice(0, 15)) {
    console.log(`  ${f.lot.id.padEnd(24)} [${f.from}] ${f.cur} ${f.native.toLocaleString()} → $${Math.round(f.usd).toLocaleString()}  ${f.lot.artist}  ${(f.lot.title || '').slice(0, 45)}`);
  }

  if (!WRITE) { console.log('\n[resolve] dry-run — pass --write to rewrite the bonhams segment'); return; }
  writeSegment('bonhams', lots as unknown as Record<string, unknown>[]);
  console.log(`[resolve] wrote ${lots.length} lots to segments/bonhams.ndjson.gz (local only — nightly owns the R2 push)`);
})();
