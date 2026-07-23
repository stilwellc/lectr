/**
 * Resolve stuck-result Wright / Rago / LA Modern / Toomey lots against the
 * house's own closed-lot pages.
 *
 * Wright's platform (Laravel + Inertia.js, shared by wright20.com, ragoarts.com,
 * lamodern.com, toomeyco.com) serves a closed lot's realized result PUBLICLY in
 * the LOT page's Inertia `props.item`:
 *   result_amount        — the HAMMER (>0 ⟺ sold; 0 ⟺ passed)
 *   result_sans_premium  — hammer again (a number when sold, `false` when passed)
 *   result (html)         — "result: <span>$6,400</span>", the buyer-premium-
 *                           INCLUSIVE total, when the sale publishes premiums
 * A lot the crawler caught right after its sale closed rots as bought_in; once
 * results post, `result_amount` on its own page is the ground truth.
 *
 * NB — the AUCTION-listing `props.items[fd].result` is NOT reliable for the
 * sold/unsold verdict: it stays `false` for genuinely-sold lots in many
 * (esp. prints) sales, so trusting it would MIS-STAMP sold lots as bought_in.
 * We therefore fetch PER LOT and read the authoritative `props.item`.
 *
 * Doctrine: when the `result` html-span premium is present it is
 * premium-inclusive → premiumNative, hammer null, priceBasis 'realized' (mirrors
 * ray-crawl). When the sale published only the hammer (no span), we stamp
 * hammerNative with priceBasis 'hammer-only' — the same basis crawlPhillips uses
 * for premium-less realized numbers — rather than inventing a premium. Wright/
 * Rago/LA Modern/Toomey publish USD only.
 *
 * Flip to sold only on `result_amount > 0`. Confirm bought_in ONLY on the
 * authoritative unsold verdict (`result_amount === 0` && `result_sans_premium`
 * falsey on a lot page that loaded). A lot whose page 404s / never yields an
 * item is left UNTOUCHED — never guessed.
 *
 * DRY-RUN by default — prints what it would flip. `--write` rewrites the wright
 * segment (local only; the nightly owns the R2 push).
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/resolve-wright.ts [--write]
 */
import { readSegment, writeSegment } from './corpus-io';
import { toUsdDated, fxRateFor } from '../app/lib/normalize';
import type { AuctionLot, Currency, PriceBasis } from '../app/types';

const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CONC = 4;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── money stamping — same shape as ray-crawl's stampMoney (not exported there;
// importing ray-crawl would run its main). Wright/Rago are USD. `basis` selects
// the premium-inclusive ('realized') vs hammer-only carrier.
function stampResult(realizedNative: number, basis: PriceBasis, saleDate: string, estLowNative: number | null, estHighNative: number | null) {
  const cur: Currency = 'USD';
  const { rate, asOf } = fxRateFor(cur, saleDate);
  const conv = (n: number | null) => toUsdDated(n, cur, saleDate).usd;
  const estLowUsd = conv(estLowNative), estHighUsd = conv(estHighNative);
  const realizedUsd = conv(realizedNative);
  const premiumInclusive = basis === 'realized';
  return {
    nativeCurrency: cur,
    hammerNative: premiumInclusive ? null : realizedNative,
    premiumNative: premiumInclusive ? realizedNative : null,
    realizedNative,
    buyerPremiumPct: null,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd: premiumInclusive ? null : realizedUsd,
    premiumUsd: premiumInclusive ? realizedUsd : null,
    realizedUsd,
    estLowNative, estHighNative, estLowUsd, estHighUsd,
    priceBasis: basis,
    currency: cur, estimateLow: estLowUsd, estimateHigh: estHighUsd,
    hammerPrice: premiumInclusive ? null : realizedNative,
    premiumPrice: premiumInclusive ? realizedNative : null,
    priceUsd: realizedUsd,
  };
}
// bought_in: the non-sold-null-price invariant — strip every realized field
function stripMoney(l: Record<string, unknown>) {
  for (const f of ['realizedUsd', 'realizedNative', 'hammerUsd', 'hammerNative', 'premiumUsd', 'premiumNative', 'hammerPrice', 'premiumPrice', 'priceUsd', 'priceBasis']) l[f] = null;
}

// ── page plumbing ───────────────────────────────────────────────────────────
async function get(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}
function decodeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;/g, "'");
}
/** Parse the Inertia #app data-page blob. Defensive: bad/missing → null. */
function parseInertiaProps(html: string): Record<string, any> | null {
  const m = html.match(/id="app"[^>]*data-page="([^"]*)"/);
  if (!m) return null;
  try { return JSON.parse(decodeHtml(m[1]))?.props || null; } catch { return null; }
}

type Item = {
  result_amount?: number | null; result_sans_premium?: number | boolean | null;
  result?: string | null; estimate_low?: number | null; estimate_high?: number | null;
  lot_number?: number | string | null;
};
type Verdict =
  | { kind: 'sold'; native: number; basis: PriceBasis; estLow: number | null; estHigh: number | null }
  | { kind: 'unsold' }
  | null; // page failed / no verdict — leave untouched

