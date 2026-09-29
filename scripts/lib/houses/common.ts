/**
 * Shared crawler plumbing for every house module: politeness (UA, sleep, pool),
 * the per-house HEALTH counters (expected / fetched / parse-drop), the
 * incremental-crawl mode, currency sniffing and the detail-page enrich helpers.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import { isCurrency, type AuctionLot, type Currency, type PriceBasis } from '../../../app/types';
import { toUsdDated, fxRateFor } from '../../../app/lib/normalize';

/** True if a YYYY-MM-DD saleDate is strictly BEFORE today (UTC day). Same-day
 *  counts as NOT past — matching validate.ts + the sanitize net. Using
 *  `new Date('YYYY-MM-DD') < new Date()` here (UTC midnight vs the now-instant)
 *  wrongly buries a still-live same-day lot as bought_in for the whole UTC day. */
export const isSaleDayPast = (saleDate: string): boolean =>
  saleDate.slice(0, 10) < new Date().toISOString().slice(0, 10);

// One-time (or occasional) history expander: RAY_DEEP=1 walks much deeper
// pagination on the houses that expose it, and enriches far more detail
// pages. Polite delays are kept; it just keeps walking.
export const DEEP = process.env.RAY_DEEP === '1';

// INCREMENTAL CRAWL (Christie's + Sotheby's auction crawlers): sales already
// FULLY RESOLVED in the current segment (every lot sold/settled-bought_in,
// closed longer ago than RESULT_PENDING_MS, not online-only, not resurfaced by
// today's live department discovery) are NOT re-fetched — their existing lots
// are simply carried forward by the normal merge (lotMap is seeded from the
// segment, so a lot we don't re-crawl survives untouched).
//
// DEFAULT: ON — except Sunday (UTC), which runs the FULL sweep as the weekly
// correctness backstop, mirroring the backtest's Sunday-full cadence in
// nightly.yml. Explicit overrides win either way:
//   INCREMENTAL_CRAWL=1 → force incremental (even on Sunday)
//   INCREMENTAL_CRAWL=0 → force the full sweep
// The nightly.yml dispatch input maps onto exactly these three states.
const UTC_SUNDAY = new Date().getUTCDay() === 0; // matches `date -u +%u` = 7 in nightly.yml

export const INCREMENTAL_CRAWL =
  process.env.INCREMENTAL_CRAWL === '1' ? true :
  process.env.INCREMENTAL_CRAWL === '0' ? false :
  !UTC_SUNDAY;

export const INCREMENTAL_MODE_REASON =
  process.env.INCREMENTAL_CRAWL === '1' ? 'forced ON (INCREMENTAL_CRAWL=1)' :
  process.env.INCREMENTAL_CRAWL === '0' ? 'forced OFF (INCREMENTAL_CRAWL=0 — full sweep)' :
  UTC_SUNDAY ? 'OFF (Sunday UTC — weekly full-sweep backstop)' : 'ON (weekday default)';

// ── CRAWL HEALTH (per-house) ────────────────────────────────────────────────
// expected: the source's OWN advertised totals where a feed exposes one
// (Christie's auction total_hits_filtered, Goldin facet/pass totals) — summed
// per house, 'na' otherwise. parseErrors: lots DROPPED at parse time for a
// missing REQUIRED field (id/title/url — see parseDrop call sites). Both feed
// the machine-greppable `[health]` line emitted per house at the end of main().
export const HEALTH: { expected: Record<string, number>; parseErrors: Record<string, number>; fetched: Record<string, number> } = { expected: {}, parseErrors: {}, fetched: {} };

export const noteExpected = (house: string, n: number) => {
  if (Number.isFinite(n) && n > 0) HEALTH.expected[house] = (HEALTH.expected[house] || 0) + n;
};

// fetched: LOT-BEARING pages/API pages the source answered 2xx with a body
// (artist pages, auction/lot listings, search hits) — NOT discovery pages.
// Feeds the SILENT-ZERO gate at the segment write: a house that answered but
// parsed nothing is a broken parser/wall, never an empty market.
export const noteFetched = (house: string, n = 1) => { HEALTH.fetched[house] = (HEALTH.fetched[house] || 0) + n; };

/** Brace-balanced JS-object extractor for `<anchor> = { … };` script embeds.
 *  Respects string literals (and escapes) so a `});` INSIDE a JSON string —
 *  a Christie's essay quoting code, a title with "})" — can't truncate the
 *  object the way the old non-greedy `(\{[\s\S]*?\});` did (which then hit
 *  JSON.parse → catch → [] and read as an empty sale). Returns the balanced
 *  `{…}` source, or null when the anchor is absent / never balances. */
