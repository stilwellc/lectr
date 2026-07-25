/**
 * sub-markets.ts — the DATA layer for lectr's sub-market tracking.
 *
 * Every tracked slug is a "sub-market". Each gets the STRONGEST honest read its
 * data supports:
 *   - 'index'       — a verified CI'd hedonic maker index (a real maker: Rolex)
 *   - 'demand'      — measured demand (quarterly median %-over-estimate) where
 *                     the slug carries estimates (meteorites/fossils)
 *   - 'descriptive' — typical price + all-time record + volume, where a slug
 *                     has no estimates (sports-cards / game-used)
 *
 * No fabricated appreciation is ever emitted: a 'descriptive' slug carries NO
 * price-movement number, only observed facts (median, record, volume).
 *
 * The output shape is `SubMarketRead` in app/hooks/useRayData.ts — matched
 * byte-for-byte here.
 *
 * Called from scripts/build-market.ts with the full corpus + stats + makerIndex.
 */
import type { AuctionLot } from '../app/types';
import { ARTISTS } from '../app/constants';
import type { MakerIndexResult } from './hedonic-index';
import { buildRepeatSaleIndex } from './repeat-sales';

// ── the emitted row (mirrors SubMarketRead in app/hooks/useRayData.ts) ──
export interface SubMarketRead {
  slug: string;
  label: string;
  vertical: string;
  readType: 'index' | 'demand' | 'descriptive';
  index: { horizon: string; changePct: number; ciLoPct: number; ciHiPct: number } | null;
  // how an 'index' read was produced: 'hedonic' (per-maker log-price regression,
  // for makers with estimates) or 'repeat-sale' (Bailey-Muth-Nourse, mix-immune,
  // for estimate-less markets like cards). null on demand/descriptive reads.
  indexMethod: 'hedonic' | 'repeat-sale' | null;
  demandNow: number | null;
  demandSeries: { period: string; value: number; n: number }[];
  typicalUsd: number | null;
  record: { usd: number; title: string; date: string | null; house: string | null } | null;
  lots: number;
  sellThroughPct: number | null;
  estCoverage: number;
}

// the descriptive stats each slug carries (a subset of stats.json / computeStats)
interface StatsRow {
  totalLotsTracked?: number;
  medianPriceLast12Months?: number;
  avgPriceLast12Months?: number;
  recordPrice?: number;
  recordTitle?: string;
  recordDate?: string;
  recordHouse?: string;
}

// longest horizon first — mirrors app/preview/terminal/verified.ts + the
// HORIZON_PREF used everywhere the verified maker read is selected.
const HORIZON_PREF = ['5Y', '3Y', '1Y'] as const;

// demand gate — a slug reads 'demand' only when it genuinely carries estimates
// across enough of its record AND has enough quarters to draw a curve.
const MIN_EST_COVERAGE = 0.6;
const MIN_DEMAND_QUARTERS = 6;
// per-quarter trailing window floor (matches demand.ts's MIN_WINDOW_SALES)
const MIN_WINDOW_SALES = 5;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Hammer-basis % over estimate for a SOLD lot — the SAME premium handling as
 * app/utils.ts `overEstimatePct`: realized prices are premium-inclusive (~1.25x)
 * while estimates are hammer-basis, so we divide the premium out before
 * comparing (hammerUsd when published, else priceUsd/1.25) vs the estimate mid.
 * Alias-safe on the USD money fields (estLowUsd/estHighUsd), falling back to the
 * pre-migration estimateLow/High.
 */
function overEstPct(l: AuctionLot): number | null {
  const lo = (l.estLowUsd ?? l.estimateLow) || (l.estHighUsd ?? l.estimateHigh) || 0;
  const hi = (l.estHighUsd ?? l.estimateHigh) || (l.estLowUsd ?? l.estimateLow) || 0;
  const mid = (lo + hi) / 2;
  const price = l.priceUsd || 0;
  if (!(mid > 0) || !price) return null;
  const hammer = (l.hammerUsd || 0) > 0 ? l.hammerUsd! : price / 1.25;
  return (hammer / mid - 1) * 100;
}