/** Buyer-inclusive total from the `result` html-span, or null when absent. */
function spanPremium(it: Item): number | null {
  const m = String(it.result || '').match(/[\d,]+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
}

/** Fetch ONE lot page and read its authoritative `props.item` verdict. */
async function fetchLotVerdict(url: string): Promise<Verdict> {
  const html = await get(url);
  if (!html) return null;
  const it: Item | undefined = parseInertiaProps(html)?.item;
  if (!it || typeof it !== 'object') return null;
  const hammer = typeof it.result_amount === 'number' ? it.result_amount : null;
  const estLow = it.estimate_low != null ? it.estimate_low : null;
  const estHigh = it.estimate_high != null ? it.estimate_high : null;
  if (hammer != null && hammer > 0) {
    const premium = spanPremium(it);
    return premium != null
      ? { kind: 'sold', native: premium, basis: 'realized', estLow, estHigh }   // premium-inclusive
      : { kind: 'sold', native: hammer, basis: 'hammer-only', estLow, estHigh }; // only hammer published
  }
  // authoritative pass: hammer 0 AND result_sans_premium falsey on a loaded page
  if (hammer === 0 && (it.result_sans_premium === false || it.result_sans_premium == null || it.result_sans_premium === 0)) return { kind: 'unsold' };
  return null; // ambiguous — leave untouched
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  const lots = readSegment('wright') as unknown as AuctionLot[];
  const targets = lots.filter(l => (l.status === 'bought_in' || (l.status as string) === 'unknown-result')
    && /\/auctions\/\d{4}\/\d{2}\/[^/]+\/[^/]+$/.test(l.url || ''));
  console.log(`[resolve] ${lots.length} wright/rago lots · ${targets.length} stuck (bought_in/unknown with a lot URL)${WRITE ? '' : ' · DRY-RUN'}`);
  if (!targets.length) return;

  const verdicts = new Map<string, Verdict>();
  for (let i = 0; i < targets.length; i += CONC) {
    await Promise.all(targets.slice(i, i + CONC).map(async l => { verdicts.set(l.id, await fetchLotVerdict(l.url)); }));
    await sleep(350);
    if (i % 120 < CONC) console.log(`[resolve]   ${Math.min(i + CONC, targets.length)}/${targets.length} lots fetched`);
  }

  // ── adjudicate ──
  const flipped: { lot: AuctionLot; from: string; usd: number; native: number; basis: PriceBasis }[] = [];
  let confirmedUnsold = 0, unresolved = 0;
  for (const l of targets) {
    const v = verdicts.get(l.id);
    if (v == null) { unresolved++; continue; } // page failed / ambiguous — keep state, never guess
    const L = l as unknown as Record<string, unknown>;
    if (v.kind === 'sold') {
      const from = l.status as string;
      const estLow = v.estLow ?? (l.estLowNative ?? null);
      const estHigh = v.estHigh ?? (l.estHighNative ?? null);
      Object.assign(L, stampResult(v.native, v.basis, l.saleDate, estLow, estHigh));
      L.status = 'sold';
      L.resultsPending = false;
      flipped.push({ lot: l, from, usd: (L.realizedUsd as number) || 0, native: v.native, basis: v.basis });
      continue;
    }
    // authoritative unsold verdict
    if (l.status !== 'bought_in') { L.status = 'bought_in'; L.resultsPending = false; stripMoney(L); }
    confirmedUnsold++;
  }

  const totalUsd = flipped.reduce((s, f) => s + f.usd, 0);
  const fromUnknown = flipped.filter(f => f.from !== 'bought_in').length;
  const hammerOnly = flipped.filter(f => f.basis === 'hammer-only').length;
  console.log(`\n[resolve] would flip ${flipped.length}/${targets.length} to sold · $${Math.round(totalUsd).toLocaleString()} total realized`);
  console.log(`[resolve]   corrected from bought_in: ${flipped.length - fromUnknown} · from unknown-result: ${fromUnknown} · (${hammerOnly} hammer-only, ${flipped.length - hammerOnly} premium-inclusive)`);
  console.log(`[resolve] confirmed unsold (authoritative pass on lot page): ${confirmedUnsold} · unresolved/untouched (404/ambiguous): ${unresolved}`);
  for (const f of flipped.slice(0, 15)) {
    console.log(`  ${f.lot.id}  [${f.from}] USD ${f.native.toLocaleString()} (${f.basis}) → $${Math.round(f.usd).toLocaleString()}  ${f.lot.artist}  ${(f.lot.title || '').slice(0, 40)}`);
  }

  if (!WRITE) { console.log('\n[resolve] dry-run — pass --write to rewrite the wright segment'); return; }
  writeSegment('wright', lots as unknown as Record<string, unknown>[]);
  console.log(`[resolve] wrote ${lots.length} lots to segments/wright.ndjson.gz (local only — nightly owns the R2 push)`);
})();