export function balancedObjectAfter(src: string, anchor: RegExp): string | null {
  const m = src.match(anchor);
  if (!m || m.index == null) return null;
  const start = src.indexOf('{', m.index + m[0].length);
  if (start < 0) return null;
  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  return null;
}

// A lot missing a REQUIRED field (id, title, url) is counted + dropped with ONE
// warn line — never silently shipped. Optional fields (estimate, condition,
// medium…) must NEVER route through here.
export const parseDrop = (house: string, why: string, ref: string) => {
  HEALTH.parseErrors[house] = (HEALTH.parseErrors[house] || 0) + 1;
  console.warn(`  [parse-drop] house=${house} ${why}: ${String(ref).slice(0, 120)}`);
};

export const DELAY_MS = 1500;

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Bounded-concurrency worker pool ──
// The nightly's per-house wall-time was dominated by the SEQUENTIAL sweep of
// ~33 maker pages (fetch + pagination + a 1500ms inter-artist sleep each). This
// runs at most N `worker` calls concurrently instead. No new deps — a plain
// index-cursor pool: N workers each pull the next item until the queue drains.
//
// Rate-limit safety: the per-page politeness sleeps INSIDE each house crawler
// are untouched, so N=CRAWL_CONCURRENCY only widens how many DISTINCT makers
// are in flight; each maker's own request cadence is unchanged. A cold-start
// stagger (worker i waits i*staggerMs before its first task) keeps N workers
// from firing simultaneously. Dial CRAWL_CONCURRENCY down if a house 429s.
//
// Order of results does NOT match input order (workers race) — every caller
// here dedupes/filters by id or artist.slug downstream, so that's fine.
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  staggerMs = 0,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const n = Math.max(1, Math.min(concurrency, items.length));
  const runWorker = async (workerId: number): Promise<void> => {
    if (staggerMs > 0 && workerId > 0) await sleep(workerId * staggerMs);
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: n }, (_, w) => runWorker(w)));
  return results;
}

// ── Helpers ──

export function detectCurrency(text: string): Currency {
  if (!text) return 'USD';
  if (text.includes('GBP') || text.includes('£')) return 'GBP';
  if (text.includes('EUR') || text.includes('€')) return 'EUR';
  if (text.includes('HKD') || text.includes('HK$')) return 'HKD';
  if (text.includes('CNY') || text.includes('¥')) return 'CNY';
  if (text.includes('AUD') || text.includes('AU$')) return 'AUD';
  if (text.includes('CHF')) return 'CHF';
  return 'USD';
}

export function isoCurrencyToInternal(iso: string): Currency {
  return isCurrency(iso) ? iso : 'USD';
}

// The flat single-rate toUsd()/USD_RATES table was removed in the v2 money
// rewrite: every conversion now flows through toUsdDated()/stampMoney(), which
// use the DATED per-sale-year FX_BY_YEAR table in normalize.ts (a 2015 GBP sale
// converts at 2015's rate, not one frozen 16-year snapshot). Native is the
// fact; USD is a derived, dated view.

// ── v2 money stamping ──────────────────────────────────────────────────────
// The load-bearing rewrite: native is the FACT, USD is a DERIVED view via a
// DATED per-lot rate (toUsdDated from normalize.ts), and priceBasis says what
// the number is. Called at every soldPrice choice so a fresh row carries the
// full money block. Never blanket-forces 'USD' — the native currency is passed
// through as the fact; estimates are stored native + derived to USD.
//
// A sold lot MUST end with realizedUsd>0 + priceBasis; a non-sold lot has NULL
// price fields (the write-time invariant gate enforces this). We therefore null
// every price field when !isSold, regardless of what a house returned.
interface MoneyIn {
  isSold: boolean;
  nativeCurrency: Currency;
  saleDate: string | null;
  hammerNative: number | null;
  premiumNative: number | null;
  estLowNative: number | null;
  estHighNative: number | null;
  priceBasis: PriceBasis; // basis to stamp when sold
  buyerPremiumPct?: number | null;
}

type MoneyBlock = Pick<AuctionLot,
  'nativeCurrency' | 'hammerNative' | 'premiumNative' | 'realizedNative' |
  'buyerPremiumPct' | 'fxRate' | 'fxAsOf' | 'hammerUsd' | 'premiumUsd' |
  'realizedUsd' | 'estLowNative' | 'estHighNative' | 'estLowUsd' | 'estHighUsd' |
  'priceBasis' | 'currency' | 'estimateLow' | 'estimateHigh' |
  'hammerPrice' | 'premiumPrice' | 'priceUsd'>;

