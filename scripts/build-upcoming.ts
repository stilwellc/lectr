/**
 * build-upcoming.ts — emits public/data/ray/upcoming.json: the small eager
 * payload (upcoming lots with precomputed buy signals + the recent-hammers
 * tape) so the app paints instantly while the 9MB history streams behind.
 * Run standalone (npx tsx scripts/build-upcoming.ts) or from the crawler.
 */
import * as fs from 'fs';
import * as path from 'path';

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

const ARTIST_LABEL: Record<string, string> = {
  'george-condo': 'George Condo', 'futura-2000': 'Futura 2000', 'kaws': 'KAWS',
  'george-nakashima': 'George Nakashima', 'charles-eames': 'Charles & Ray Eames',
  'andy-warhol': 'Andy Warhol', 'tom-sachs': 'Tom Sachs', 'barry-mcgee': 'Barry McGee',
  'keith-haring': 'Keith Haring', 'peter-saul': 'Peter Saul', 'ed-ruscha': 'Ed Ruscha',
  'r-crumb': 'R. Crumb', 'raymond-pettibon': 'Raymond Pettibon', 'henri-matisse': 'Henri Matisse',
  'pablo-picasso': 'Pablo Picasso', 'fab-5-freddy': 'Fab 5 Freddy',
  'francesco-clemente': 'Francesco Clemente', 'jean-prouve': 'Jean Prouvé',
  'pierre-jeanneret': 'Pierre Jeanneret', 'eddie-martinez': 'Eddie Martinez',
  'kenny-scharf': 'Kenny Scharf',
};

function fmtPrice(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

/** Mirror of the client buy signal: comps median vs estimate midpoint. */
function computeSignal(lot: Lot, all: Lot[]): { label: string; pct: number } | null {
  if (!lot.estimateLow || !lot.estimateHigh) return null;
  const estMid = (lot.estimateLow + lot.estimateHigh) / 2;
  const comps = all.filter(l =>
    l.artist === lot.artist &&
    l.status === 'sold' &&
    l.priceUsd &&
    l.id !== lot.id &&
    (lot.category === 'unknown' || l.category === 'unknown' || l.category === lot.category)
  );
  if (comps.length < 3) return null;
  const prices = comps.map(l => l.priceUsd!).sort((a, b) => a - b);
  const median = prices.length % 2 === 0
    ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
    : prices[Math.floor(prices.length / 2)];
  const ratio = median / estMid;
  if (ratio >= 1.2) return { label: 'Below Market', pct: Math.round((ratio - 1) * 100) };
  if (ratio <= 0.75) return { label: 'Above Market', pct: Math.round((1 - ratio) * 100) };
  return null;
}

export function buildUpcoming(dataDir: string): void {
  const lots: Lot[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'lots.json'), 'utf8'));

  const upcoming = lots
    .filter(l => l.status === 'upcoming')
    .map(l => ({ ...l, signal: computeSignal(l, lots) }));

  const tape = lots
    .filter(l => l.status === 'sold' && l.priceUsd && l.title)
    .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
    .slice(0, 90)
    .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
    .slice(0, 18)
    .map(l => ({
      artist: ARTIST_LABEL[l.artist] || l.artist,
      title: l.title.length > 44 ? l.title.slice(0, 42) + '…' : l.title,
      price: fmtPrice(l.priceUsd!),
      house: l.auctionHouse,
    }));

  const out = { generatedAt: new Date().toISOString(), tape, lots: upcoming };
  fs.writeFileSync(path.join(dataDir, 'upcoming.json'), JSON.stringify(out));
  const kb = Math.round(fs.statSync(path.join(dataDir, 'upcoming.json')).size / 1024);
  console.log(`upcoming.json: ${upcoming.length} lots, ${tape.length} tape items, ${kb}KB`);
}

// standalone entry
if (require.main === module) {
  buildUpcoming(path.join(process.cwd(), 'public', 'data', 'ray'));
}
