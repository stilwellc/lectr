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
import { readCorpus as readCorpusShared, slimForClient } from './corpus-io';
import {
  computeDeepSignal, soldCompBand, isSportsScienceObject, sportsForm, classifyForm, FORM_LABEL,
} from '../app/lib/comps';
import { demandSeries, realizedCohortSeries, bidCompetitionSeries } from '../app/lib/demand';
import { ARTIST_LABEL, marketArtists, marketOf, MARKETS } from '../app/constants';
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

export function buildUpcoming(dataDir: string, allLots?: AuctionLot[]): void {
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
  const today = new Date().toISOString().slice(0, 10);
  // results-pending grace: keep a just-closed lot visible only through the day
  // after its sale while results post; anything older that never resolved (e.g.
  // Christie's results gated behind login and never scraped) drops, not lingers.
  const graceCut = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const upcomingLots = lots
    .filter(l => {
      if (l.status !== 'upcoming') return false;
      // A just-closed lot awaiting results is held 'upcoming' with a past sale
      // date — keep it visible only within the grace window.
      if ((l as { resultsPending?: boolean }).resultsPending) return !!l.saleDate && l.saleDate.slice(0, 10) >= graceCut;
      return !!l.saleDate && l.saleDate.slice(0, 10) >= today;
    });

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
  type Vel = { delta: number; hours: number; pctile: number | null };
  const velById = new Map<string, Vel>();
  const posDeltasByMarket = new Map<string, number[]>();
  for (const l of upcomingLots) {
    const bh = (l as { bidHistory?: Array<{ d: string; b: number; n: number }> }).bidHistory;
    if (!Array.isArray(bh) || bh.length < 2) continue;
    const last = bh[bh.length - 1];
    const prev = bh[bh.length - 2];
    if (last?.n == null || prev?.n == null) continue;
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

  const upcoming = upcomingLots
    .map(l => {
      const lot = l as unknown as AuctionLot;
      // THE ENGINE OWNS THE CARD SIGNAL (measured head-to-head on 25k targets:
      // engine flags realized +40%/63% vs the never-backtested client
      // algorithm's +28%/57%). When build-market stamped a value with an
      // opinion, the card renders the ENGINE's call — same pool, same number
      // as the modal and the published record. The client computeDeepSignal
      // remains only as a fallback for lots the engine declined (its flags
      // still beat unflagged), with the contradiction guard as before.
      type EngineValue = { signal?: { label: string; beatRatePct: number } | null; compRatio?: number | null; compValueUsd?: number; n?: number; confidence?: 'high' | 'medium' | 'low' } | null;
      const ev = (lot as { value?: EngineValue }).value;
      let signal = null as ReturnType<typeof computeDeepSignal>;
      // ×5 ESTIMATE-BAND SANITY (mirrors the comps.ts form-pool guard): a
      // compRatio implying the comp median sits more than 5× outside the lot's
      // own estimate band is nearly always a collision of unrelated objects /
      // a data fault — stamp NO signal at the source, and no client fallback
      // either (the engine's inputs are the fault; recomputing won't fix it).
      const evSane = !ev || ev.compRatio == null || (ev.compRatio <= 5 && ev.compRatio >= 1 / 5);
      if (ev && ev.signal && !evSane) {
        // data-fault flag killed at the source — the card carries no signal
      } else if (ev && ev.signal) {
        if (ev.signal.label.startsWith('below') && ev.compRatio != null) {
          signal = {
            label: 'Below Market', pct: Math.round((ev.compRatio - 1) * 100),
            basis: ev.n || 0, med: ev.compValueUsd, kind: 'form',
            form: (lot as { formKey?: string }).formKey || 'unknown',
            confidence: ev.confidence === 'high' ? 'high' : ev.confidence === 'medium' ? 'medium' : 'low',
          } as NonNullable<ReturnType<typeof computeDeepSignal>>;
        } else if (ev.signal.label.startsWith('above') && ev.compRatio != null) {
          signal = {
            label: 'Above Market', pct: Math.round((1 - ev.compRatio) * 100),
            basis: ev.n || 0, med: ev.compValueUsd, kind: 'form',
            form: (lot as { formKey?: string }).formKey || 'unknown',
            confidence: ev.confidence === 'high' ? 'high' : ev.confidence === 'medium' ? 'medium' : 'low',
          } as NonNullable<ReturnType<typeof computeDeepSignal>>;
        }
        // 'at comparable market' → no flag, and no client fallback either:
        // the engine looked and called it fairly priced.
      } else {
        signal = computeDeepSignal(lot, lots as unknown as AuctionLot[]);
      }
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
      // W5 · precompute soldComp for upcoming sports/science lots, analogous to
      // signal — so a card/modal can paint the realized band before the archive
      // loads. soldCompBand returns null for every non-sports/science-object lot
      // (single choke point), so this is a no-op for art/design/watches.
      if (isSportsScienceObject(lot)) {
        const band = soldCompBand(lot, lots as unknown as AuctionLot[]);
        emitted.soldComp = band
          ? { median: band.median, low: band.low, high: band.high, n: band.n, confidence: band.confidence, form: band.form }
          : null;
      }
      return emitted;
    });

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
    const withEst = sold.filter(l => l.estimateLow && l.estimateHigh);
    const series = sold.length > 0 && withEst.length / sold.length >= MIN_EST_COVERAGE
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

  const out = { generatedAt: new Date().toISOString(), tape, demand, realized, bidComp, recentSold, lots: upcoming };
  fs.writeFileSync(path.join(dataDir, 'upcoming.json'), JSON.stringify(out));
  const kb = Math.round(fs.statSync(path.join(dataDir, 'upcoming.json')).size / 1024);
  const recentCounts = Object.keys(recentSold).map(k => `${k}:${recentSold[k].length}`).join(' ');
  const bcLast = bidComp.sports.length ? bidComp.sports[bidComp.sports.length - 1] : null;
  const velN = velById.size;
  const velPct = Array.from(velById.values()).filter(v => v.pctile != null).length;
  console.log(`upcoming.json: ${upcoming.length} lots, tape[${Object.keys(tape).map(k => `${k}:${tape[k].length}`).join(' ')}], recentSold[${recentCounts}], realized.sports:${realized.sports.length}, bidComp.sports:${bidComp.sports.length}${bcLast ? ` (now ${bcLast.value} bids/lot)` : ''}, bidVelocity:${velN} (${velPct} w/ pctile), ${kb}KB`);
}

// standalone entry
if (require.main === module) {
  buildUpcoming(path.join(process.cwd(), 'public', 'data', 'ray'));
}
