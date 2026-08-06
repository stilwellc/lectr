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
import { bidCompetitionSeries } from '../app/lib/demand';
import { subCatLabel } from './lib/sub-cats';

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
  // BID-COMPETITION secondary read (cards): median bids drawn per SOLD lot in the
  // latest quarter — a demand primitive from Goldin's bidCount, NOT a price move
  // and NOT %-over-estimate. Present only where the slug ships bidCount (cards);
  // null everywhere else. Rides ALONGSIDE the row's headline read (the CI'd
  // repeat-sale index for cards) as support, never as the index itself.
  bidCompNow: number | null;
  typicalUsd: number | null;
  record: { usd: number; title: string; date: string | null; house: string | null } | null;
  lots: number;
  sellThroughPct: number | null;
  estCoverage: number;
  /** index-read rows: the BMN level series (base 100) behind the CI'd move —
      the hero chart layers draw it rebased to the visible window */
  indexSeries?: { period: string; value: number; n: number }[];
  /** quarterly sold-lot counts (trailing 24 quarters) — the volume subpane's
      series; counts are facts, never dressed as price movement */
  volSeries?: { period: string; n: number }[];
  /** long-horizon YEARLY typical-price median (n-gated), for culture subject
      domains off the RR 23-year archive. Descriptive $ — never a %-change. */
  histSeries?: { period: string; value: number; n: number }[];
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

