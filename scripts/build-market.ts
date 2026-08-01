/**
 * build-market.ts — the engine's build pass. Runs the value + index engines
 * over the full corpus and emits:
 *   - data/corpus/*.json.gz          : stamps `value` on upcoming lots +
 *                                       `repeatSaleGroupId` on physical groups
 *   - public/data/ray/market.json    : the market dashboards (per-market series)
 *   - public/data/ray/upcoming.json  : re-stamps upcoming lots' `value` for the
 *                                       eager client payload (via build-upcoming)
 *
 * Deterministic, build-time only. The client ships precomputed results.
 *
 * Run: npx tsx scripts/build-market.ts   (after a crawl / migrate)
 */
import * as fs from 'fs';
import * as path from 'path';
import type { AuctionLot } from '../app/types';
import { buildIdf, buildVectors, similarity, idf } from '../app/lib/similarity';
import { resolveComps, estimateValue, setCalibration, type ValueResult } from '../app/lib/value';
import { buildMarketSeries, type MarketSeries } from '../app/lib/indices';
import { buildHedonicIndex, buildMakerIndex, buildComposite, type HedonicResult, type MakerIndexResult, type CompositeInput } from './hedonic-index';
import { buildSubMarkets, buildDrillRows } from './sub-markets';
import { fitGradeLadder } from './lib/grade-ladder';
import { sportOf, overEstimatePct } from '../app/utils';
import type { MarketAnalytics } from '../app/types';

// Build-time distribution aggregates over the FULL corpus for a market's lots,
// so the analytics charts (Top sales, Price distribution, Sport/Category
// breakdown) read the true 433k-sold picture instead of iterating the ~38k
// slim/sample client payload (which garbles the sports/cards vertical).
const PRICE_RANGES: [string, number, number][] = [
  ['$0–1K', 0, 1_000], ['$1K–5K', 1_000, 5_000], ['$5K–25K', 5_000, 25_000],
  ['$25K–100K', 25_000, 100_000], ['$100K–500K', 100_000, 500_000], ['$500K+', 500_000, Infinity],
];
function marketAnalytics(lots: AuctionLot[]): MarketAnalytics {
  const sold = lots.filter(l => l.status === 'sold' && (l.priceUsd || 0) > 0);
  const topSales = sold.slice().sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0)).slice(0, 20).map(l => ({
    id: String(l.id), artist: l.artist, title: l.title || '', priceUsd: l.priceUsd || 0,
    url: l.url || '', auctionHouse: l.auctionHouse || '', saleDate: l.saleDate || '',
    sport: (l as AuctionLot & { sport?: string }).sport ?? null, overEst: overEstimatePct(l),
  }));
  const priceBuckets = PRICE_RANGES.map(([label, min, max]) => {
    const m = sold.filter(l => l.priceUsd! >= min && l.priceUsd! < max);
    return { label, count: m.length, totalValue: m.reduce((s, l) => s + (l.priceUsd || 0), 0) };
  });
  const sMap: Record<string, { count: number; totalValue: number }> = {};
  for (const l of sold) {
    const sp = (l as AuctionLot & { sport?: string }).sport ?? 'Other';
    (sMap[sp] || (sMap[sp] = { count: 0, totalValue: 0 })).count++;
    sMap[sp].totalValue += l.priceUsd || 0;
  }
  const sportBreakdown = Object.entries(sMap).map(([sport, d]) => ({ sport, ...d })).sort((a, b) => b.totalValue - a.totalValue);
  const cMap: Record<string, { revenue: number; count: number; soldCount: number }> = {};
  for (const l of lots) {
    const cat = l.category || 'unknown';
    (cMap[cat] || (cMap[cat] = { revenue: 0, count: 0, soldCount: 0 })).count++;
    if (l.status === 'sold' && (l.priceUsd || 0) > 0) { cMap[cat].revenue += l.priceUsd || 0; cMap[cat].soldCount++; }
  }
  const categoryBreakdown = Object.entries(cMap).filter(([c]) => c !== 'unknown')
    .map(([categoryKey, d]) => ({ categoryKey, ...d })).sort((a, b) => b.revenue - a.revenue);
  return { topSales, priceBuckets, sportBreakdown, categoryBreakdown };
}

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const SERVED = path.join(process.cwd(), 'public', 'data', 'ray');

