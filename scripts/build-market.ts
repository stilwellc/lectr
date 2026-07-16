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
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import type { AuctionLot } from '../app/types';
import { buildIdf, CandidateIndex, buildVectors, similarity } from '../app/lib/similarity';
import { resolveComps, estimateValue, setCalibration, type ValueResult } from '../app/lib/value';
import { buildMarketSeries, type MarketSeries } from '../app/lib/indices';
import { sportOf } from '../app/utils';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const SERVED = path.join(process.cwd(), 'public', 'data', 'ray');

const MARKETS: Record<string, string[]> = {
  art: ['george-condo', 'kaws', 'andy-warhol', 'keith-haring', 'ed-ruscha', 'pablo-picasso', 'henri-matisse', 'tom-sachs', 'peter-saul', 'raymond-pettibon', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy', 'francesco-clemente', 'eddie-martinez', 'kenny-scharf'],
  design: ['george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret'],
  watches: ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'],
  sports: ['game-used', 'trophies-awards', 'tickets-passes'],
  science: ['space-exploration', 'meteorites', 'fossils', 'scientific-instruments'],
};

function readGz(f: string): AuctionLot[] {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
}
function writeGz(f: string, data: unknown) {
  fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(data))));
}

export function runMarketBuild() {
  const t0 = Date.now();
  console.log('[market] reading corpus…');
  const lots = readGz('lots.json');
  const archive = readGz('sold-archive.json');
  const all = lots.concat(archive);

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

  const sold = all.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length);
  const tbl = buildIdf(sold);
  buildVectors(all, tbl);          // attach _v to every lot (upcoming need it too)
  const soldSorted = sold.slice().sort((a, b) => a.saleDate < b.saleDate ? -1 : 1);
  const idx = new CandidateIndex(soldSorted, tbl);
  const soldPos = new Map(soldSorted.map((l, i) => [l.id, i]));
  console.log(`[market] ${all.length} lots · ${sold.length} priced sold · vocab ${Object.keys(tbl.df).length}`);

  // ── 1 · value every UPCOMING lot (the live product) ──
  // bucket sold lots by maker ONCE (time-order preserved from soldSorted) so each
  // upcoming lot reads its same-maker pool in O(1) instead of rescanning all 36k.
  const soldByArtist = new Map<string, AuctionLot[]>();
  for (const s of soldSorted) (soldByArtist.get(s.artist) || soldByArtist.set(s.artist, []).get(s.artist)!).push(s);
  const upcoming = all.filter(l => l.status === 'upcoming');
  let valued = 0;
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
  for (const lot of upcoming) {
    let pool = soldByArtist.get(lot.artist) || [];
    if (SPORTS_SET.has(lot.artist)) {
      const ent = (lot as { entity?: string | null }).entity || null;
      const sp = sportOfCached(lot);
      if (ent || sp) {
        const restricted = pool.filter(c =>
          (ent && (c as { entity?: string | null }).entity === ent) || (sp && sportOfCached(c) === sp));
        if (restricted.length >= 3) pool = restricted;
      }
    }
    const comps = resolveComps(lot as AuctionLot & { _v?: Record<string, number> }, pool as (AuctionLot & { _v?: Record<string, number> })[], tbl);
    const v = estimateValue(lot as AuctionLot & { _v?: Record<string, number> }, comps, tbl);
    if (v) { (lot as AuctionLot & { value?: ValueResult }).value = v; valued++; }
    else (lot as AuctionLot & { value?: ValueResult | null }).value = null;
  }
  console.log(`[market] valued ${valued}/${upcoming.length} upcoming lots`);

  // ── 2 · repeat-sale groups: physical matches among SOLD lots ──
  // union-find over physicalMatch pairs (title-justified, per the doctrine)
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  let physPairs = 0;
  for (let i = 0; i < soldSorted.length; i++) {
    const lot = soldSorted[i];
    if (!parent.has(lot.id)) parent.set(lot.id, lot.id);
    const cands = idx.candidates(i).map(j => soldSorted[j]);
    for (const c of cands) {
      if (c.id <= lot.id) continue;   // dedup pair direction
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
  const idToLot = new Map(all.map(l => [l.id, l]));
  for (const [root, ids] of Array.from(groups.entries())) {
    if (ids.length < 2) continue;
    physGroups++;
    for (const id of ids) (idToLot.get(id) as AuctionLot & { repeatSaleGroupId?: string }).repeatSaleGroupId = 'rs_' + root.slice(-10);
  }
  console.log(`[market] repeat-sale: ${physPairs} physical pairs → ${physGroups} groups`);

  // ── 3 · market series (the dashboards) ──
  const markets: Record<string, MarketSeries> = {};
  for (const m in MARKETS) {
    const set = new Set(MARKETS[m]);
    markets[m] = buildMarketSeries(all.filter(l => set.has(l.artist)), m);
    const idxLen = markets[m].index.length;
    console.log(`[market] ${m.padEnd(8)} index ${idxLen}pts · sellThrough ${markets[m].sellThrough.length}pts · houseAcc ${markets[m].houseAccuracy.length}pts · n${markets[m].n}`);
  }
  // the aggregate 'all' market — every tracked maker/slug
  const allSlugs = new Set(Object.values(MARKETS).flat());
  markets.all = buildMarketSeries(all.filter(l => allSlugs.has(l.artist)), 'the market');
  console.log(`[market] all      index ${markets.all.index.length}pts · n${markets.all.n}`);

  // per-maker mini-series for the big names (drill-down)
  const makers: Record<string, MarketSeries> = {};
  const makerCounts = new Map<string, number>();
  sold.forEach(l => makerCounts.set(l.artist, (makerCounts.get(l.artist) || 0) + 1));
  for (const [slug, n] of Array.from(makerCounts.entries())) {
    if (n < 120) continue;
    makers[slug] = buildMarketSeries(all.filter(l => l.artist === slug), slug);
  }

  const market = {
    generatedAt: new Date().toISOString().slice(0, 10),
    markets,
    makers,
    calibration: {  // the validated numbers, shipped so the UI can cite them
      directional: { method: 'temporal holdout, n≈2400', buckets: [['<0.6', 40], ['0.6-0.9', 55], ['0.9-1.3', 57], ['1.3-2', 65], ['>2', 69]] },
      valueError: { sports_high: 1.32, design_high: 1.45, watches_high: 1.52, art_high: 1.56 },
    },
  };
  fs.mkdirSync(SERVED, { recursive: true });
  fs.writeFileSync(path.join(SERVED, 'market.json'), JSON.stringify(market));
  console.log(`[market] wrote market.json (${(fs.statSync(path.join(SERVED, 'market.json')).size / 1024).toFixed(0)}KB)`);

  // ── 4 · persist: full corpus (gz) + slim served (value flows to the client) ──
  for (const l of all) delete (l as AuctionLot & { _v?: unknown })._v;
  const { writeCorpusAndServed } = require('./corpus-io');
  writeCorpusAndServed(all as unknown as Record<string, unknown>[],
    (l: Record<string, unknown>) => l.auctionHouse === 'Goldin' && l.status === 'sold');
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
