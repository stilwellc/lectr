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
import { readCorpus as readCorpusShared } from './corpus-io';
import {
  computeDeepSignal, soldCompBand, isSportsScienceObject, sportsForm, classifyForm, FORM_LABEL,
} from '../app/lib/comps';
import { demandSeries, realizedCohortSeries } from '../app/lib/demand';
import { ARTIST_LABEL, marketArtists, MARKETS } from '../app/constants';
import type { AuctionLot as EngineLot } from '../app/types';
import type { AuctionLot, RealizedPoint } from '../app/types';

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
  const upcoming = lots
    .filter(l => {
      if (l.status !== 'upcoming') return false;
      // A just-closed lot awaiting results is held 'upcoming' with a past sale
      // date — keep it visible even though its sale date is in the past.
      if ((l as { resultsPending?: boolean }).resultsPending) return true;
      return !!l.saleDate && l.saleDate.slice(0, 10) >= today;
    })
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
      if (ev && ev.signal) {
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
      const withSignal = { ...l, signal };
      // W5 · precompute soldComp for upcoming sports/science lots, analogous to
      // signal — so a card/modal can paint the realized band before the archive
      // loads. soldCompBand returns null for every non-sports/science-object lot
      // (single choke point), so this is a no-op for art/design/watches.
      if (isSportsScienceObject(lot)) {
        const band = soldCompBand(lot, lots as unknown as AuctionLot[]);
        (withSignal as { soldComp?: unknown }).soldComp = band
          ? { median: band.median, low: band.low, high: band.high, n: band.n, confidence: band.confidence, form: band.form }
          : null;
      }
      return withSignal;
    });

  // The tape ("recent hammers") is PER MARKET so each vertical shows its own
  // notable sales. Take the most recent sold lots, then the top by price —
  // which naturally surfaces the premium houses (Sotheby's / Christie's /
  // Phillips six-figure watches) instead of drowning in Bonhams volume.
  const buildTape = (pool: Lot[]) => pool
    .filter(l => l.status === 'sold' && l.priceUsd && l.title)
    .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
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
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
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
  };

  const out = { generatedAt: new Date().toISOString(), tape, demand, realized, recentSold, lots: upcoming };
  fs.writeFileSync(path.join(dataDir, 'upcoming.json'), JSON.stringify(out));
  const kb = Math.round(fs.statSync(path.join(dataDir, 'upcoming.json')).size / 1024);
  const recentCounts = Object.keys(recentSold).map(k => `${k}:${recentSold[k].length}`).join(' ');
  console.log(`upcoming.json: ${upcoming.length} lots, tape[${Object.keys(tape).map(k => `${k}:${tape[k].length}`).join(' ')}], recentSold[${recentCounts}], realized.sports:${realized.sports.length}, ${kb}KB`);
}

// standalone entry
if (require.main === module) {
  buildUpcoming(path.join(process.cwd(), 'public', 'data', 'ray'));
}