// a SOLD lot with a real estimate band (the demand/coverage denominator's num)
function hasEstimate(l: AuctionLot): boolean {
  return ((l.estHighUsd ?? l.estimateHigh) || 0) > 0;
}

/**
 * Per-slug quarterly demand: median hammer-basis %-over-estimate over a trailing
 * twelve CALENDAR months, evaluated at each quarter. Same trailing-window +
 * quarter-key discipline as app/lib/demand.ts `demandSeries`, but on the HAMMER
 * basis (overEstPct) rather than the all-in basis, so a sub-market demand read
 * is honest about the buyer's premium.
 */
function slugDemandSeries(soldLots: AuctionLot[]): { period: string; value: number; n: number }[] {
  const sales: { t: number; perf: number }[] = [];
  const quarterEnd: Record<string, number> = {};
  for (const l of soldLots) {
    const perf = overEstPct(l);
    if (perf == null) continue;
    const d = new Date(l.saleDate);
    if (isNaN(d.getTime())) continue;
    const q = Math.floor(d.getUTCMonth() / 3);
    const key = `${d.getUTCFullYear()} Q${q + 1}`;
    sales.push({ t: d.getTime(), perf });
    quarterEnd[key] = quarterEnd[key] ?? Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1);
  }
  const quarters = Object.keys(quarterEnd).sort();
  const points: { period: string; value: number; n: number }[] = [];
  for (const qk of quarters) {
    const end = quarterEnd[qk];
    const window = sales.filter(s => s.t < end && s.t >= end - YEAR_MS).map(s => s.perf);
    if (window.length < MIN_WINDOW_SALES) continue;
    points.push({ period: qk, value: median(window), n: window.length });
  }
  return points;
}

/**
 * Build the sub-market reads, grouped by vertical.
 *
 * @param all         the full corpus (for demand / estCoverage / sellThrough)
 * @param statsBySlug per-slug descriptive stats (stats.json / computeStats)
 * @param makerIndex  the verified per-maker hedonic index (readType 'index')
 */
/**
 * Composite card fingerprint = the repeat-sales object key. Same player + year +
 * set + card number + grade (+ serial parallel) is "the same product"; two sales
 * of that key are a repeat sale. Grade is part of the key on purpose — a PSA 10
 * and a PSA 9 of the same card are different markets. Returns null when the lot
 * isn't a structured card (→ excluded from the index).
 */
