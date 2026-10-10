/**
 * build-upcoming.ts — emits public/data/ray/upcoming.json: the small eager
 * payload (upcoming lots with precomputed buy signals + the recent-hammers
 * tape) so the app paints instantly while the ~19.5MB main history streams
 * behind and the ~10MB Goldin sold-archive loads only on demand.
 * Run standalone (npx tsx scripts/build-upcoming.ts) or from the crawler.
 *
 * After the payload split, the eager tier ALSO carries what a sports/science
 * vertical needs before its 10MB archive arrives: precomputed lot.soldComp on
 * upcoming sports/science lots, a lightweight recentSold slice per market
 * (so the home Recent-results row paints without the archive), and a realized
 * cohort series for sports (Goldin publishes no estimates, so the frozen
 * estimate Demand Index can't run there — the realized cohort is the honest
 * substitute, typed distinctly so it can never render as a `%` call).
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus as readCorpusShared, slimForClient, isServedUpcoming } from './corpus-io';
import {
  engineFlagOf, soldCompBand, isSportsScienceObject, sportsForm, classifyForm, FORM_LABEL,
} from '../app/lib/comps';
import { demandSeries, realizedCohortSeries, bidCompetitionSeries } from '../app/lib/demand';
import { ARTIST_LABEL, marketArtists, marketOf, MARKETS } from '../app/constants';
import { lotAllInFactor } from '../app/lib/premiums';
import { appendCalls, readCalls, type Call } from './lib/calls-ledger';
import { hasConditionFlag } from '../app/lib/condition';
import { gapRead, sleeperRead, valueFloor, closeGrowth, validateGapCells, gapCellKey, type CloseCurve } from '../app/lib/lanes';
import { CARD_TIER_CODE } from './lib/calls-ledger';
import { taxonOf } from '../app/lib/taxonomy';
import { prioStatic } from '../app/lib/priority';
import { isDayStamp, scheduledClose, normalizeCloseStamp, closeMs as closeInstantOf } from '../app/lib/house-tz';
import type { AuctionLot as EngineLot } from '../app/types';
import type { AuctionLot, RealizedPoint, BidCompetitionPoint } from '../app/types';

interface Lot {
  id: string;
  artist: string;
  title: string;
  category: string;
  auctionHouse: string;
  saleDate: string;
  estimateLow: number | null;
  estimateHigh: number | null;
  priceUsd: number | null;
  status: string;
  [k: string]: unknown;
}

function fmtPrice(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

/** Full corpus: the crawler passes its in-memory allLots so the sold-comp
 *  pool and realized cohort see every Goldin sold row. Standalone, the corpus
 *  is reassembled from lots.json CONCAT sold-archive.json (never lots.json
 *  alone — after the split that file lacks Goldin sold, which would silently
 *  starve both the sports comp pool and the cohort series). */
function readCorpus(_dataDir: string): Lot[] {
  // full v2 corpus (gz) via the shared reader — never the slim served files
  return (readCorpusShared() as unknown as Lot[]);
}

/** Returns the eager lots it wrote (upcoming.json `lots`) — the single-load
 *  nightly hands their engine pool ids to emit-page-stats. */
