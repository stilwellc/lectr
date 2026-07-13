/**
 * build-upcoming.ts — emits public/data/ray/upcoming.json: the small eager
 * payload (upcoming lots with precomputed buy signals + the recent-hammers
 * tape) so the app paints instantly while the 9MB history streams behind.
 * Run standalone (npx tsx scripts/build-upcoming.ts) or from the crawler.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeDeepSignal } from '../app/lib/comps';
import { demandSeries } from '../app/lib/demand';
import { ARTIST_LABEL, marketArtists, MARKETS } from '../app/constants';
import type { AuctionLot as EngineLot } from '../app/types';
import type { AuctionLot } from '../app/types';

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


export function buildUpcoming(dataDir: string): void {
  const lots: Lot[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'lots.json'), 'utf8'));

  // Zombie guard: the Sotheby's/Christie's crawlers skip closed-unsold lots
  // entirely, so a lot recorded 'upcoming' whose sale then closed without
  // selling is never overwritten (only Goldin gets a stale-upcoming cleanup).
  // The feed filters saleDate >= today, so anything more than a day past can
  // never render — drop it here instead of paying a computeDeepSignal pass
  // and doubling the eager payload with dead weight.
  const staleCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const upcoming = lots
    .filter(l => {
      if (l.status !== 'upcoming') return false;
      const t = new Date(l.saleDate).getTime();
      return !isNaN(t) && t >= staleCutoff;
    })
    .map(l => ({ ...l, signal: computeDeepSignal(l as unknown as AuctionLot, lots as unknown as AuctionLot[]) }));

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
  const out = { generatedAt: new Date().toISOString(), tape, demand, lots: upcoming };
  fs.writeFileSync(path.join(dataDir, 'upcoming.json'), JSON.stringify(out));
  const kb = Math.round(fs.statSync(path.join(dataDir, 'upcoming.json')).size / 1024);
  console.log(`upcoming.json: ${upcoming.length} lots, tape[${Object.keys(tape).map(k => `${k}:${tape[k].length}`).join(' ')}], ${kb}KB`);
}

// standalone entry
if (require.main === module) {
  buildUpcoming(path.join(process.cwd(), 'public', 'data', 'ray'));
}