function cardKey(l: AuctionLot): string | null {
  const c = l._card;
  if (!c || !c.playerSlug || !c.year || !c.cardNo) return null;
  const grade = c.gradeCo && c.gradeNum != null ? `${c.gradeCo}${c.gradeNum}` : 'raw';
  const set = (c.setName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const serial = c.serialOf != null ? `/${c.serialOf}` : '';
  return `${c.playerSlug}|${c.year}|${set}|${c.cardNo}|${grade}${serial}`;
}

export function buildSubMarkets(
  all: AuctionLot[],
  statsBySlug: Record<string, StatsRow>,
  makerIndex: Record<string, MakerIndexResult>,
): Record<string, SubMarketRead[]> {
  // bucket the corpus by slug once
  const bySlug = new Map<string, AuctionLot[]>();
  for (const l of all) (bySlug.get(l.artist) || bySlug.set(l.artist, []).get(l.artist)!).push(l);

  const out: Record<string, SubMarketRead[]> = {};

  for (const { slug, label, market } of ARTISTS) {
    const lots = bySlug.get(slug) || [];
    const sold = lots.filter(l => l.status === 'sold' && (l.priceUsd || 0) > 0);
    const boughtIn = lots.filter(l => l.status === 'bought_in');
    const stats = statsBySlug[slug] || {};

    // ── descriptive layer (always available) ──
    const typicalUsd = (stats.medianPriceLast12Months && stats.medianPriceLast12Months > 0)
      ? stats.medianPriceLast12Months
      : (stats.avgPriceLast12Months && stats.avgPriceLast12Months > 0 ? stats.avgPriceLast12Months : null);
    const record = (stats.recordPrice && stats.recordPrice > 0)
      ? {
          usd: stats.recordPrice,
          title: stats.recordTitle || '',
          date: stats.recordDate || null,
          house: stats.recordHouse || null,
        }
      : null;
    // volume: prefer the honest stats count (covers the sold-archive the slim
    // corpus omits), fall back to what's in the pool.
    const lotCount = (stats.totalLotsTracked && stats.totalLotsTracked > 0)
      ? stats.totalLotsTracked
      : lots.length;
    // sell-through over the corpus we can see (sold vs sold+bought_in), n-gated.
    const denomST = sold.length + boughtIn.length;
    const sellThroughPct = denomST >= 40 ? Math.round((100 * sold.length) / denomST) : null;

    // ── estimate coverage: fraction of SOLD lots carrying an estimate ──
    const soldWithEst = sold.filter(hasEstimate).length;
    const estCoverage = sold.length ? soldWithEst / sold.length : 0;

    // ── demand series (hammer-basis %-over-estimate) ──
    const demandSeries = slugDemandSeries(sold);
    const demandNow = demandSeries.length ? demandSeries[demandSeries.length - 1].value : null;

    // ── verified maker index: the longest horizon whose CI resolves the sign ──
    const mi = makerIndex[slug];
    let index: SubMarketRead['index'] = null;
    let indexMethod: SubMarketRead['indexMethod'] = null;
    if (mi) {
      for (const h of HORIZON_PREF) {
        const hz = mi.horizons?.[h];
        if (hz?.publishable && hz.changePct != null && hz.ciLoPct != null && hz.ciHiPct != null) {
          index = { horizon: h, changePct: hz.changePct, ciLoPct: hz.ciLoPct, ciHiPct: hz.ciHiPct };
          indexMethod = 'hedonic';
          break;
        }
      }
    }

    // ── repeat-sales index fallback: for estimate-less card markets the hedonic
    // can't run, but same-card-same-grade objects sold 2+ times give a mix-immune
    // Bailey-Muth-Nourse index. Only consulted when no hedonic index exists, and
    // only publishes on a horizon whose 95% CI resolves the sign. ──
    if (!index) {
      const cardLots = sold.filter(l => cardKey(l) != null);
      if (cardLots.length >= 400) {
        const rs = buildRepeatSaleIndex(cardLots, cardKey);
        for (const h of HORIZON_PREF) {
          const hz = rs.horizons?.[h];
          if (hz?.publishable && hz.changePct != null && hz.ciLoPct != null && hz.ciHiPct != null) {
            index = { horizon: h, changePct: hz.changePct, ciLoPct: hz.ciLoPct, ciHiPct: hz.ciHiPct };
            indexMethod = 'repeat-sale';
            break;
          }
        }
      }
    }

    // ── readType decision ──
    // 'index' if a publishable maker horizon exists; else 'demand' when the slug
    // genuinely carries estimates over enough quarters; else 'descriptive'.
    const readType: SubMarketRead['readType'] = index
      ? 'index'
      : (estCoverage >= MIN_EST_COVERAGE && demandSeries.length >= MIN_DEMAND_QUARTERS ? 'demand' : 'descriptive');

    const row: SubMarketRead = {
      slug,
      label,
      vertical: market,
      readType,
      index,
      indexMethod: readType === 'index' ? indexMethod : null,
      // carry demandNow/series only on a demand read — a descriptive slug must
      // never surface a %-over-estimate figure as its read, and an index slug's
      // headline is the CI'd move.
      demandNow: readType === 'demand' ? demandNow : null,
      demandSeries: readType === 'demand' ? demandSeries : [],
      typicalUsd,
      record,
      lots: lotCount,
      sellThroughPct,
      estCoverage: +estCoverage.toFixed(3),
    };
    (out[market] || (out[market] = [])).push(row);
  }

  // ── sort each vertical: index rows first (|changePct| desc), then demand
  // (demandNow desc), then descriptive (lots desc) ──
  const rank = (r: SubMarketRead) => (r.readType === 'index' ? 0 : r.readType === 'demand' ? 1 : 2);
  for (const v of Object.keys(out)) {
    out[v].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return Math.abs(b.index!.changePct) - Math.abs(a.index!.changePct);
      if (ra === 1) return (b.demandNow ?? -Infinity) - (a.demandNow ?? -Infinity);
      return b.lots - a.lots;
    });
  }

  return out;
}
