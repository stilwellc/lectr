import { brandCard } from '../scripts/og/cards';
import { bookFacts } from './lib/og-meta';
import backtest from '../public/data/ray/backtest.json';

export const dynamic = 'force-static'; // required for route handlers under output:'export' (Next 15+)
export const alt = 'lectr — the house prints a guess, we print the record';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The site card — the position in two lines and the record that backs it
 * (card grammar: scripts/og/cards.tsx). Rendered statically at build under
 * `output: 'export'`; every route without its own card inherits this one.
 * Figures are counts from the served payload, grouped in full ("1,104,763
 * settled results") — the old "1115K tracked sales" rounding read as a typo.
 */
export default function OG() {
  const book = bookFacts();
  const bt = backtest as { flagged?: { n?: number; hammerMedianPct?: number }; unflagged?: { hammerMedianPct?: number } };
  return brandCard({
    settled: book.settled ?? 0,
    replayed: bt.flagged?.n ?? null,
    houses: book.houses ?? 0,
    flaggedHammerPct: bt.flagged?.hammerMedianPct ?? null,
    restHammerPct: bt.unflagged?.hammerMedianPct ?? null,
    folio: book.asOf ? `Read ${book.asOf}` : 'lectr.bid',
  });
}