/** trailing quarterly sold counts — 'YYYY Qn' keys, capped at 24 quarters */
function quarterlyVolume(sold: AuctionLot[]): { period: string; n: number }[] | undefined {
  const c = new Map<string, number>();
  for (const l of sold) {
    const d = new Date(l.saleDate);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    c.set(key, (c.get(key) || 0) + 1);
  }
  // the in-progress quarter is a PARTIAL count — presenting it as "now" reads
  // as a volume collapse; the last complete quarter is the honest terminus
  const now = new Date();
  const cur = `${now.getUTCFullYear()} Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  c.delete(cur);
  const rows = Array.from(c.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, n]) => ({ period, n })).slice(-24);
  return rows.length >= 8 ? rows : undefined;
}

/**
 * Long-horizon YEARLY typical-price median (calendar year), n-gated. For the
 * culture SUBJECT-DOMAIN drills off the RR 30-year sold archive (dense from
 * ~2003). Only years with ≥ MIN_HIST_YEAR sold lots publish (a thin year is a
 * misleading point), trailing up to ~23 years. DESCRIPTIVE dollars — the median
 * price a domain's lots actually cleared that year — never a %-change. Mirrors
 * the volSeries emission discipline: sorted keys, n carried, gate on support.
 */
const MIN_HIST_YEAR = 20;
const HIST_MAX_YEARS = 23;
function yearlyHist(sold: AuctionLot[]): { period: string; value: number; n: number }[] | undefined {
  const byYear = new Map<number, number[]>();
  for (const l of sold) {
    const p = l.priceUsd || 0;
    if (!(p > 0)) continue;
    const d = new Date(l.saleDate);
    if (isNaN(d.getTime())) continue;
    const y = d.getUTCFullYear();
    (byYear.get(y) || byYear.set(y, []).get(y)!).push(p);
  }
  const rows = Array.from(byYear.entries())
    .filter(([, v]) => v.length >= MIN_HIST_YEAR)
    .sort((a, b) => a[0] - b[0])
    .map(([y, v]) => ({ period: String(y), value: Math.round(median(v)), n: v.length }))
    .slice(-HIST_MAX_YEARS);
  return rows.length >= 3 ? rows : undefined;
}

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

// a SOLD lot with a real estimate (the demand/coverage denominator's num).
// Single-point estimates count: RR Auction publishes ONE figure, stored in
// estimateLow with estimateHigh null — overEstPct already midpoints via the
// same low↔high fallback, so gating on high-only silently disenfranchised the
// entire RR tape (verified: 3,860/4,225 recent RR lots carry low-only).
function hasEstimate(l: AuctionLot): boolean {
  return (((l.estHighUsd ?? l.estimateHigh) || 0) > 0) || (((l.estLowUsd ?? l.estimateLow) || 0) > 0);
}

/** Demand-read eligibility on the RECENT tape, not the all-time pool.
 *  All-time coverage let two failure modes through in both directions:
 *  the RR 30-yr archive's estimate-thin early years diluted coverage below
 *  60% for drills whose last-2-years tape is 76–98% covered (kept them
 *  descriptive), while a handful of rows coasted to 'demand' on estimate-rich
 *  POOLS with almost no recent sales at all (memorabilia:soccer held a demand
 *  read on FOUR sales in 8 quarters). A demand read now requires the recent
 *  window itself to be covered AND populated. */
const DEMAND_WINDOW_MS = 2 * 365.25 * 24 * 3600 * 1000; // trailing ~8 quarters
const DEMAND_MIN_RECENT = 60;                           // sold lots in-window
function demandEligibility(sold: AuctionLot[]): { estCoverage: number; recentSold: number; ok: boolean } {
  const cutoff = Date.now() - DEMAND_WINDOW_MS;
  const recent = sold.filter(l => l.saleDate && new Date(l.saleDate).getTime() >= cutoff);
  const denom = recent.length;
  const cov = denom ? recent.filter(hasEstimate).length / denom : 0;
  return { estCoverage: cov, recentSold: denom, ok: denom >= DEMAND_MIN_RECENT && cov >= MIN_EST_COVERAGE };
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

/** Reference-level watch identity: same maker + same reference is "the same
 *  product" the way a card key is — model-level, not unit-level (condition and
 *  box/papers vary within it, which the GLS gap-weighting and the 20x mis-link
 *  guard absorb; the CI is honest about the residual noise). Aug 6 2026 study:
 *  20,272 pairs across 3,498 references certify ALL three horizons at the
 *  watches vertical with the production gates untouched. */
function watchRefKey(l: AuctionLot): string | null {
  return l.reference ? `${l.artist}|${String(l.reference).toLowerCase().replace(/\s+/g, '')}` : null;
}

/** Edition-level art identity: same maker + same normalized title on a
 *  print/multiple pool. Strips edition numbering (22/50), AP/PP marks and
 *  dates so siblings of one edition pair up — model-level identity, like a
 *  watch reference. Restricted to edition-structured lots by the caller;
 *  unique originals must never enter this key. */
function editionKey(l: AuctionLot): string | null {
  const t = (l.title || '').toLowerCase()
    .replace(/\b\d+\s*\/\s*\d+\b/g, '')
    .replace(/\b(ap|pp|hc|tp|ed\.?|edition|numbered|signed)\b/g, '')
    .replace(/\([^)]*\d{4}[^)]*\)/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 8 ? `${l.artist}|${t}` : null;
}

function isEditionLot(l: AuctionLot): boolean {
  const f = `${l.formKey || ''} ${l.medium || ''}`.toLowerCase();
  return /print|multiple|edition|poster|lithograph|screenprint|etching/.test(f);
}

/** The one repeat-sale attempt, shared by drills and slug rows: pick the pool's
 *  natural identity (card > watch reference > art edition), require a real pool,
 *  and publish only what the engine's own gates certify. */
export function tryRepeatSale(sold: AuctionLot[], vertical: string): {
  index: SubMarketRead['index']; indexSeries?: SubMarketRead['indexSeries'];
} | null {
  let pool: AuctionLot[] = []; let key: (l: AuctionLot) => string | null = cardKey;
  const cardLots = sold.filter(l => cardKey(l) != null);
  if (cardLots.length >= 400) { pool = cardLots; key = cardKey; }
  else if (vertical === 'watches') {
    const refLots = sold.filter(l => watchRefKey(l) != null);
    if (refLots.length >= 400) { pool = refLots; key = watchRefKey; }
  } else if (vertical === 'art') {
    const edLots = sold.filter(l => isEditionLot(l) && editionKey(l) != null);
    if (edLots.length >= 400) { pool = edLots; key = editionKey; }
  }
  if (!pool.length) return null;
  const rs = buildRepeatSaleIndex(pool, key);
  for (const h of HORIZON_PREF) {
    const hz = rs.horizons?.[h];
    if (hz?.publishable && hz.changePct != null && hz.ciLoPct != null && hz.ciHiPct != null) {
      return {
        index: { horizon: h, changePct: hz.changePct, ciLoPct: hz.ciLoPct, ciHiPct: hz.ciHiPct },
        indexSeries: rs.series.slice(-24).map(pt => ({ period: pt.period.replace('-Q', ' Q'), value: pt.value, n: pt.nPairs })),
      };
    }
  }
  return null;
}

/** VERTICAL-LEVEL repeat-sale — the ladder's top rung at market altitude.
 *  Emitted into market.json as `repeatSale` so the hero tape can prefer it
 *  over hedonic/demand wherever it certifies. The scope label is part of the
 *  read: the sports figure is a CARDS read (cards carry the identity), and
 *  the art figure is an EDITIONS read — the UI must say so. */
export interface VerticalRepeatSale {
  method: 'repeat-sale';
  /** what the identity is — printed beside the figure, non-negotiable */
  basis: string;
  /** the population the read covers (e.g. 'cards', 'prints & multiples') */
  scope: string | null;
  nPairs: number;
  nObjects: number;
  horizons: Record<string, {
    publishable: boolean; changePct: number | null;
    ciLoPct: number | null; ciHiPct: number | null; reason?: string;
  }>;
  series: { period: string; value: number; n: number }[];
}

export function buildVerticalRepeatSale(sold: AuctionLot[], vertical: string): VerticalRepeatSale | null {
  let pool: AuctionLot[]; let key: (l: AuctionLot) => string | null;
  let basis: string; let scope: string | null;
  if (vertical === 'watches') {
    pool = sold.filter(l => watchRefKey(l) != null); key = watchRefKey;
    basis = 'same reference resold'; scope = null;
  } else if (vertical === 'art') {
    pool = sold.filter(l => isEditionLot(l) && editionKey(l) != null); key = editionKey;
    basis = 'same edition resold'; scope = 'prints & multiples';
  } else if (vertical === 'sports') {
    pool = sold.filter(l => cardKey(l) != null); key = cardKey;
    basis = 'same card, same grade, resold'; scope = 'cards';
  } else return null; // culture/science: title-proxy identity is too weak to certify —
                      // a "same title" pair is not a same-object pair for autographs.
  if (pool.length < 400) return null;
  const rs = buildRepeatSaleIndex(pool, key);
  const horizons: VerticalRepeatSale['horizons'] = {};
  let any = false;
  for (const [k, hz] of Object.entries(rs.horizons || {})) {
    if (!hz) continue;
    horizons[k] = { publishable: !!hz.publishable, changePct: hz.changePct ?? null, ciLoPct: hz.ciLoPct ?? null, ciHiPct: hz.ciHiPct ?? null, ...(hz.reason ? { reason: hz.reason } : {}) };
    if (hz.publishable) any = true;
  }
  if (!any) return null; // nothing certified — the block earns its place or stays out
  return {
    method: 'repeat-sale', basis, scope,
    nPairs: rs.nPairs ?? 0, nObjects: rs.nObjects ?? 0,
    horizons,
    series: (rs.series || []).slice(-24).map(pt => ({ period: pt.period.replace('-Q', ' Q'), value: pt.value, n: pt.nPairs })),
  };
}

// ── DRILL ROWS (the sub-category taxonomy, Jul 31 2026) ─────────────────────
// One SubMarketRead per approved A-vs-B split, emitted under market.json's NEW
// `drills` key (the existing subMarkets key is untouched — no consumer breaks).
// Partitions come from the corpus-normalize subCat/drill/flown stamps:
//   sports:   subCat × sport        (cards:basketball vs cards:baseball …)
//   watches:  maker × model family  (rolex:daytona vs patek-philippe:nautilus …)
//   culture:  subject domain        (music vs hollywood vs political …)
//   science:  space program + flown, tech/instrument types
//   art:      kind                  (prints vs originals vs sculpture …)
//   design:   kind + material       (seating vs tables; walnut vs teak …)
// Same honesty ladder as slug rows: repeat-sale index (cards only, CI-gated) →
// demand (est coverage ≥60%, ≥6 quarters) → descriptive. Row gate: ≥300 sold.
const DRILL_MIN_SOLD = 300;

export interface DrillRead extends SubMarketRead {
  /** the parent grouping this drill belongs to (subCat for sports, maker for
   *  watches, vertical for culture domains/art kinds) */
  parent: string;
}

function buildRead(
  slug: string, label: string, vertical: string, parent: string,
  lots: AuctionLot[],
): DrillRead | null {
  const sold = lots.filter(l => l.status === 'sold' && (l.priceUsd || 0) > 0);
  if (sold.length < DRILL_MIN_SOLD) return null;
  const boughtIn = lots.filter(l => l.status === 'bought_in');

  // descriptive layer straight from the pool (drills have no stats.json row)
  const now = Date.now();
  const ttm = sold.filter(l => now - new Date(l.saleDate).getTime() < YEAR_MS).map(l => l.priceUsd!);
  const typicalUsd = ttm.length >= 10 ? Math.round(median(ttm)) : null;
  let rec: AuctionLot | null = null;
  for (const l of sold) if (!rec || (l.priceUsd || 0) > (rec.priceUsd || 0)) rec = l;
  const record = rec ? { usd: rec.priceUsd!, title: rec.title || '', date: rec.saleDate || null, house: rec.auctionHouse || null } : null;
  const denomST = sold.length + boughtIn.length;
  const sellThroughPct = denomST >= 40 ? Math.round((100 * sold.length) / denomST) : null;
  const demand = demandEligibility(sold);
  const estCoverage = demand.estCoverage;
  const demandSeries = slugDemandSeries(sold);
  const demandNow = demandSeries.length ? demandSeries[demandSeries.length - 1].value : null;
  const bidCompSeries = bidCompetitionSeries(sold, { slug });
  const bidCompNow = bidCompSeries.length ? Math.round(bidCompSeries[bidCompSeries.length - 1].value) : null;

  // repeat-sale index wherever the pool carries a real object identity —
  // cards, watch references, art editions (mix-immune, CI-gated, one engine)
  let index: SubMarketRead['index'] = null;
  let indexMethod: SubMarketRead['indexMethod'] = null;
  let indexSeries: SubMarketRead['indexSeries'];
  const rsTry = tryRepeatSale(sold, vertical);
  if (rsTry) { index = rsTry.index; indexMethod = 'repeat-sale'; indexSeries = rsTry.indexSeries; }

  const readType: SubMarketRead['readType'] = index
    ? 'index'
    : (demand.ok && demandSeries.length >= MIN_DEMAND_QUARTERS ? 'demand' : 'descriptive');

  return {
    slug, label, vertical, parent, readType,
    index, indexMethod: readType === 'index' ? indexMethod : null,
    demandNow: readType === 'demand' ? demandNow : null,
    demandSeries: readType === 'demand' ? demandSeries : [],
    bidCompNow, typicalUsd, record,
    lots: lots.length, sellThroughPct,
    estCoverage: +estCoverage.toFixed(3),
    ...(indexSeries?.length ? { indexSeries } : {}),
    ...(() => { const v = quarterlyVolume(sold); return v ? { volSeries: v } : {}; })(),
    // culture SUBJECT-DOMAIN rows (slug 'culture:music'/'culture:hollywood'/…)
    // carry a long-horizon yearly typical-price series off the RR archive. Only
    // the subject-domain drills (parent 'culture'), not the culture-KIND rows.
    ...((vertical === 'culture' && parent === 'culture')
      ? (() => { const h = yearlyHist(sold); return h ? { histSeries: h } : {}; })()
      : {}),
  };
}

/** Build the drill rows per vertical from the stamped corpus. */
export function buildDrillRows(all: AuctionLot[]): Record<string, DrillRead[]> {
  const out: Record<string, DrillRead[]> = {};
  const put = (vertical: string, row: DrillRead | null) => { if (row) (out[vertical] || (out[vertical] = [])).push(row); };
  type L = AuctionLot & { subCat?: string; drill?: string; flown?: boolean };

  // one pass: bucket by every partition we emit
  const buckets = new Map<string, { slug: string; label: string; vertical: string; parent: string; lots: AuctionLot[] }>();
  const add = (key: string, slug: string, label: string, vertical: string, parent: string, l: AuctionLot) => {
    let b = buckets.get(key);
    if (!b) { b = { slug, label, vertical, parent, lots: [] }; buckets.set(key, b); }
    b.lots.push(l);
  };
  for (const raw of all) {
    const l = raw as L;
    const vert = ARTISTS_VERT[l.artist] || null;
    if (!vert || !l.subCat) continue;
    if (vert === 'sports' && l.drill) {
      add(`sp|${l.subCat}|${l.drill}`, `${l.subCat}:${l.drill}`, `${subCatLabel(l.drill)} · ${subCatLabel(l.subCat).toLowerCase()}`, 'sports', l.subCat, l);
    }
    if (vert === 'sports' && l.subCat === 'cards') {
      // the era axis — THE divergence story in cards ('track A vs B': vintage
      // vs modern was the one card split Collin kept). _card.year covers 85.6%
      // of sold cards; the repeat-sale index runs per era bucket via cardKey.
      const y = (l as unknown as { _card?: { year?: number } })._card?.year;
      const era = y == null ? null : y < 1980 ? 'vintage' : y < 2000 ? 'classic' : 'modern';
      if (era) add(`spe|${era}`, `cards-era:${era}`, subCatLabel(`era-${era}`), 'sports', 'cards', l);
    } else if (vert === 'watches' && l.drill) {
      add(`w|${l.artist}|${l.drill}`, `${l.artist}:${l.drill}`, `${subCatLabel(l.drill)} · ${ARTISTS_LABEL[l.artist] || l.artist}`, 'watches', l.artist, l);
    } else if (vert === 'culture') {
      if (l.drill) add(`c|${l.drill}`, `culture:${l.drill}`, subCatLabel(l.drill), 'culture', 'culture', l);
      if (l.subCat !== 'other') add(`ck|${l.subCat}`, `culture-kind:${l.subCat}`, subCatLabel(l.subCat), 'culture', 'kind', l);
    } else if (vert === 'science') {
      if (l.drill) add(`s|${l.subCat}|${l.drill}`, `${l.subCat}:${l.drill}`, subCatLabel(l.drill), 'science', l.subCat, l);
      if (l.flown) add('s|flown', 'space:flown', 'Flown artifacts', 'science', 'space', l);
    } else if (vert === 'art') {
      if (l.subCat !== 'other') add(`a|${l.subCat}`, `art:${l.subCat}`, subCatLabel(l.subCat), 'art', 'art', l);
    } else if (vert === 'design') {
      add(`d|${l.subCat}`, `design:${l.subCat}`, subCatLabel(l.subCat), 'design', 'design', l);
      if (l.drill) add(`dm|${l.drill}`, `design-material:${l.drill}`, subCatLabel(l.drill), 'design', 'material', l);
    }
  }
  buckets.forEach(b => put(b.vertical, buildRead(b.slug, b.label, b.vertical, b.parent, b.lots)));

  // same rank discipline as the slug rows
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

// slug → vertical (built once from ARTISTS — same source as buildSubMarkets)
const ARTISTS_VERT: Record<string, string> = {};
const ARTISTS_LABEL: Record<string, string> = {};
for (const a of ARTISTS) { ARTISTS_VERT[a.slug] = a.market; ARTISTS_LABEL[a.slug] = a.label; }

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
    const demand = demandEligibility(sold);
    const estCoverage = demand.estCoverage;

    // ── demand series (hammer-basis %-over-estimate) ──
    const demandSeries = slugDemandSeries(sold);
    const demandNow = demandSeries.length ? demandSeries[demandSeries.length - 1].value : null;

    // ── bid-competition secondary read (cards): latest-quarter median bids/lot.
    // A demand primitive from Goldin's bidCount — only the cards slug ships it,
    // so this is null for every other sub-market. NOT a price move / % over est.
    const bidCompSeries = bidCompetitionSeries(sold, { slug });
    const bidCompNow = bidCompSeries.length ? Math.round(bidCompSeries[bidCompSeries.length - 1].value) : null;

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
      const rsTry = tryRepeatSale(sold, market);
      if (rsTry) { index = rsTry.index; indexMethod = 'repeat-sale'; }
    }

    // ── readType decision ──
    // 'index' if a publishable maker horizon exists; else 'demand' when the slug
    // genuinely carries estimates over enough quarters; else 'descriptive'.
    const readType: SubMarketRead['readType'] = index
      ? 'index'
      : (demand.ok && demandSeries.length >= MIN_DEMAND_QUARTERS ? 'demand' : 'descriptive');

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
      // bidCompNow rides on ANY read type (it's support, not the headline) — on
      // the cards row it sits beside the CI'd repeat-sale index as a demand
      // secondary. null wherever the slug ships no bidCount.
      bidCompNow,
      typicalUsd,
      record,
      lots: lotCount,
      sellThroughPct,
      estCoverage: +estCoverage.toFixed(3),
      ...(() => { const v = quarterlyVolume(sold); return v ? { volSeries: v } : {}; })(),
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