const MARKETS: Record<string, string[]> = {
  art: ['george-condo', 'kaws', 'andy-warhol', 'keith-haring', 'ed-ruscha', 'pablo-picasso', 'henri-matisse', 'tom-sachs', 'peter-saul', 'raymond-pettibon', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy', 'francesco-clemente', 'eddie-martinez', 'kenny-scharf'],
  design: ['george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret'],
  watches: ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'],
  sports: ['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia'],
  science: ['space-exploration', 'meteorites', 'fossils', 'scientific-instruments'],
  culture: ['movie-tv', 'music-memorabilia', 'entertainment-memorabilia'],
};

function readGz(f: string): AuctionLot[] {
  // buffer-safe NDJSON read — the sold-archive exceeds V8's max string length
  const { readGzRows } = require('./corpus-io');
  return readGzRows(path.join(CORPUS, f + '.gz')) as AuctionLot[];
}

export function runMarketBuild() {
  const t0 = Date.now();
  console.log('[market] reading corpus…');
  const lots = readGz('lots.json');
  const archive = readGz('sold-archive.json');
  const all = lots.concat(archive);

  // ── corpus-hygiene normalization (idempotent) ──
  // Fix defects already baked into the corpus BEFORE any market/hedonic/stats is
  // built: null mis-parsed future years, reroute blue-chip-art / watch lots that
  // were swept into the science slugs, and back-fill missing watch references.
  // Runs here so a standalone build-market applies them too; the nightly runs the
  // same pass in assemble.ts (which persists the fixes into the corpus gz).
  const { normalizeCorpus } = require('./lib/corpus-normalize');
  normalizeCorpus(all);

  // load the auto-calibration the previous backtest emitted (per-market
  // beatRate relevel + conformal band multipliers) — displayed figures only,
  // never the signal label, so there is no feedback loop into the record.
  try {
    const bt = JSON.parse(fs.readFileSync(path.join(SERVED, 'backtest.json'), 'utf8'));
    if (bt.calibration?.beatRate?.global) {
      const marketBySlug: Record<string, string> = {};
      for (const [mkt, slugs] of Object.entries(MARKETS)) for (const s of slugs) marketBySlug[s] = mkt;
      setCalibration({ ...bt.calibration, marketBySlug });
      console.log(`[market] calibration loaded (n=${bt.calibration.n})`);
    }
  } catch { /* no backtest yet — hardcoded fallbacks apply */ }

  // clear any prior stamps so a re-run is idempotent (never inherits a looser
  // pass's groups)
  for (const l of all) { delete (l as AuctionLot & { repeatSaleGroupId?: unknown }).repeatSaleGroupId; delete (l as AuctionLot & { value?: unknown }).value; }

  // Sport cards are a DATA asset, not an engine-valued vertical: 348k of them
  // would make the valuation pool (per live lot) and the repeat-sale grouping
  // explode, and a mass-produced card is not a unique object (title similarity
  // would falsely group different copies). They stay in the CORPUS (written
  // below) but never enter the engine — no value, no comps, no repeat-sale.
  //
  // The Sotheby's Algolia discovery backfill (source:'sothebys-algolia', ~370k
  // net-new sold lots) rides the SAME exclusion for the SAME reason: the memory
  // notes flag repeat-sale + per-lot valuation as ~96% of build time, exploding
  // with pool size, and these lots carry only THIN metadata (title/fullText —
  // no dimensions/reference/edition) so they'd add enormous cost with weak
  // physical-match signal. Like cards, they stay in `all` (so they feed
  // stats.json / market series / records / the sold archive) but never enter
  // the engine pool — no value, no comps, no repeat-sale grouping.
  const CARDS = 'sports-cards';
  const engineAll = all.filter(l =>
    l.artist !== CARDS &&
    (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');

  const sold = engineAll.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length);
  const tbl = buildIdf(sold);
  buildVectors(engineAll, tbl);    // attach _v to every engine lot (upcoming need it too)
  const soldSorted = sold.slice().sort((a, b) => a.saleDate < b.saleDate ? -1 : 1);
  const soldPos = new Map(soldSorted.map((l, i) => [l.id, i]));
  console.log(`[market] ${all.length} lots · ${sold.length} priced sold · vocab ${Object.keys(tbl.df).length}`);

  // bucket the FULL corpus by artist ONCE (order preserved from `all`) so the
  // per-SLUG series below (maker indices, per-maker mini-series, the corpus-only
  // stats rows) read their lots in O(1) instead of rescanning all ~507k lots per
  // maker (~40 makers × 507k = ~20M ops). Map push preserves `all` order, so each
  // bucket is identical to the old single-slug `all.filter` output → every
  // downstream aggregate is byte-for-byte the same. Mirrors assemble.ts's
  // group-by pass. (The few MULTI-slug market filters keep their gated single
  // pass over `all` so a market's lots stay in `all`-ORDER — a stable price-sort
  // in marketAnalytics.topSales tie-breaks on it.)
  const allByArtist = new Map<string, AuctionLot[]>();
  for (const l of all) { const a = allByArtist.get(l.artist); if (a) a.push(l); else allByArtist.set(l.artist, [l]); }
  const lotsForSlug = (slug: string): AuctionLot[] => allByArtist.get(slug) || [];

  // pre-parse each lot's saleDate → numeric ms ONCE (transient `_saleMs`, deleted
  // before serialize below). The ttm windows in refs/players recompute
  // new Date(saleDate).getTime() per lot otherwise. Invalid/absent dates parse to
  // NaN — identical to the inline `new Date(l.saleDate!).getTime()` they replace
  // (NaN > cut is false either way), so the isNaN behaviour is preserved exactly.
  for (const l of all) (l as AuctionLot & { _saleMs?: number })._saleMs = new Date(l.saleDate as string).getTime();

  // ── 1 · value every UPCOMING lot (the live product) ──
  // bucket sold lots by maker ONCE (time-order preserved from soldSorted) so each
  // upcoming lot reads its same-maker pool in O(1) instead of rescanning all 36k.
  const soldByArtist = new Map<string, AuctionLot[]>();
  for (const s of soldSorted) (soldByArtist.get(s.artist) || soldByArtist.set(s.artist, []).get(s.artist)!).push(s);
  const upcoming = engineAll.filter(l => l.status === 'upcoming');
  let valued = 0;
  const tVal = Date.now();
  // sports lots: restrict priors to comps sharing the extracted sport/entity —
  // measured on the Goldin holdout: coverage +44% relative with a paired
  // accuracy WIN (p≈0.003). Unrestricted fallback when the restriction can't
  // seat 3 priors. Sport-of is cached per comp id (regex battery is not free).
  const SPORTS_SET = new Set(MARKETS.sports);
  const sportCache = new Map<string, string | null>();
  const sportOfCached = (l: AuctionLot) => {
    let s = sportCache.get(l.id);
    if (s === undefined) { s = sportOf(l.title || ''); sportCache.set(l.id, s); }
    return s;
  };
  // PLAYER identity of a sports lot — a game-used object must comp SAME PLAYER
  // only, never merely same-sport. `entity` is only ~22% populated on game-used
  // lots and _pid/playerSlug isn't stamped until the §3 player pass (which runs
  // AFTER this valuation), so resolve it here: prefer an already-stamped id,
  // else the served playerSlug/entity, else parse the title (playerOf — the same
  // parser §3 uses). Cached per lot id (the title regex battery is not free).
  const { playerOf: playerOfTitle } = require('../app/lib/cards');
  const playerCache = new Map<string, string | null>();
  const playerSlugOf = (l: AuctionLot): string | null => {
    const cached = playerCache.get(l.id);
    if (cached !== undefined) return cached;
    const lw = l as { _pid?: string | null; playerSlug?: string | null; entity?: string | null };
    const p: string | null = lw._pid ?? lw.playerSlug ?? lw.entity ?? playerOfTitle(l.title || '', l.artist).playerSlug ?? null;
    playerCache.set(l.id, p);
    return p;
  };
  for (const lot of upcoming) {
    let pool = soldByArtist.get(lot.artist) || [];
    if (SPORTS_SET.has(lot.artist)) {
      const pid = playerSlugOf(lot);
      if (pid) {
        // KNOWN player → same-player pool ONLY. Use it even if thin (<3): an
        // honest thin same-player pool is correct, and if it comes up empty the
        // lot simply won't seat enough comps and estimateValue abstains
        // (value=null). Do NOT fall back to same-sport — that reintroduces the
        // cross-player bug.
        pool = pool.filter(c => playerSlugOf(c) === pid);
      } else {
        // NO readable player (~19% the title parser can't read) → same-SPORT is
        // the best-available fallback, gated ≥3 as before.
        const sp = sportOfCached(lot);
        if (sp) {
          const restricted = pool.filter(c => sportOfCached(c) === sp);
          if (restricted.length >= 3) pool = restricted;
        }
      }
    }
    const comps = resolveComps(lot as AuctionLot & { _v?: Record<string, number> }, pool as (AuctionLot & { _v?: Record<string, number> })[], tbl);
    const v = estimateValue(lot as AuctionLot & { _v?: Record<string, number> }, comps, tbl);
    if (v) { (lot as AuctionLot & { value?: ValueResult }).value = v; valued++; }
    else (lot as AuctionLot & { value?: ValueResult | null }).value = null;
  }
  console.log(`[market] valued ${valued}/${upcoming.length} upcoming lots · ${((Date.now() - tVal) / 1000).toFixed(0)}s`);

  // ── 2 · repeat-sale groups: physical matches among SOLD lots ──
  // union-find over physicalMatch pairs (title-justified, per the doctrine).
  // BLOCKING (measured Jul 2026): the old maker∪rare-token CandidateIndex made
  // this loop 96% of the whole build (~19 min at 110k sold — the same-maker
  // union alone is ~400M similarity calls once Picasso/Patek/Rolex pass 10k
  // each). Physical matches must share evidence, so we block on exactly that:
  // shared rare title token ∪ same maker+reference ∪ same maker+serialNo.
  // Recall was validated against the full-blocking ground truth (244 pairs):
  // rare tokens alone find 241; the ref/serial blocks recover the other 3
  // (watch pairs whose titles are written in different catalog styles).
  const tRs = Date.now();
  const RARE_K = 6;
  const byToken = new Map<string, number[]>();
  const byMakerRef = new Map<string, number[]>();
  const bySerial = new Map<string, number[]>();
  const rareTokens: string[][] = [];
  soldSorted.forEach((l, i) => {
    const rare = Array.from(new Set(l.titleTokens || []))
      .map(t => [t, idf(t, tbl)] as [string, number])
      .sort((x, y) => y[1] - x[1]).slice(0, RARE_K).map(x => x[0]);
    rareTokens[i] = rare;
    for (const t of rare) (byToken.get(t) || byToken.set(t, []).get(t)!).push(i);
    const ref = (l as AuctionLot & { reference?: string | null }).reference;
    if (ref) { const k = `${l.artist}|${ref}`; (byMakerRef.get(k) || byMakerRef.set(k, []).get(k)!).push(i); }
    const ser = (l as AuctionLot & { serialNo?: string | null }).serialNo;
    if (ser) { const k = `${l.artist}|${ser}`; (bySerial.get(k) || bySerial.set(k, []).get(k)!).push(i); }
  });
  const candidatesOf = (i: number): number[] => {
    const l = soldSorted[i];
    const set = new Set<number>();
    for (const t of rareTokens[i]) for (const j of byToken.get(t) || []) set.add(j);
    const ref = (l as AuctionLot & { reference?: string | null }).reference;
    if (ref) for (const j of byMakerRef.get(`${l.artist}|${ref}`) || []) set.add(j);
    const ser = (l as AuctionLot & { serialNo?: string | null }).serialNo;
    if (ser) for (const j of bySerial.get(`${l.artist}|${ser}`) || []) set.add(j);
    set.delete(i);
    return Array.from(set);
  };
  // CHEAP PRE-CHECK — a pair can classify as 'physicalMatch' ONLY through one of
  // similarity.ts::classify's physical branches, each gated on a hard STRUCTURED
  // discriminator (matching real serial / real edition for makers, or
  // both-photo-matched + same entity for sports/science objects). Those
  // predicates are O(1) field reads; the full similarity() (cosine over the token
  // vectors + the structured battery) is far heavier. Since the grouper unions
  // ONLY on cls==='physicalMatch', skipping any pair that fails ALL physical
  // branches here can never change a union — it just avoids scoring a pair whose
  // best possible outcome is model/similar. Predicates are copied VERBATIM from
  // classify() so the skip set is exactly the non-physical complement.
  const SPORTS_SCIENCE_SLUGS = new Set([
    'game-used', 'trophies-awards', 'tickets-passes',
    'space-exploration', 'meteorites', 'fossils', 'scientific-instruments',
  ]);
  const realSerial = (s?: string | null) => !!s && s.length >= 4 && /\d/.test(s) && /^[a-z0-9./-]+$/i.test(s);
  const canPhysicalMatch = (a: AuctionLot, b: AuctionLot): boolean => {
    const isSportsSci = (SPORTS_SCIENCE_SLUGS.has(a.artist) || a.category === 'object') && a.entityClass !== 'maker';
    if (isSportsSci) {
      return !!(a.photoMatched && b.photoMatched && a.entity && a.entity === b.entity);
    }
    if (a.entityClass === 'maker') {
      if (realSerial(a.serialNo) && a.serialNo === b.serialNo) return true;
      const realEdition = a.editionMarker != null && a.editionOf && a.editionTotal
        && a.editionOf <= a.editionTotal && a.editionTotal <= 500
        && (a.category === 'print' || a.category === 'original');
      return !!(realEdition && a.editionMarker === b.editionMarker
        && a.editionOf === b.editionOf && a.editionTotal === b.editionTotal);
    }
    return false;
  };
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  let physPairs = 0;
  for (let i = 0; i < soldSorted.length; i++) {
    const lot = soldSorted[i];
    if (!parent.has(lot.id)) parent.set(lot.id, lot.id);
    const cands = candidatesOf(i).map(j => soldSorted[j]);
    for (const c of cands) {
      if (c.id <= lot.id) continue;   // dedup pair direction
      // fast structured pre-check: skip the full score for any pair that can't
      // reach 'physicalMatch' (the only class the grouper unions on) — identical
      // union set, far fewer cosine evaluations.
      if (!canPhysicalMatch(lot, c)) continue;
      const m = similarity(lot, c, tbl);
      if (m.cls === 'physicalMatch') {
        // price-sanity: the same physical object shouldn't swing >3x between two
        // sales close in the corpus — a wild gap means different objects that
        // share the identifier (e.g. a player's jersey vs shorts from one game).
        const r = (lot.realizedUsd || 0) / (c.realizedUsd || 1);
        if (r > 3 || r < 1 / 3) continue;
        if (!parent.has(c.id)) parent.set(c.id, c.id);
        union(lot.id, c.id); physPairs++;
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const l of soldSorted) { const r = find(l.id); (groups.get(r) || groups.set(r, []).get(r)!).push(l.id); }
  let physGroups = 0;
  const idToLot = new Map(engineAll.map(l => [l.id, l]));
  for (const [root, ids] of Array.from(groups.entries())) {
    if (ids.length < 2) continue;
    physGroups++;
    for (const id of ids) (idToLot.get(id) as AuctionLot & { repeatSaleGroupId?: string }).repeatSaleGroupId = 'rs_' + root.slice(-10);
  }
  console.log(`[market] repeat-sale: ${physPairs} physical pairs → ${physGroups} groups · ${((Date.now() - tRs) / 1000).toFixed(0)}s`);

  // ── 3 · market series (the dashboards) ──
  // Series run over `all` (INCLUDING cards): the analytics are O(n) aggregation,
  // not the O(pool) valuation/repeat-sale cards were held out of. So the sports
  // vertical's volume/depth/index reflect the ~300k card market, and card lots
  // count in every dashboard — while cards still carry no per-lot value/comps.
  const markets: Record<string, MarketSeries> = {};
  // hedonic = the statistically-defensible replacement index (added ALONGSIDE
  // the legacy cohort index, which other code still reads). Log-price hedonic
  // regression with robust IRLS + honest gating. See scripts/hedonic-index.ts.
  const hedonic: Record<string, HedonicResult> = {};

  // ── 3-hedonic-a · per-MAKER hedonic index (bottom-up components) ──
  // One hedonic per roster maker over THAT maker's lots (maker dummy dropped;
  // within-maker drivers refModel/form/size/year/house carry the mix). Engine-
  // excluded verticals (sports-cards, sothebys-algolia backfill) never enter a
  // component index — they can't be held like-for-like. These are the building
  // blocks the market composites are assembled from.
  const HEDONIC_EXCLUDE = (l: AuctionLot) => l.artist === 'sports-cards'
    || (l as AuctionLot & { source?: string }).source === 'sothebys-algolia';
  const rosterSlugs = Array.from(new Set(Object.values(MARKETS).flat()));
  const makerIndex: Record<string, MakerIndexResult> = {};
  const makerRealized: Record<string, number> = {};
  const makerLotsBySlug = new Map<string, AuctionLot[]>();
  for (const slug of rosterSlugs) {
    const ls = lotsForSlug(slug).filter(l => !HEDONIC_EXCLUDE(l));
    makerLotsBySlug.set(slug, ls);
    makerIndex[slug] = buildMakerIndex(ls);
    makerRealized[slug] = ls.reduce((s, l) => s + (l.status === 'sold' ? (l.realizedUsd || 0) : 0), 0);
    const h1 = makerIndex[slug].horizons['1Y'];
    const anyPub = Object.values(makerIndex[slug].horizons).some(h => h.publishable);
    if (anyPub) console.log(`[market] maker ${slug.padEnd(18)} lastComplete=${makerIndex[slug].lastCompleteQuarter} 1Y=${h1.publishable ? `${h1.changePct!.toFixed(1)}% [${h1.ciLoPct!.toFixed(1)},${h1.ciHiPct!.toFixed(1)}]` : `(3Y/5Y only)`} cov=${makerIndex[slug].coverageMakerLots}`);
  }
  console.log(`[market] maker indices: ${Object.keys(makerIndex).length} built, ${Object.values(makerIndex).filter(mi => Object.values(mi.horizons).some(h => h.publishable)).length} with ≥1 publishable horizon`);

  // helper: build a market's composite from its component maker indices
  const compositeFor = (slugs: string[]): CompositeInput[] =>
    slugs.map(slug => ({ slug, index: makerIndex[slug], realized: makerRealized[slug] || 0 }));

  for (const m in MARKETS) {
    const set = new Set(MARKETS[m]);
    const mLots = all.filter(l => set.has(l.artist));
    markets[m] = buildMarketSeries(mLots, m);
    markets[m].analytics = marketAnalytics(mLots);
    hedonic[m] = buildHedonicIndex(mLots);
    hedonic[m].composite = buildComposite(compositeFor(MARKETS[m]), MARKETS[m].length);
    const idxLen = markets[m].index.length;
    const h1 = hedonic[m].horizons['1Y'];
    const cmp = hedonic[m].composite!;
    console.log(`[market] ${m.padEnd(8)} index ${idxLen}pts · sellThrough ${markets[m].sellThrough.length}pts · houseAcc ${markets[m].houseAccuracy.length}pts · n${markets[m].n}`);
    console.log(`[market] ${m.padEnd(8)} hedonic: lastComplete=${hedonic[m].lastCompleteQuarter} 1Y=${h1.publishable ? `${h1.changePct!.toFixed(1)}% [${h1.ciLoPct!.toFixed(1)},${h1.ciHiPct!.toFixed(1)}] n${h1.nStart}/${h1.nEnd}` : `NOT-PUB (${h1.reason})`}`);
    console.log(`[market] ${m.padEnd(8)} composite: pub=${cmp.publishable} components=${cmp.components.filter(c => c.publishable).length} 1Y=${cmp.horizons['1Y'].publishable ? `${cmp.horizons['1Y'].changePct!.toFixed(1)}% [${cmp.horizons['1Y'].ciLoPct!.toFixed(1)},${cmp.horizons['1Y'].ciHiPct!.toFixed(1)}]` : `NOT-PUB (${cmp.reason || cmp.horizons['1Y'].reason})`}`);
  }
  // the aggregate 'all' market — every tracked maker/slug
  const allSlugs = new Set(rosterSlugs);
  const allMarketLots = all.filter(l => allSlugs.has(l.artist));
  markets.all = buildMarketSeries(allMarketLots, 'the market');
  markets.all.analytics = marketAnalytics(allMarketLots);
  hedonic.all = buildHedonicIndex(allMarketLots);
  hedonic.all.composite = buildComposite(compositeFor(rosterSlugs), rosterSlugs.length);
  const hAll1 = hedonic.all.horizons['1Y'];
  const cmpAll = hedonic.all.composite!;
  console.log(`[market] all      index ${markets.all.index.length}pts · n${markets.all.n}`);
  console.log(`[market] all      hedonic: lastComplete=${hedonic.all.lastCompleteQuarter} 1Y=${hAll1.publishable ? `${hAll1.changePct!.toFixed(1)}%` : `NOT-PUB (${hAll1.reason})`}`);
  console.log(`[market] all      composite: pub=${cmpAll.publishable} components=${cmpAll.components.filter(c => c.publishable).length} 1Y=${cmpAll.horizons['1Y'].publishable ? `${cmpAll.horizons['1Y'].changePct!.toFixed(1)}% [${cmpAll.horizons['1Y'].ciLoPct!.toFixed(1)},${cmpAll.horizons['1Y'].ciHiPct!.toFixed(1)}]` : `NOT-PUB (${cmpAll.reason || cmpAll.horizons['1Y'].reason})`}`);

  // per-maker mini-series for the big names (drill-down)
  const makers: Record<string, MarketSeries> = {};
  const makerCounts = new Map<string, number>();
  sold.forEach(l => makerCounts.set(l.artist, (makerCounts.get(l.artist) || 0) + 1));
  for (const [slug, n] of Array.from(makerCounts.entries())) {
    if (n < 120) continue;
    makers[slug] = buildMarketSeries(lotsForSlug(slug), slug);
  }
  // sports-cards is engine-excluded so it never enters `sold`/makerCounts —
  // build its maker series explicitly over the FULL card corpus, or the
  // /sports-cards analytics reads "insufficient data" against 288k real sales.
  makers['sports-cards'] = buildMarketSeries(lotsForSlug('sports-cards'), 'sports-cards');
  console.log(`[market] makers series: ${Object.keys(makers).length} (sports-cards n=${makers['sports-cards'].n})`);

  // ── 3b · house calibration: per house×market estimate honesty ──
  // Dual-basis doctrine: estimates are hammer-basis, realized is premium-
  // inclusive — so the honest "does this house's estimate hold" read is
  // HAMMER vs estimate-mid (hammerUsd when published, realized/1.25 else).
  const median = (a: number[]): number => {
    const s = a.slice().sort((x, y) => x - y); const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const marketOfSlug = new Map<string, string>();
  for (const [mkt, slugs] of Object.entries(MARKETS)) for (const s of slugs) marketOfSlug.set(s, mkt);
  type HouseCell = { n: number; hammerMedPct: number; allInMedPct: number };
  const houseObs = new Map<string, { h: number[]; a: number[] }>();
  for (const l of sold) {
    const mkt = marketOfSlug.get(l.artist);
    const lo = (l as AuctionLot & { estLowUsd?: number }).estLowUsd || 0;
    const hi = (l as AuctionLot & { estHighUsd?: number }).estHighUsd || 0;
    if (!mkt || !l.auctionHouse || !(lo > 0 && hi > 0)) continue;
    const mid = (lo + hi) / 2;
    const hammer = (l as AuctionLot & { hammerUsd?: number }).hammerUsd || (l.realizedUsd! / 1.25);
    for (const key of [`${l.auctionHouse}|${mkt}`, `${l.auctionHouse}|all`]) {
      const o = houseObs.get(key) || houseObs.set(key, { h: [], a: [] }).get(key)!;
      o.h.push(100 * (hammer / mid - 1));
      o.a.push(100 * (l.realizedUsd! / mid - 1));
    }
  }
  const houseCal: Record<string, Record<string, HouseCell>> = {};
  for (const [key, o] of Array.from(houseObs.entries())) {
    if (o.h.length < 40) continue; // statistical floor — never cite thin cells
    const [house, mkt] = key.split('|');
    (houseCal[house] ||= {})[mkt] = {
      n: o.h.length,
      hammerMedPct: Math.round(median(o.h)),
      allInMedPct: Math.round(median(o.a)),
    };
  }

  // ── 3c · seasonality: calendar-month performance + sell-through per market ──
  // The month a lot hammers is a real lever (marquee seasons vs summer lulls);
  // now credible with per-market n in the thousands. UI gates on n.
  type MonthCell = { n: number; hammerMedPct: number; allInMedPct: number; sellThroughPct: number | null };
  const seasonality: Record<string, MonthCell[]> = {};
  const estOk = (l: AuctionLot) => ((l as AuctionLot & { estLowUsd?: number }).estLowUsd || 0) > 0 && ((l as AuctionLot & { estHighUsd?: number }).estHighUsd || 0) > 0;
  const boughtIn = all.filter(l => l.status === 'bought_in' && l.saleDate && estOk(l));
  for (const mkt of Object.keys(MARKETS).concat('all')) {
    const slugSet = mkt === 'all' ? new Set(Object.values(MARKETS).flat()) : new Set(MARKETS[mkt]);
    const cells: MonthCell[] = [];
    for (let m = 1; m <= 12; m++) {
      const inMonth = (l: AuctionLot) => slugSet.has(l.artist) && l.saleDate && +l.saleDate.slice(5, 7) === m;
      const s = sold.filter(l => inMonth(l) && estOk(l));
      const bi = boughtIn.filter(inMonth).length;
      if (s.length < 30) { cells.push({ n: s.length, hammerMedPct: 0, allInMedPct: 0, sellThroughPct: null }); continue; }
      const mids = s.map(l => (((l as AuctionLot & { estLowUsd?: number }).estLowUsd || 0) + ((l as AuctionLot & { estHighUsd?: number }).estHighUsd || 0)) / 2);
      cells.push({
        n: s.length,
        hammerMedPct: Math.round(median(s.map((l, i) => 100 * ((((l as AuctionLot & { hammerUsd?: number }).hammerUsd || (l.realizedUsd! / 1.25)) / mids[i]) - 1)))),
        allInMedPct: Math.round(median(s.map((l, i) => 100 * (l.realizedUsd! / mids[i] - 1)))),
        sellThroughPct: (s.length + bi) >= 50 ? Math.round(100 * s.length / (s.length + bi)) : null,
      });
    }
    seasonality[mkt] = cells;
  }

  // ── 3d · watch reference aggregates → refs.json (the /ref pages) ──
  const tRef = Date.now();
  const WATCH_SET = new Set(MARKETS.watches);
  const byRef = new Map<string, AuctionLot[]>();
  for (const l of sold) {
    const r = (l as AuctionLot & { reference?: string | null }).reference;
    if (!WATCH_SET.has(l.artist) || !r) continue;
    const k = `${l.artist}:${r}`;
    (byRef.get(k) || byRef.set(k, []).get(k)!).push(l);
  }
  const refsOut: Record<string, unknown>[] = [];
  for (const [key, ls] of Array.from(byRef.entries())) {
    if (ls.length < 8) continue; // a reference page needs a real sample
    ls.sort((a, b) => (a.saleDate! < b.saleDate! ? -1 : 1));
    const prices = ls.map(l => l.realizedUsd!);
    const byYear = new Map<number, number[]>();
    for (const l of ls) { const y = +l.saleDate!.slice(0, 4); (byYear.get(y) || byYear.set(y, []).get(y)!).push(l.realizedUsd!); }
    const yearly = Array.from(byYear.entries()).filter(([, v]) => v.length >= 3).sort((a, b) => a[0] - b[0])
      .map(([y, v]) => ({ y, med: Math.round(median(v)), n: v.length }));
    const withEst = ls.filter(l => ((l as AuctionLot & { estHighUsd?: number }).estHighUsd || 0) > 0);
    const cut = Date.now() - 365 * 864e5;
    const ttm = ls.filter(l => (l as AuctionLot & { _saleMs?: number })._saleMs! > cut).map(l => l.realizedUsd!);
    refsOut.push({
      key,
      maker: ls[0].artist,
      ref: key.slice(key.indexOf(':') + 1),
      n: ls.length,
      medianUsd: Math.round(median(prices)),
      ttmMedianUsd: ttm.length >= 5 ? Math.round(median(ttm)) : null,
      beatHighPct: withEst.length >= 8
        ? Math.round(100 * withEst.filter(l => l.realizedUsd! > ((l as AuctionLot & { estHighUsd?: number }).estHighUsd || 0)).length / withEst.length)
        : null,
      houses: Array.from(new Set(ls.map(l => l.auctionHouse).filter(Boolean))).sort(),
      yearly,
      recent: ls.slice(-8).reverse().map(l => ({
        id: l.id, d: l.saleDate, h: l.auctionHouse, p: Math.round(l.realizedUsd!),
        t: (l.title || '').slice(0, 80), img: l.imageUrl || null,
      })),
    });
  }
  refsOut.sort((a, b) => (b.n as number) - (a.n as number));
  fs.mkdirSync(SERVED, { recursive: true });
  fs.writeFileSync(path.join(SERVED, 'refs.json'), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), refs: refsOut }));
  console.log(`[market] refs.json: ${refsOut.length} references (${(fs.statSync(path.join(SERVED, 'refs.json')).size / 1024).toFixed(0)}KB) · ${((Date.now() - tRef) / 1000).toFixed(0)}s`);

  // ── 3e · sports player dossiers (players.json) + live-card comps ──
  // The cross-market read Collin wants: one player, cards AND game-used AND
  // tickets/trophies — "how is this athlete doing in the wider market". All
  // parsed from titles (app/lib/cards.ts), aggregated at build, R2-only.
  const tPl = Date.now();
  // hoisted so the fitted grade ladder can be stamped into market.json below
  let gradeLadderArtifact: ReturnType<typeof fitGradeLadder>['rungs'] | null = null;
  let gradeLadderMeta: { pairs: number; groups: number } | null = null;
  {
    const { parseCard, playerOf, cardKey, cardLadderKey } = require('../app/lib/cards');
    // parseCard is a pure function of the title; the same card title recurs
    // across the sold pass AND the live pass (and duplicate listings), so cache
    // by title — each unique title is parsed once. The cached CardId is returned
    // by reference; JSON serialization of `_card` stays value-identical.
    const cardCache = new Map<string, ReturnType<typeof parseCard>>();
    const parseCardCached = (title: string): ReturnType<typeof parseCard> => {
      let c = cardCache.get(title);
      if (c === undefined) { c = parseCard(title); cardCache.set(title, c); }
      return c;
    };
    const SPORT_SET = new Set(MARKETS.sports);
    const sportsSold = all.filter(l => SPORT_SET.has(l.artist) && l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate);

    // one parse pass over every sold sports lot
    type PLot = AuctionLot & { _pid?: string | null; _pname?: string | null; _card?: ReturnType<typeof parseCard> };
    const byPlayer = new Map<string, { name: string; lots: PLot[] }>();
    const byCardKey = new Map<string, AuctionLot[]>();
    const byLadderKey = new Map<string, AuctionLot[]>();
    for (const l of sportsSold as PLot[]) {
      if (l.artist === 'sports-cards') {
        const c = parseCardCached(l.title || '');
        l._card = c; l._pid = c.playerSlug; l._pname = c.player;
        const ck = cardKey(c); if (ck) (byCardKey.get(ck) || byCardKey.set(ck, []).get(ck)!).push(l);
        const lk = cardLadderKey(c); if (lk) (byLadderKey.get(lk) || byLadderKey.set(lk, []).get(lk)!).push(l);
      } else {
        const p = playerOf(l.title || '', l.artist);
        l._pid = p.playerSlug; l._pname = p.player;
      }
      if (l._pid && l._pname) {
        const e = byPlayer.get(l._pid) || byPlayer.set(l._pid, { name: l._pname, lots: [] }).get(l._pid)!;
        e.lots.push(l);
      }
    }

    // ── EMPIRICAL GRADE LADDER ── fit the card-grade multiplier from graded
    // sold cards by within-card paired log-ratios (mix-immune). Every sold card
    // now carries _card (stamped above), so this reads the freshly-parsed pool.
    // Measured (~193K graded sold): the fit is monotone, holdout-validated
    // (median |log err| 0.474 fitted vs 0.507 old), and steeper than the old
    // constants at the top (PSA-10 ≈10× the PSA-8 base, not 7×). Thin rungs keep
    // the old constant. The tier-2 grade-adjust valuer consumes ladder.mult.
    const gradeLadderFit = fitGradeLadder(
      (sportsSold as PLot[]).filter(l => l.artist === 'sports-cards'),
    );
    console.log(`[market] grade ladder fitted from ${gradeLadderFit.pairs} within-card pairs (${gradeLadderFit.groups} groups): ` +
      gradeLadderFit.rungs.map(r => `${r.grade}=${r.mult.toFixed(2)}${r.fitted ? '' : '*'}`).join(' ') + ' (*=kept old constant)');
    gradeLadderArtifact = gradeLadderFit.rungs;
    gradeLadderMeta = { pairs: gradeLadderFit.pairs, groups: gradeLadderFit.groups };

    // players.json — players with real depth (≥25 sales)
    const playersOut: Record<string, unknown>[] = [];
    for (const [slug, { name, lots: ls }] of Array.from(byPlayer.entries())) {
      if (ls.length < 25) continue;
      ls.sort((a, b) => (a.saleDate! < b.saleDate! ? -1 : 1));
      const cats: Record<string, { n: number; medUsd: number; ttmMedUsd: number | null }> = {};
      const cut = Date.now() - 365 * 864e5;
      for (const cat of ['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']) {
        const cl = ls.filter(l => l.artist === cat);
        if (!cl.length) continue;
        const ttm = cl.filter(l => (l as AuctionLot & { _saleMs?: number })._saleMs! > cut).map(l => l.realizedUsd!);
        cats[cat] = {
          n: cl.length,
          medUsd: Math.round(median(cl.map(l => l.realizedUsd!))),
          ttmMedUsd: ttm.length >= 5 ? Math.round(median(ttm)) : null,
        };
      }
      // yearly card trend (cards are the dense series; objects ride `recent`)
      const cardLots = ls.filter(l => l.artist === 'sports-cards');
      const byYear = new Map<number, number[]>();
      for (const l of cardLots) { const y = +l.saleDate!.slice(0, 4); (byYear.get(y) || byYear.set(y, []).get(y)!).push(l.realizedUsd!); }
      const yearly = Array.from(byYear.entries()).filter(([, v]) => v.length >= 5).sort((a, b) => a[0] - b[0])
        .map(([y, v]) => ({ y, med: Math.round(median(v)), n: v.length }));
      // the marquee object results (top game-used/trophy hammers — the wider market)
      const objects = ls.filter(l => l.artist !== 'sports-cards')
        .sort((a, b) => (b.realizedUsd! - a.realizedUsd!)).slice(0, 6)
        .map(l => ({ id: l.id, d: l.saleDate, p: Math.round(l.realizedUsd!), t: (l.title || '').slice(0, 80), cat: l.artist }));
      const recent = ls.slice(-8).reverse()
        .map(l => ({ d: l.saleDate, p: Math.round(l.realizedUsd!), t: (l.title || '').slice(0, 80), cat: l.artist }));
      // sport: majority vote over the lots' stamped sport field
      const sportVotes = new Map<string, number>();
      for (const l of ls) { const s = (l as AuctionLot & { sport?: string | null }).sport; if (s) sportVotes.set(s, (sportVotes.get(s) || 0) + 1); }
      const sport = Array.from(sportVotes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      playersOut.push({ slug, name, sport, n: ls.length, cats, yearly, objects, recent });
    }
    playersOut.sort((a, b) => (b.n as number) - (a.n as number));
    fs.writeFileSync(path.join(SERVED, 'players.json'), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), players: playersOut }));
    console.log(`[market] players.json: ${playersOut.length} players (${(fs.statSync(path.join(SERVED, 'players.json')).size / 1048576).toFixed(1)}MB)`);

    // ── TIERED CARD VALUE ESTIMATOR ──────────────────────────────────────
    // Goldin cards carry a live bid but NO house estimate, so the hedonic
    // value engine (which EXCLUDES cards for scale) leaves them with no value,
    // no glow, no read. Here — in the O(n) §3 card pass, reusing the same
    // hash-join maps the cardComps display already builds — we simulate a value
    // from PAST SALES OF THAT EXACT CARD, else that player's cards, and stamp it
    // as a ValueResult so the UI (glow ring + ComparableModal) reads it exactly
    // like a real engine value. It is a CARD-COMP value, not the hedonic engine:
    // signal is always null (no fabricated buy-signal), value.basis === 'card-comp'.
    //
    // Tier 1 — EXACT card (same player+year+set+cardNo+GRADE): median of the
    //   cardKey pool if n≥2. confidence 'high'. This is the strongest identity.
    // Tier 2 — SAME card, GRADE-ADJUSTED: exact-grade pool is thin (<2) but the
    //   card sold at OTHER grades (ladderKey pool ≥2 across grades). Estimate this
    //   grade from the ladder: take the rung with the grade NEAREST this card's
    //   grade and scale it by an empirical PSA-style grade multiplier (a graded
    //   card's value rises steeply with grade). The multiplier is a coarse,
    //   published-market-shaped curve indexed by grade number (raw≈1, 8≈1, 9≈1.6,
    //   9.5≈3, 10≈7) — scale = mult[target]/mult[nearest]. Defensible and simple;
    //   confidence 'medium'. If the target grade can't be scored (no gradeNum),
    //   fall back to the flat cross-grade ladder median.
    // Tier 3 — that PLAYER's cards: median of the byPlayer sold-card pool,
    //   filtered to a COMPARABLE grade tier (graded vs raw — a $5 raw common and
    //   a $50K graded rookie must not average) AND recent (last 24 months, to
    //   track the current market). Require n≥5. A broad player median is a weak
    //   signal → confidence 'low'.
    // If none seat → no value (null). Never fabricated.
    const GRADE_CUT = Date.now() - 730 * 864e5; // 24 months (tier-3 recency)
    // grade → relative value multiplier — now the EMPIRICAL ladder fitted above
    // (was a hardcoded constant curve). Only RATIOS between rungs are used, so
    // the absolute scale is irrelevant. Thin/off-ladder grades fall back to the
    // old constant inside gradeLadderFit.mult (honesty doctrine).
    const gradeMult = gradeLadderFit.mult;
    const cardVsBid = (bid: number, value: number): { label: 'below recent comps' | 'above recent comps' | 'in line'; pct: number } => {
      // mirror value.ts's vsBid thresholds exactly (±12% band around the value)
      const pct = Math.round((bid / value - 1) * 100);
      return { label: pct <= -12 ? 'below recent comps' : pct >= 12 ? 'above recent comps' : 'in line', pct };
    };
    type CardTier = 'exact' | 'grade-adj' | 'player' | 'none';
    const tierCounts: Record<CardTier, number> = { exact: 0, 'grade-adj': 0, player: 0, none: 0 };

    // live-card comps: exact cardKey → last sales; ladderKey → grade ladder.
    // Stamped on the LIVE lot objects (they're in `all`, so the stamp flows to
    // corpus + served shards + upcoming.json). playerSlug stamps every live
    // sports lot so the client links to /player without re-parsing.
    let stamped = 0, laddered = 0, soldStamped = 0;
    for (const l of all) {
      if (!SPORT_SET.has(l.artist)) continue;
      // Stamp playerSlug/playerName on SOLD sports OBJECT lots too (game-used,
      // trophies-awards, tickets-passes, sports-memorabilia — NOT sports-cards,
      // which are corpus-only/engine-excluded and keyed separately). Without
      // this the client comp path (soldCompBand/compPoolRead) can't gate a
      // realized band to the same PLAYER, so a Chad Ochocinco jersey comps
      // against Trout/Bird/Jordan. The §3 pass already parsed these lots'
      // player into _pid/_pname (same objects live in `all`), so reuse it —
      // fall back to a fresh playerOf() parse for any lot §3 skipped (no
      // realizedUsd/saleDate). Idempotent: re-running overwrites the same slug.
      if (l.status === 'sold' && l.artist !== 'sports-cards') {
        const sw = l as AuctionLot & { _pid?: string | null; _pname?: string | null; playerSlug?: string | null; playerName?: string | null };
        let pid = sw._pid ?? null, pname = sw._pname ?? null;
        if (pid == null) { const p = playerOf(l.title || '', l.artist); pid = p.playerSlug; pname = p.player; }
        sw.playerSlug = pid; sw.playerName = pname;
        if (pid) soldStamped++;
        continue;
      }
      if (l.status !== 'upcoming') continue;
      const lw = l as AuctionLot & { playerSlug?: string | null; playerName?: string | null; cardComps?: unknown };
      if (l.artist === 'sports-cards') {
        const c = parseCardCached(l.title || '');
        lw.playerSlug = c.playerSlug; lw.playerName = c.player;
        const ck = cardKey(c); const lk = cardLadderKey(c);
        const exact: AuctionLot[] = (ck ? byCardKey.get(ck) : undefined) || [];
        const ladder: AuctionLot[] = (lk ? byLadderKey.get(lk) : undefined) || [];
        const lastSales = exact.slice().sort((a, b) => (a.saleDate! < b.saleDate! ? 1 : -1)).slice(0, 5)
          .map(s => ({ d: s.saleDate, p: Math.round(s.realizedUsd!) }));
        const gradeRungs = new Map<string, number[]>();
        for (const s of ladder) {
          const g = (s as PLot)._card;
          if (!g || g.gradeNum == null) continue;
          const key = `${g.gradeCo} ${g.gradeNum}`;
          (gradeRungs.get(key) || gradeRungs.set(key, []).get(key)!).push(s.realizedUsd!);
        }
        const gradeLadder = Array.from(gradeRungs.entries())
          .map(([g, v]) => ({ g, med: Math.round(median(v)), n: v.length }))
          .filter(r => r.n >= 2)
          .sort((a, b) => parseFloat(a.g.split(' ')[1]) - parseFloat(b.g.split(' ')[1]));
        if (lastSales.length || gradeLadder.length) {
          lw.cardComps = {
            med: exact.length ? Math.round(median(exact.map(s => s.realizedUsd!))) : null,
            n: exact.length,
            lastSales,
            gradeLadder: gradeLadder.length > 1 ? gradeLadder : [],
          };
          stamped++;
          if (gradeLadder.length > 1) laddered++;
        }

        // ── simulate a value for bid-only cards (live bid, no house estimate) ──
        const lv = l as AuctionLot & {
          currentBid?: number; estLowUsd?: number; estHighUsd?: number;
          estimateLow?: number; estimateHigh?: number; value?: ValueResult | null;
        };
        const hasEstimate = (lv.estLowUsd! > 0 && lv.estHighUsd! > 0) || (lv.estimateLow! > 0 && lv.estimateHigh! > 0);
        const bid = lv.currentBid || 0;
        if (bid > 0 && !hasEstimate) {
          let value: number | null = null;
          let poolIds: string[] = [];
          let poolN = 0;                 // true comp count (poolIds is capped for shard size)
          let confidence: 'high' | 'medium' | 'low' = 'low';
          let tier: CardTier = 'none';

          if (exact.length >= 2) {
            // Tier 1 — exact same card + grade.
            value = Math.round(median(exact.map(s => s.realizedUsd!)));
            poolIds = exact.map(s => s.id);
            poolN = exact.length;
            confidence = 'high';
            tier = 'exact';
          } else if (ladder.length >= 2) {
            // Tier 2 — same card, cross-grade → grade-adjust to THIS grade.
            // Rung = each grade's median from THIS card's ladder; pick the rung
            // whose grade is nearest the live card's grade, scale by the grade
            // multiplier ratio. If we can't score this card's grade, use the flat
            // ladder median (a coarse cross-grade proxy).
            const rungs = ladder.map(s => ({ n: (s as PLot)._card?.gradeNum ?? null, p: s.realizedUsd! }))
              .filter(r => r.p > 0);
            const target = c.gradeNum;
            if (target != null && rungs.some(r => r.n != null)) {
              const graded = rungs.filter(r => r.n != null) as { n: number; p: number }[];
              // group by grade → median per rung, then nearest-grade rung
              const byGrade = new Map<number, number[]>();
              for (const r of graded) (byGrade.get(r.n) || byGrade.set(r.n, []).get(r.n)!).push(r.p);
              const rungMeds = Array.from(byGrade.entries())
                .map(([g, v]) => ({ g, med: median(v) }))
                .sort((a, b) => Math.abs(a.g - target) - Math.abs(b.g - target));
              const near = rungMeds[0];
              value = Math.round(near.med * (gradeMult(target) / gradeMult(near.g)));
            } else {
              value = Math.round(median(ladder.map(s => s.realizedUsd!)));
            }
            poolIds = ladder.map(s => s.id);
            poolN = ladder.length;
            confidence = 'medium';
            tier = 'grade-adj';
          } else if (c.playerSlug) {
            // Tier 3 — that player's cards. Match the live card's grade TIER
            // (graded vs raw) so a raw common and a graded rookie don't average,
            // and keep only the last ~24 months. Require n≥5. Weak → 'low'.
            const isGraded = c.gradeNum != null;
            const entry = byPlayer.get(c.playerSlug);
            const pool = (entry?.lots || []).filter(s =>
              s.artist === 'sports-cards' &&
              ((s as PLot)._card?.gradeNum != null) === isGraded &&
              (s as AuctionLot & { _saleMs?: number })._saleMs! > GRADE_CUT &&
              (s.realizedUsd || 0) > 0);
            if (pool.length >= 5) {
              value = Math.round(median(pool.map(s => s.realizedUsd!)));
              // cap the stamped ids at the 60 most recent (a player pool can be
              // hundreds of sales) — keep `n` as the TRUE pool size for honesty.
              poolIds = pool.slice().sort((a, b) =>
                (b as AuctionLot & { _saleMs?: number })._saleMs! - (a as AuctionLot & { _saleMs?: number })._saleMs!)
                .slice(0, 60).map(s => s.id);
              poolN = pool.length;
              confidence = 'low';
              tier = 'player';
            }
          }

          if (value != null && value > 0) {
            lv.value = {
              poolIds,
              n: poolN,
              compValueUsd: value,
              low: value,
              high: value,
              compRatio: null,
              signal: null, // never assert a hedonic buy-signal on cards
              estimateUsd: value, // no house estimate — the comp value IS the estimate
              // A below/above-BID call (and its glow) only fires when the value
              // reflects THIS card — exact (tier 1) or grade-adjusted (tier 2). A
              // bare PLAYER median (tier 3, 'low') can't call a specific card: a
              // rare parallel/high grade collapses to the median and would print a
              // wild ±% (a Jordan/Kobe refractor read '+782% over comps'). So tier 3
              // carries the value as CONTEXT only — no vsBid, no glow, no call.
              vsBid: confidence === 'low' || !(bid > 0) ? null : cardVsBid(bid, value),
              confidence,
              exact: null,
              basis: 'card-comp', // marker: card-comp value, NOT the hedonic engine
            } as ValueResult;
            tierCounts[tier]++;
          } else {
            tierCounts.none++;
          }
        }
      } else {
        const p = playerOf(l.title || '', l.artist);
        lw.playerSlug = p.playerSlug; lw.playerName = p.player;
      }
    }
    console.log(`[market] live-card comps: ${stamped} cards stamped (${laddered} w/ grade ladder) · ${soldStamped} sold sports-object lots player-stamped · players+cards pass ${((Date.now() - tPl) / 1000).toFixed(0)}s`);
    const cardValued = tierCounts.exact + tierCounts['grade-adj'] + tierCounts.player;
    const cardBidOnly = cardValued + tierCounts.none;
    console.log(`[market] card value estimator: ${cardValued}/${cardBidOnly} bid-only cards valued (${cardBidOnly ? (100 * cardValued / cardBidOnly).toFixed(1) : '0'}%) · tier1 exact=${tierCounts.exact} · tier2 grade-adj=${tierCounts['grade-adj']} · tier3 player=${tierCounts.player} · none=${tierCounts.none}`);
  }

  // ── 3f · stats.json rows for corpus-only / non-ARTISTS slugs ──
  // The nightly stats loop iterates ARTISTS, which OMITS sports-cards (corpus-
  // only), sports-memorabilia, and the 3 culture slugs — so the client reads
  // "no data / no record / empty analytics" for those whole verticals. Compute
  // each here at build from the FULL corpus with the SAME computeStats every
  // other maker uses. (sports-cards is corpus-only; the others just fell
  // through the ARTISTS gap — same fix either way.)
  {
    const { computeStats } = require('./compute-stats');
    const statsPath = path.join(SERVED, 'stats.json');
    const STATS_SLUGS = ['sports-cards', 'sports-memorabilia', 'movie-tv', 'music-memorabilia', 'entertainment-memorabilia'];
    try {
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      for (const slug of STATS_SLUGS) {
        const slugLots = lotsForSlug(slug);
        if (!slugLots.length) continue;
        stats[slug] = computeStats(slugLots, stats[slug] || null);
        console.log(`[market] stats.json: ${slug} row (${slugLots.length} lots, record $${(stats[slug].recordPrice || 0).toLocaleString()})`);
      }
      fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    } catch (e) { console.warn('[market] stats.json rows update failed:', (e as Error).message); }
  }

  // ── 3g · sub-market reads: per vertical, each tracked slug with the STRONGEST
  // honest read its data supports — a verified CI'd maker index, else measured
  // demand (%-over-estimate), else descriptive (typical/record/volume). No
  // fabricated appreciation: a descriptive slug carries no movement number.
  // Reads the fresh stats.json (rewritten in 3f) for the descriptive layer, the
  // full corpus for demand/coverage/sell-through, and makerIndex for 'index'.
  let subMarkets: ReturnType<typeof buildSubMarkets> = {};
  try {
    const statsBySlug = JSON.parse(fs.readFileSync(path.join(SERVED, 'stats.json'), 'utf8'));
    subMarkets = buildSubMarkets(all, statsBySlug, makerIndex);
    const breakdown = Object.entries(subMarkets).map(([v, rows]) => {
      const c = { index: 0, demand: 0, descriptive: 0 };
      for (const r of rows) c[r.readType]++;
      return `${v}[i${c.index} d${c.demand} x${c.descriptive}]`;
    }).join(' ');
    console.log(`[market] subMarkets: ${breakdown}`);
  } catch (e) { console.warn('[market] subMarkets build failed:', (e as Error).message); }

  // sub-category DRILL rows (new `drills` key — additive; subMarkets untouched)
  let drills: ReturnType<typeof buildDrillRows> = {};
  try {
    drills = buildDrillRows(all);
    const breakdown = Object.entries(drills).map(([v, rows]) => {
      const c = { index: 0, demand: 0, descriptive: 0 };
      for (const r of rows) c[r.readType]++;
      return `${v}[i${c.index} d${c.demand} x${c.descriptive}]`;
    }).join(' ');
    console.log(`[market] drills: ${breakdown}`);
  } catch (e) { console.warn('[market] drills build failed:', (e as Error).message); }

  const market = {
    generatedAt: new Date().toISOString().slice(0, 10),
    markets,
    hedonic,      // statistically-defensible hedonic price-change index (per market) + composite — see scripts/hedonic-index.ts
    makerIndex,   // per-maker hedonic index (bottom-up components of the market composites)
    subMarkets,   // per-vertical sub-market reads (strongest honest read per slug) — see scripts/sub-markets.ts
    drills,       // sub-category drill rows (subCat x sport / maker x family / domain / program) — see buildDrillRows
    makers,
    houseCal,     // per house×market estimate honesty (hammer-led, n≥40 cells)
    seasonality,  // per market calendar-month performance (UI gates on n)
    calibration: {  // the validated numbers, shipped so the UI can cite them
      directional: { method: 'temporal holdout, n≈2400', buckets: [['<0.6', 40], ['0.6-0.9', 55], ['0.9-1.3', 57], ['1.3-2', 65], ['>2', 69]] },
      valueError: { sports_high: 1.32, design_high: 1.45, watches_high: 1.52, art_high: 1.56 },
    },
    // the empirical card-grade multiplier ladder (within-card paired log-ratios,
    // base grade 8 = 1.00) that the tier-2 card valuer runs on — inspectable and
    // reusable. null if the card pass didn't run (no sports corpus).
    ...(gradeLadderArtifact ? { gradeLadder: { base: 8, rungs: gradeLadderArtifact, ...gradeLadderMeta } } : {}),
  };
  fs.mkdirSync(SERVED, { recursive: true });
  fs.writeFileSync(path.join(SERVED, 'market.json'), JSON.stringify(market));
  console.log(`[market] wrote market.json (${(fs.statSync(path.join(SERVED, 'market.json')).size / 1024).toFixed(0)}KB)`);

  // ── 4 · persist: full corpus (gz) + slim served (value flows to the client) ──
  for (const l of all) { const t = l as AuctionLot & { _v?: unknown; _saleMs?: unknown }; delete t._v; delete t._saleMs; }
  const { writeCorpusAndServed } = require('./corpus-io');
  // Served sold-card SAMPLE: the artist page / archive surfaces need real card
  // rows (record sale, past results, realized cohort) but 288k would blow the
  // payload — ship the most-recent 1,500 + top 500 by price (the record lives
  // in the top slice) on the ON-DEMAND archive tier; the rest stay corpus-only.
  const soldCards = lotsForSlug('sports-cards').filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0);
  const cardSample = new Set<string>();
  soldCards.slice().sort((a, b) => (a.saleDate! < b.saleDate! ? 1 : -1)).slice(0, 1500).forEach(l => cardSample.add(String(l.id)));
  soldCards.slice().sort((a, b) => b.realizedUsd! - a.realizedUsd!).slice(0, 500).forEach(l => cardSample.add(String(l.id)));
  console.log(`[market] served sold-card sample: ${cardSample.size} of ${soldCards.length}`);
  // Culture is a MIXED vertical (Goldin no-estimate + Sotheby's/Christie's
  // estimate-bearing), and only sports/science surfaces mount the phase-3
  // archive — so Goldin culture sold rows (~9k) went unreachable, hiding half
  // the vertical. Keep them in the phase-2 shards (the estimate-aware path that
  // culture surfaces load via useFullLots) instead of archiving them.
  const CULTURE_KEEP = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia']);
  writeCorpusAndServed(all as unknown as Record<string, unknown>[],
    (l: Record<string, unknown>) => l.auctionHouse === 'Goldin' && l.status === 'sold' && !CULTURE_KEEP.has(l.artist as string),
    // corpus-only: SOLD sport cards stay off the wire — except the sample above.
    // Live cards always ship (they're on the block).
    (l: Record<string, unknown>) => l.artist === 'sports-cards' && l.status === 'sold' && !cardSample.has(String(l.id)));
  // rebuild the eager payload so upcoming lots carry their fresh `value`
  const { buildUpcoming } = require('./build-upcoming');
  buildUpcoming(SERVED);
  console.log(`[market] done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// standalone entry — fail loud with a clear message + non-zero exit rather than
// a raw stack, so a failed rebuild is never mistaken for a successful one.
if (require.main === module) {
  try { runMarketBuild(); } catch (err) { console.error('[market] build failed:', err); process.exit(1); }
}