export function stampMoney(m: MoneyIn): MoneyBlock {
  const { rate, asOf } = fxRateFor(m.nativeCurrency, m.saleDate);
  // conversion goes through toUsdDated (normalize.ts) so the fresh row's USD
  // rounding is byte-identical to the (completed) v2 backfill's — ONE
  // definition of "native → dated USD".
  const conv = (n: number | null) => toUsdDated(n, m.nativeCurrency, m.saleDate).usd;

  // estimates are ALWAYS native + derived (present on sold and upcoming alike)
  const estLowNative = m.estLowNative;
  const estHighNative = m.estHighNative;
  const estLowUsd = conv(estLowNative);
  const estHighUsd = conv(estHighNative);

  if (!m.isSold) {
    // DOCTRINE: a non-sold lot has NULL price fields. Keep estimates + the fx
    // stamp (so a computed estUsd band is dated) but no realized/hammer/premium.
    return {
      nativeCurrency: m.nativeCurrency,
      hammerNative: null, premiumNative: null, realizedNative: null,
      buyerPremiumPct: m.buyerPremiumPct ?? null,
      fxRate: rate, fxAsOf: asOf,
      hammerUsd: null, premiumUsd: null, realizedUsd: null,
      estLowNative, estHighNative, estLowUsd, estHighUsd,
      // old aliases
      currency: m.nativeCurrency,
      estimateLow: estLowUsd, estimateHigh: estHighUsd,
      hammerPrice: null, premiumPrice: null, priceUsd: null,
      priceBasis: undefined,
    };
  }

  const hammerNative = m.hammerNative;
  const premiumNative = m.premiumNative;
  const realizedNative = premiumNative ?? hammerNative;
  const hammerUsd = conv(hammerNative);
  const premiumUsd = conv(premiumNative);
  const realizedUsd = conv(realizedNative);
  // derive BP% when both native numbers are present and it wasn't supplied
  let bp = m.buyerPremiumPct ?? null;
  if (bp == null && hammerNative != null && premiumNative != null && hammerNative > 0) {
    bp = Math.round((premiumNative / hammerNative - 1) * 1000) / 10;
  }

  return {
    nativeCurrency: m.nativeCurrency,
    hammerNative, premiumNative, realizedNative,
    buyerPremiumPct: bp,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd, premiumUsd, realizedUsd,
    estLowNative, estHighNative, estLowUsd, estHighUsd,
    priceBasis: m.priceBasis,
    // old aliases (priceUsd = realizedUsd; estimate* = *Usd, NOT native)
    currency: m.nativeCurrency,
    estimateLow: estLowUsd, estimateHigh: estHighUsd,
    hammerPrice: hammerNative, premiumPrice: premiumNative, priceUsd: realizedUsd,
  };
}

// ── Stats Computation ──


// ── Detail Page Enrichment ──
// Fetches individual lot pages to backfill missing medium, dimensions, and year.
// Only enriches lots that are missing at least one of these fields.

export type EnrichResult = { medium?: string; dimensions?: string; year?: string };

// Enrichment parse failures are COUNTED + sampled, never swallowed: a JSON-LD
// / lotHeader blob that stops parsing (markup change, truncated embed) used to
// vanish into `catch {}` and read as "this lot has no details".
export const ENRICH_FAILS: Record<string, { json: number; page: number }> = {};

let enrichFailLogged = 0;

export function noteEnrichFail(house: string, kind: 'json' | 'page', lot: AuctionLot, e: unknown) {
  const c = ENRICH_FAILS[house] || (ENRICH_FAILS[house] = { json: 0, page: 0 });
  c[kind]++;
  if (enrichFailLogged++ < 10) console.warn(`  [Enrich] ${house} ${kind === 'json' ? 'embedded JSON parse' : 'page'} failure on ${lot.id}: ${(e as Error)?.message?.slice(0, 120) || e}`);
}

export const MEDIUM_PATTERNS = /(?:oil|acrylic|gouache|watercolor|watercolour|ink|charcoal|pencil|pastel|spray|enamel|screenprint|silkscreen|lithograph|etching|woodcut|woodblock|linocut|engraving|aquatint|monotype|monoprint|offset|poster|gicl[eé]e|print|photograph|gelatin silver|c-print|chromogenic|pigment print|inkjet|cibachrome|bronze|ceramic|porcelain|earthenware|stoneware|terracotta|glazed|mixed media|collage|canvas|linen|paper|board|panel|synthetic polymer|marker|crayon|felt[- ]?tip|tempera|encaustic|aluminum|steel|wood|glass|leather|fabric|textile|neon|plaster|resin|fiberglass|marble)/i;

// Wall-clock budget: worst case (a stalled house timing out every 10s fetch)
// would run ~85 min while the CI workflow is killed at 45 — taking the day's
// crawl (and Goldin bid tracking) down with it. Stop enriching and let the
// run write/commit; the backlog picks up next run.
export const ENRICH_TIME_BUDGET_MS = 20 * 60_000;