export function buildUpcoming(dataDir: string, allLots?: AuctionLot[]): Record<string, unknown>[] {
  const lots: Lot[] = (allLots as unknown as Lot[]) ?? readCorpus(dataDir);

  // Zombie guard: the Sotheby's/Christie's crawlers skip closed-unsold lots
  // entirely, so a lot recorded 'upcoming' whose sale then closed without
  // selling is never overwritten (only Goldin gets a stale-upcoming cleanup).
  // The feed filters saleDate >= today, so anything more than a day past can
  // never render — drop it here instead of paying a computeDeepSignal pass
  // and doubling the eager payload with dead weight.
  // Use the SAME timezone-safe day-string compare the client feed uses
  // (saleDate >= today), not a numeric Date.now()-24h window — the two disagreed
  // at the UTC-day boundary, shipping lots the client always hides (and mis-
  // parsing 'YYYY-MM-DD' as UTC midnight). The build always precedes the client
  // load, so `>= today` here never drops a lot the client would still show.
  // close-day growth curve (analytics.closeCurve) — the projection factor for
  // bid-house lots. Absent (first build) → no projections stamped.
  let closeCurve: CloseCurve | null = null;
  try {
    const mj = JSON.parse(fs.readFileSync(path.join(dataDir, 'market.json'), 'utf8'));
    const cc = mj?.markets?.all?.analytics?.closeCurve;
    if (cc?.buckets?.length) closeCurve = cc;
  } catch { /* no curve yet */ }
  const freshCalls: Call[] = [];
  // THE GAP'S PUBLISH GATE (Oct 6 2026, lanes.validateGapCells): the cells
  // whose graded projections land within [0.8, 1.25] of realized at n ≥ 50
  const gapCells = validateGapCells(readCalls());
  {
    const pass = Object.entries(gapCells).filter(([, c]) => c.pass).map(([k, c]) => `${k} (n${c.n} ${c.ratio}×)`);
    console.log(`[upcoming] gap cells validated: ${pass.length ? pass.join(' · ') : 'none'}`);
  }
  const todayCall = new Date().toISOString().slice(0, 10);
  // results-pending grace: keep a just-closed lot visible only through the day
  // after its sale while results post; anything older that never resolved (e.g.
  // Christie's results gated behind login and never scraped) drops, not lingers.
  // ONE predicate (corpus-io isServedUpcoming) shared with sync-lots-db, so the
  // Supabase live book is exactly the set this payload serves.
  // CLOSE STAMPS (Oct 9 2026, app/lib/house-tz): a Christie's local-midnight
  // DAY stamp is not a close time (it printed "12:00 AM" countdowns) — the lot
  // ships date-only; an RR lot (its countdown prints only MM/DD) carries the
  // house's PUBLISHED close, 7:00 PM ET on the close day (the 30 Minute Rule).
  // Shallow copies — the corpus rows the crawler handed in are never touched.
  let rrStamped = 0, dayStampsDropped = 0;
  const upcomingLots = lots.filter(l => isServedUpcoming(l)).map(l => {
    const had = (l as { saleDateTime?: string | null }).saleDateTime;
    if (had ? !isDayStamp(l as Parameters<typeof isDayStamp>[0]) : !scheduledClose(l as Parameters<typeof scheduledClose>[0])) return l;
    const c = normalizeCloseStamp({ ...l } as Lot & { saleDateTime?: string | null });
    if (had && !c.saleDateTime) dayStampsDropped++;
    if (!had && c.saleDateTime) rrStamped++;
    return c;
  });
  console.log(`[upcoming] close stamps: ${rrStamped} RR lots on the 7 PM ET schedule · ${dayStampsDropped} day-only stamps dropped`);

  // ── BID-VELOCITY precompute (Goldin live lots; corpus-only bidHistory) ──────
  // lot.bidHistory is Snap[] (Snap = {d:ISO, b:currentBid, n:bidCount}), up to
  // ~59 nightly snapshots. delta = latest.n − previous.n (bids ADDED since the
  // prior snapshot); hours = wall-clock hours between those two `d` timestamps.
  // pctile ranks THIS lot's delta among all live lots in the SAME market with
  // delta>0 (a bidVelocity is a DEMAND primitive — bids added — never a price
  // or a %-change). pctile is null under 20 same-market positive-delta peers so
  // a thin market never mints a false rank. Two passes: (1) compute delta/hours
  // per lot, (2) rank positive deltas within each market. delta<=0 lots still
  // carry a delta/hours read (a retracted/corrected bid is honest data) but get
  // no pctile — the percentile pool is positive-momentum peers only.
  //
  // FRESHNESS GATE: crawlers append a snapshot only when {b,n} CHANGES, so a
  // lot that spiked Mon→Tue and then went quiet keeps the same last-two pair
  // forever — and an ungated read would republish "+7 bids in 24h" every day
  // after. A velocity is a LIVE read: it exists only if the latest change was
  // recorded by TODAY's crawl (build-day `d`, or a full-ISO stamp within 24h
  // for intraday passes). A quiet lot has NO velocity, not last week's.
  type Vel = { delta: number; hours: number; pctile: number | null };
  const velById = new Map<string, Vel>();
  const posDeltasByMarket = new Map<string, number[]>();
  for (const l of upcomingLots) {
    const bh = (l as { bidHistory?: Array<{ d: string; b: number; n: number }> }).bidHistory;
    if (!Array.isArray(bh) || bh.length < 2) continue;
    const last = bh[bh.length - 1];
    const prev = bh[bh.length - 2];
    if (last?.n == null || prev?.n == null) continue;
    const fresh = last.d.slice(0, 10) === todayCall
      || Date.now() - new Date(last.d).getTime() < 24 * 3.6e6;
    if (!fresh) continue;
    const delta = last.n - prev.n;
    const hours = (new Date(last.d).getTime() - new Date(prev.d).getTime()) / 3.6e6;
    if (!Number.isFinite(hours)) continue;
    velById.set(l.id, { delta, hours, pctile: null });
    if (delta > 0) {
      const mk = marketOf(l.artist);
      (posDeltasByMarket.get(mk) || posDeltasByMarket.set(mk, []).get(mk)!).push(delta);
    }
  }
  // sort each market's positive-delta pool once for percentile lookups
  const MIN_PEERS = 20;
  const sortedPos = new Map<string, number[]>();
  for (const [mk, arr] of Array.from(posDeltasByMarket.entries())) sortedPos.set(mk, arr.slice().sort((a: number, b: number) => a - b));
  // integer percentile: fraction of same-market positive-delta peers this lot's
  // delta is >= (a strict "at or above" rank), scaled to 0..100. Null under the
  // peer floor.
  for (const l of upcomingLots) {
    const v = velById.get(l.id);
    if (!v || v.delta <= 0) continue;
    const pool = sortedPos.get(marketOf(l.artist));
    if (!pool || pool.length < MIN_PEERS) continue;
    // count of peers with a strictly-smaller delta, +0.5 per tie → midrank
    let lo = 0, hi = 0;
    for (const d of pool) { if (d < v.delta) lo++; else if (d === v.delta) hi++; }
    v.pctile = Math.round(((lo + hi / 2) / pool.length) * 100);
  }

  // SAME-ARTIST BUCKETS (Oct 2026 scale pass): signalWithPool and
  // soldCompBand each open with `allLots.filter(l => l.artist === lot.artist
  // && …)` — that conjunct first — and read allLots nowhere else, so handing
  // them the lot's own artist bucket (corpus order kept) yields the identical
  // pool while sparing a full-corpus scan per upcoming lot (~9k × 1.1M).
  const byArtist = new Map<unknown, AuctionLot[]>();
  for (const l of lots as unknown as AuctionLot[]) {
    const b = byArtist.get(l.artist);
    if (b) b.push(l); else byArtist.set(l.artist, [l]);
  }
  const sameArtist = (lot: AuctionLot): AuctionLot[] => byArtist.get(lot.artist) || [];

  const upcoming = upcomingLots
    .map(l => {
      const lot = l as unknown as AuctionLot;
      // THE ENGINE OWNS THE SIGNAL (Oct 6 2026: and ONLY the engine). A lot
      // the engine declined to value carries no flag — the client
      // computeDeepSignal fallback (never backtested) is gone; the ×5
      // estimate-band sanity and the flag-ratio print live in
      // comps.engineFlagOf, shared with the client.
      const signal = engineFlagOf(lot);
      // EAGER-SLIM (the leak kill): this map used to spread the RAW corpus row
      // into the payload, so every eager lot shipped the full engine schema —
      // titleTokens, objectFingerprint, fx*, hammer/realized twins, bidHistory
      // (corpus-only by doctrine) and description (can carry internal house
      // notes). Project through the SAME slimForClient the served shards use,
      // PLUS an explicit KEEP addendum for what the client reads on eager lots
      // but slim strips:
      //   saleDateTime — trueSaleDay() (feed filter / isLiveUpcoming / "In 2d")
      //     prefers it over the possibly-crawl-day saleDate fallback.
      // Everything else the eager surfaces read (currentBid, bidCount, value,
      // cardComps, playerSlug/Name, firstSeen, resultsPending, soldComp, url,
      // formKey, …) survives slimForClient already — verified against the
      // consumers before this list was settled.
      const emitted = slimForClient(l);
      const sdt = (l as { saleDateTime?: string | null }).saleDateTime;
      if (sdt != null) emitted.saleDateTime = sdt;
      // `signal` is stamped EXPLICITLY — even when null. lotSignal() treats
      // undefined as "not precomputed → recompute client-side", and a client
      // recompute could resurrect a flag the build's ×5 sanity guard killed.
      // null must survive serialization as null, never be omitted as a "null
      // weight" the way slimForClient does for corpus fields.
      emitted.signal = signal;
      // BID-VELOCITY stamp (Goldin live lots) — bidHistory is corpus-only and in
      // the STRIP set, so it never reaches the client; this precomputed digest
      // does. bidVelocity is NOT in STRIP, so slimForClient keeps it (verified).
      const vel = velById.get(l.id);
      if (vel) emitted.bidVelocity = vel;
      // BID PROJECTION (bid houses): expected close = currentBid × the fitted
      // close-day growth median for this lot's days-out bucket, grossed to
      // all-in by the house premium schedule. `below` = projection still under
      // the lot's value-band low (or 0.85× the exact-card median). This is a
      // DATA read with its own basis — the receipt accumulates in nightly
      // payload snapshots before it ever ranks a ledger.
      {
        const bid = (l as { currentBid?: number }).currentBid || 0;
        // the ONE close clock (house-tz): a date-only lot closes at its sale
        // day's end where it is sold, never at that day's UTC midnight
        const closeMs = closeInstantOf(l as Parameters<typeof closeInstantOf>[0]) ?? NaN;
        if (closeCurve && bid > 0 && !isNaN(closeMs)) {
          const daysOut = Math.max(0, (closeMs - Date.now()) / 86400000);
          // THE one projection factor (lanes.closeGrowth: bid band × days out)
          const g = closeGrowth(closeCurve, bid, daysOut);
          if (g && g >= 1) {
            const projAllIn = Math.round(bid * g * lotAllInFactor(l as { auctionHouse?: string | null; buyerPremiumPct?: number | null }, bid * g));
            // ONE floor rule (lanes.valueFloor — P1-4): value.low at non-low
            // confidence, else 0.85× the exact-card median at n≥3. This stamp
            // used to take ANY value.low / ANY card median, so the served
            // floor disagreed with the lane and the close-board that read it.
            const floor = valueFloor(l as { value?: { low?: number; confidence?: string } | null; cardComps?: { med?: number | null; n?: number } | null })?.floor ?? null;
            const ok = floor ? gapCells[gapCellKey(String(l.id), daysOut, projAllIn, floor)]?.pass === true : false;
            emitted.bidProj = { g, allIn: projAllIn, ...(floor ? { floor, below: projAllIn < floor } : {}), ...(ok ? { ok } : {}) };
            if (floor) freshCalls.push({ id: String(l.id), d: todayCall, k: 'vsbid', p: projAllIn, f: floor, m: marketOf(l.artist) });
          }
        }
        // CARD CALL with its TIER (P0-2): the graded claim is the value the
        // card actually wears — the tiered card-comp value when one was
        // stamped (s = tier code). The raw exact-card median call (s = 'm')
        // is RETIRED (Sep 27 2026): an all-time, undecayed, un-venue-adjusted
        // median read 1.73× realized/value on the live book (n=615, 22%
        // within ±30%) — where the tiers abstain, the tape abstains too.
        const cv = (l as { value?: { basis?: string; compValueUsd?: number; cardTier?: string } | null }).value;
        if (cv?.basis === 'card-comp' && (cv.compValueUsd || 0) > 0) {
          freshCalls.push({ id: String(l.id), d: todayCall, k: 'card', p: cv.compValueUsd!, s: CARD_TIER_CODE[cv.cardTier || ''] || 'm', m: marketOf(l.artist) });
        }
        // THE GAP + THE SLEEPERS (multi-lane engine, Aug 25): both lanes log
        // the night a lot first enters their board — the SAME readers the
        // /value page renders from (app/lib/lanes), so a lot can never show
        // one number and log another. Both stamps (bidProj, cardComps, value)
        // are already on `emitted` at this point in the map.
        {
          const withStamps = { ...l, ...emitted } as unknown as import('../app/types').AuctionLot;
          const g = gapRead(withStamps, Date.now());
          if (g) freshCalls.push({ id: String(l.id), d: todayCall, k: 'gap', s: g.shelf === 'wire' ? 'w' : 'f', p: g.allIn, f: g.floor, m: marketOf(l.artist) });
          const q = sleeperRead(withStamps, Date.now());
          if (q) freshCalls.push({ id: String(l.id), d: todayCall, k: 'quiet', s: q.anchor === 'fair-est' ? 'e' : 'v', p: q.cvu, ...(q.entry != null ? { f: q.entry } : {}), m: marketOf(l.artist) });
        }
      }
      // W5 · precompute soldComp for upcoming sports/science lots, analogous to
      // signal — so a card/modal can paint the realized band before the archive
      // loads. soldCompBand returns null for every non-sports/science-object lot
      // (single choke point), so this is a no-op for art/design/watches.
      if (isSportsScienceObject(lot)) {
        const band = soldCompBand(lot, sameArtist(lot));
        emitted.soldComp = band
          ? { median: band.median, low: band.low, high: band.high, n: band.n, confidence: band.confidence, form: band.form }
          : null;
      }
      return emitted;
    });
  // CLEAN TAXONOMY + PRIORITY health line (Oct 8). Both are pure functions of
  // fields every served lot already carries (artist/subCat/drill, estimates,
  // value, signal, bidProj), so the client computes them — stamping them would
  // add ~0.9MB to the eager payload for nothing. Logged nightly so a classifier
  // or anchor regression shows up in the run log.
  {
    const byCat = new Map<string, number>();
    let prio = 0;
    for (const e of upcoming) {
      const c = taxonOf(e as { artist?: string; subCat?: string; drill?: string }).cat;
      byCat.set(c, (byCat.get(c) ?? 0) + 1);
      if (prioStatic(e as Parameters<typeof prioStatic>[0])) prio++;
    }
    console.log(`[upcoming] taxonomy: ${Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ')} · prio anchored ${prio}/${upcoming.length}`);
  }

  if (freshCalls.length) {
    const led = appendCalls(freshCalls);
    console.log(`[upcoming] calls ledger: +${led.added} new calls (${led.total} total)`);
  }

  // pre-parse saleDate → numeric ms ONCE for the recency sorts below (tape +
  // recentSold each parse both operands per comparison otherwise, over the full
  // corpus). Stamped AFTER the `upcoming` map so the slimForClient copy there
  // never carries it into the payload; the comparators read `_saleMs` off the
  // SAME lot objects. Invalid/absent dates → NaN, matching the inline `new Date(...)` they
  // replace (NaN in a subtract sort yields NaN, treated as 0 by V8 — identical).
  for (const l of lots) (l as { _saleMs?: number })._saleMs = new Date(l.saleDate).getTime();
  const saleMs = (l: Lot) => (l as { _saleMs?: number })._saleMs ?? NaN;

  // The tape ("recent hammers") is PER MARKET so each vertical shows its own
  // notable sales. Take the most recent sold lots, then the top by price —
  // which naturally surfaces the premium houses (Sotheby's / Christie's /
  // Phillips six-figure watches) instead of drowning in Bonhams volume.
  const buildTape = (pool: Lot[]) => pool
    .filter(l => l.status === 'sold' && l.priceUsd && l.title)
    .sort((a, b) => saleMs(b) - saleMs(a))
    .slice(0, 160)
    .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
    .slice(0, 18)
    .map(l => ({
      artist: ARTIST_LABEL[l.artist] || l.artist,
      title: l.title.length > 44 ? l.title.slice(0, 42) + '…' : l.title,
      price: fmtPrice(l.priceUsd!),
      house: l.auctionHouse,
    }));

  const tape: Record<string, ReturnType<typeof buildTape>> = { all: buildTape(lots) };
  // One demand series per live market, plus the aggregate — the shelf and
  // every hero read from these precomputed curves.
  const demand: Record<string, ReturnType<typeof demandSeries>> = {
    all: demandSeries(lots as unknown as EngineLot[]),
  };
  // Coverage gate: bid auctions publish no estimates (every Goldin lot ships
  // estimateLow/High = null by design), and demandSeries can only read lots
  // that carry both. If most of a vertical's sold record is estimate-less,
  // the index would be computed from a non-representative curated-sale
  // sliver — suppress the series instead, so the market tile falls back to
  // the honest "N on the block" figure Terminal already shows for
  // series-less markets.
  const MIN_EST_COVERAGE = 0.5;
  // Recency gate: the tile presents the series' last point as NOW. A vertical
  // whose freshest qualifying quarter is ancient (e.g. sports seeded from
  // historic sales) would wear a year-old number as today's read — suppress
  // instead of misrepresenting.
  const MAX_STALE_QUARTERS = 2;
  const demandFreshFloor = (() => {
    const d = new Date();
    return d.getFullYear() * 4 + Math.floor(d.getMonth() / 3) - MAX_STALE_QUARTERS;
  })();
  const isStale = (series: ReturnType<typeof demandSeries>) => {
    if (!series.length) return false;
    const m = /^(\d{4}) Q(\d)$/.exec(series[series.length - 1].date);
    if (!m) return false;
    return Number(m[1]) * 4 + (Number(m[2]) - 1) < demandFreshFloor;
  };
  for (const m of MARKETS.filter(m => m.live && m.key !== 'all')) {
    const set = marketArtists(m.key);
    const marketLots = lots.filter(l => set.has(l.artist));
    const sold = marketLots.filter(l => l.status === 'sold');
    // Single-point estimates count (fifth sighting of the both-bounds bug,
    // Aug 6 2026): RR publishes estimateLow only. This gate sat UPSTREAM of
    // demandSeries, so fixing demand.ts alone left culture/science at zero.
    // Coverage is judged on the RECENT tape (trailing 2y): the RR 30-yr
    // archive's estimate-thin early years held culture's all-time coverage at
    // ~41% while its last-2-years tape is ~73% covered — the same trailing
    // rule the drill gates adopted.
    const covCutoff = Date.now() - 2 * 365.25 * 24 * 3600 * 1000;
    const soldRecent = sold.filter(l => l.saleDate && new Date(l.saleDate).getTime() >= covCutoff);
    const covPool = soldRecent.length >= 60 ? soldRecent : sold;
    const withEst = covPool.filter(l => (Number(l.estLowUsd ?? l.estimateLow) || Number(l.estHighUsd ?? l.estimateHigh) || 0) > 0);
    const series = covPool.length > 0 && withEst.length / covPool.length >= MIN_EST_COVERAGE
      ? demandSeries(marketLots as unknown as EngineLot[])
      : [];
    demand[m.key] = isStale(series) ? [] : series;
    tape[m.key] = buildTape(marketLots);
  }

  // W5 · recentSold — a lightweight slice of the last ~40 Goldin closes per
  // sports/science market, so the home Recent-results ROW paints from the
  // eager payload without pulling the 10MB sold-archive. Sports/science only
  // (the other verticals' sold rows already live in lots.json).
  const RECENT_N = 40;
  const recentSold: Record<string, Array<Record<string, unknown>>> = {};
  for (const m of MARKETS.filter(m => (m.key === 'sports' || m.key === 'science'))) {
    const set = marketArtists(m.key);
    recentSold[m.key] = lots
      .filter(l => set.has(l.artist) && l.status === 'sold' && l.priceUsd && l.title)
      .sort((a, b) => saleMs(b) - saleMs(a))
      .slice(0, RECENT_N)
      .map(l => {
        const lot = l as unknown as AuctionLot;
        const f = sportsForm(lot) ?? classifyForm(lot);
        return {
          id: l.id,
          title: l.title,
          artist: l.artist,
          priceUsd: l.priceUsd,
          house: l.auctionHouse,
          saleDate: l.saleDate,
          url: (l as { url?: string }).url ?? '',
          priceBasis: (l as { priceBasis?: string }).priceBasis ?? null,
          category: l.category,
          form: f,
          formLabel: FORM_LABEL[f] ?? f,
          objectType: (l as { objectType?: string }).objectType ?? null,
          eventKey: (l as { eventKey?: string }).eventKey ?? null,
        };
      });
  }

  // W5 · realized['sports'] — the honest realized cohort for sports. Goldin
  // publishes no estimates, so the estimate Demand Index above is empty for
  // sports; the realized cohort (a single-slug + price-band median, typed as a
  // `$` RealizedPoint) is the like-for-like substitute. tickets-passes is the
  // deepest sports slug (per-quarter n stays above the floor). NOT emitted for
  // science (too few sold to clear the cohort floor) nor for art/design/watches
  // (they have the estimate index).
  const realized: Record<string, RealizedPoint[]> = {
    sports: realizedCohortSeries(lots as unknown as AuctionLot[], {
      slug: 'tickets-passes',
      band: [100, 2000],
    }),
    // science + culture: the RR archive made both verticals' sold records
    // majority estimate-less (science 20% / culture 2% est coverage in the
    // trailing 2y), so the demand gate rightly suppresses their %-curves.
    // Like sports, they anchor on a REALIZED cohort instead — a stable
    // high-volume slug in a fixed price band, the honest typical-price line.
    science: realizedCohortSeries(lots as unknown as AuctionLot[], {
      slug: 'space-exploration',
      band: [200, 5000],
    }),
    culture: realizedCohortSeries(lots as unknown as AuctionLot[], {
      slug: 'entertainment-memorabilia',
      band: [100, 2000],
    }),
    // tcg: Goldin publishes no estimates (same as sports) — the realized
    // cohort on the pokémon slug is the honest typical-price line.
    tcg: realizedCohortSeries(lots as unknown as AuctionLot[], {
      slug: 'pokemon',
      band: [50, 2000],
    }),
  };

  // bidComp['sports'] — the honest CARDS demand read. Goldin publishes no
  // estimate, so cards get no %-over-estimate demand series (nor a hedonic
  // move); but every Goldin lot carries bidCount, a genuine demand primitive
  // (competitive tension). This is the quarterly MEDIAN bids-per-sold-lot on
  // the sports-cards slug — a bare count (bids/lot), typed BidCompetitionPoint,
  // NOT a % and NOT a $. It's ADDITIVE to (never a substitute for) the CI'd
  // repeat-sale index that headlines the cards sub-market. Coverage is deep
  // (287k sold Goldin card lots, 99.9% with bidCount>0) so the series is real.
  const bidComp: Record<string, BidCompetitionPoint[]> = {
    sports: bidCompetitionSeries(lots as unknown as AuctionLot[], { slug: 'sports-cards' }),
  };

  // ── DEEP VALUE (no-estimate lots) — Collin, Aug 14: projected close still
  // FAR under the value floor with the hammer approaching. The close curve
  // already prices in the late-bid surge, so a lot that projects ≥25% under
  // its floor inside the final ~3.5 days is genuinely behind, not merely
  // early. Ranked by depth; capped per market. Labeled a PROJECTION read —
  // the calls ledger is accumulating its receipt before it wears any
  // certified language.
  const deepValue: Record<string, Array<{ id: string; depth: number; allIn: number; floor: number; closes: string }>> = {};
  {
    const nowMs = Date.now();
    const rows: Array<{ m: string; id: string; depth: number; allIn: number; floor: number; closes: string }> = [];
    for (const e of upcoming) {
      const bp = (e as { bidProj?: { allIn: number; floor?: number; below?: boolean; ok?: boolean } }).bidProj;
      if (!bp?.below || !bp.floor || !(bp.allIn > 0)) continue;
      if (bp.ok !== true) continue; // (Oct 6) only a validated projection cell
      if (hasConditionFlag((e as { title?: string }).title)) continue; // dirty lot, clean floor — never a board seat
      const sdt = (e as { saleDateTime?: string | null }).saleDateTime || (e as { saleDate?: string }).saleDate;
      const closeMs = closeInstantOf(e as Parameters<typeof closeInstantOf>[0]) ?? NaN;
      if (!sdt || isNaN(closeMs)) continue;
      const daysOut = (closeMs - nowMs) / 86400000;
      if (daysOut < 0 || daysOut > 3.5) continue; // "coming up on hammer"
      const depth = 1 - bp.allIn / bp.floor;
      if (depth < 0.25) continue; // ≥25% under floor AFTER the growth projection
      // too-good-to-be-true gate: >90% under floor is almost always a floor
      // error (damaged/partial lot comped against clean copies), not value
      if (depth > 0.9) continue;
      const vv = (e as { value?: { low?: number; confidence?: string } }).value;
      if (vv?.low && vv.low > 0 && vv.confidence === 'low') continue; // weak floor, no board seat
      rows.push({ m: marketOf(String((e as { artist?: string }).artist)), id: String((e as { id?: string }).id), depth: Math.round(depth * 100) / 100, allIn: bp.allIn, floor: bp.floor, closes: String((e as { saleDate?: string }).saleDate || '') });
    }
    rows.sort((a, b) => b.depth - a.depth);
    for (const r of rows) {
      const arr = deepValue[r.m] || (deepValue[r.m] = []);
      if (arr.length < 40) arr.push({ id: r.id, depth: r.depth, allIn: r.allIn, floor: r.floor, closes: r.closes });
    }
    const dvCounts = Object.keys(deepValue).map(k => `${k}:${deepValue[k].length}`).join(' ') || 'none';
    console.log(`[upcoming] deep value (proj ≥25% under floor, closes ≤3.5d): ${dvCounts}`);
  }
  const out = { generatedAt: new Date().toISOString(), tape, demand, realized, bidComp, recentSold, deepValue, lots: upcoming };
  fs.writeFileSync(path.join(dataDir, 'upcoming.json'), JSON.stringify(out));
  const kb = Math.round(fs.statSync(path.join(dataDir, 'upcoming.json')).size / 1024);
  const recentCounts = Object.keys(recentSold).map(k => `${k}:${recentSold[k].length}`).join(' ');
  const bcLast = bidComp.sports.length ? bidComp.sports[bidComp.sports.length - 1] : null;
  const velN = velById.size;
  const velPct = Array.from(velById.values()).filter(v => v.pctile != null).length;
  console.log(`upcoming.json: ${upcoming.length} lots, tape[${Object.keys(tape).map(k => `${k}:${tape[k].length}`).join(' ')}], recentSold[${recentCounts}], realized.sports:${realized.sports.length}, bidComp.sports:${bidComp.sports.length}${bcLast ? ` (now ${bcLast.value} bids/lot)` : ''}, bidVelocity:${velN} (${velPct} w/ pctile), ${kb}KB`);
  return upcoming;
}

// standalone entry
if (require.main === module) {
  buildUpcoming(path.join(process.cwd(), 'public', 'data', 'ray'));
}
