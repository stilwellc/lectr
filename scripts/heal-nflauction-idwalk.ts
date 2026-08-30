/**
 * One-shot heal: excise every idwalk-minted NFL Auction "sale".
 *
 * The idwalk backfill scraped archived lot pages and took the FIRST
 * "Current Bid: $X" match on the tag-stripped page — but those pages carry
 * a sidebar Hot-Items widget, so entire walk batches absorbed one widget
 * lot's bid instead of the subject's. Measured Aug 30 2026 in the served
 * corpus: 3,622 rows at an identical $10,050, 240 at $1,710, plus ~37
 * stragglers ($14 ×16, $150 ×8 …) — 70% of the NFL sold corpus, all
 * poisoning game-used comps (Collin caught it via a Del'Shawn Phillips
 * jersey whose own "prior sale" printed $10,050 against $470–520 teammate
 * comps).
 *
 * The true prices are NOT recoverable (closed pages render amounts via JS;
 * the closed-list API windows at ~1 year), so the honest repair is
 * excision. idwalk rows are exactly identifiable: synthetic day-15
 * saleDate + imageUrl null (the mode stamped month-grade dates and never
 * had an image). Real archive/live rows keep exact API dates and images —
 * 13 genuine day-15 closers carry images and survive.
 *
 * Run AFTER data-store.sh pull, push after:
 *   npx tsx scripts/heal-nflauction-idwalk.ts --write
 */
import { readSegment, writeSegment } from './corpus-io';

const WRITE = process.argv.includes('--write');

const rows = readSegment('nflauction');
if (!rows.length) {
  console.error('[heal-nfl] ABORT: nflauction segment empty — pull from R2 first.');
  process.exit(1);
}

const isIdwalk = (l: Record<string, unknown>): boolean =>
  l.status === 'sold' &&
  typeof l.saleDate === 'string' && (l.saleDate as string).endsWith('-15') &&
  !l.imageUrl;

const keep = rows.filter(l => !isIdwalk(l));
const dropped = rows.length - keep.length;
const prices = new Map<number, number>();
for (const l of rows) {
  if (isIdwalk(l) && typeof l.priceUsd === 'number') {
    prices.set(l.priceUsd as number, (prices.get(l.priceUsd as number) || 0) + 1);
  }
}
console.log(`[heal-nfl] segment ${rows.length} rows → keep ${keep.length}, drop ${dropped} idwalk mints`);
console.log('[heal-nfl] dropped price census:', Array.from(prices.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6));

if (dropped === 0) { console.log('[heal-nfl] nothing to heal.'); process.exit(0); }
if (!WRITE) { console.log('[heal-nfl] dry run — pass --write to persist.'); process.exit(0); }

writeSegment('nflauction', keep);
console.log('[heal-nfl] segment written. Push with data-store.sh; tonight\'s assemble rebuilds comps clean.');
