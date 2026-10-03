/**
 * Detail-page enrichment pass (medium / dimensions / year) across the houses that
 * have an enricher — bounded per run by count and wall clock.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import type { AuctionLot, AuctionHouse } from '../../../app/types';
import { enrichBonhams } from './bonhams';
import { enrichChristies } from './christies';
import { DEEP, ENRICH_FAILS, ENRICH_TIME_BUDGET_MS, type EnrichResult, sleep } from './common';
import { enrichPhillips } from './phillips';
import { enrichSothebys } from './sothebys';

const ENRICH_MAX_PER_RUN = DEEP ? 6000 : 500;

const ENRICH_DELAY = 250;

// Only houses with an enricher in the switch below — anything else (Goldin
// especially: all upcoming, always null medium/dims/year) would sort to the
// front of the batch and burn slots on guaranteed no-ops.
const ENRICHABLE_HOUSES = new Set<AuctionHouse>(['Phillips', "Christie's", 'Bonhams', "Sotheby's"]);

export async function enrichLots(lots: AuctionLot[]): Promise<void> {
  // Find lots missing any of medium, dimensions, year (Wright/Rago already good)
  const needsEnrich = lots.filter(l =>
    ENRICHABLE_HOUSES.has(l.auctionHouse) &&
    (!l.medium || !l.dimensions || !l.year) &&
    l.url
  );

  if (needsEnrich.length === 0) {
    console.log('[Enrich] All lots already have complete data.');
    return;
  }

  // Prioritize: upcoming first, then most recent sold
  needsEnrich.sort((a, b) => {
    if (a.status === 'upcoming' && b.status !== 'upcoming') return -1;
    if (b.status === 'upcoming' && a.status !== 'upcoming') return 1;
    return new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
  });

  const batch = needsEnrich.slice(0, ENRICH_MAX_PER_RUN);

  // Pre-loop breakdown by house
  const houseBreakdown: Record<string, number> = {};
  for (const lot of batch) {
    houseBreakdown[lot.auctionHouse] = (houseBreakdown[lot.auctionHouse] || 0) + 1;
  }

  console.log(`\n[Enrich] ${needsEnrich.length} lots need enrichment, processing ${batch.length} this run...`);
  console.log('[Enrich] Per-house breakdown for this batch:');
  for (const [house, count] of Object.entries(houseBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  [${house}] ${count} lots`);
  }
  console.log('[Enrich] Starting enrichment loop...\n');

  let enriched = 0;
  const houseCounts: Record<string, { total: number; success: number }> = {};
  const enrichStart = Date.now();

  for (const lot of batch) {
    if (Date.now() - enrichStart > ENRICH_TIME_BUDGET_MS) {
      console.log('[Enrich] Time budget exhausted — stopping early so the crawl still writes/commits.');
      break;
    }
    const house = lot.auctionHouse;
    if (!houseCounts[house]) houseCounts[house] = { total: 0, success: 0 };
    houseCounts[house].total++;

    let result: EnrichResult = {};
    switch (house) {
      case 'Phillips': result = await enrichPhillips(lot); break;
      case "Christie's": result = await enrichChristies(lot); break;
      case 'Bonhams': result = await enrichBonhams(lot); break;
      case "Sotheby's": result = await enrichSothebys(lot); break;
      default: continue;
    }

    let updated = false;
    if (result.medium && !lot.medium) { lot.medium = result.medium; updated = true; }
    if (result.dimensions && !lot.dimensions) { lot.dimensions = result.dimensions; updated = true; }
    if (result.year && !lot.year) { lot.year = result.year; updated = true; }

    if (updated) {
      enriched++;
      houseCounts[house].success++;
    }

    await sleep(ENRICH_DELAY);
  }

  console.log(`[Enrich] Enriched ${enriched}/${batch.length} lots.`);
  const failHouses = Object.entries(ENRICH_FAILS);
  if (failHouses.length) console.warn(`[Enrich] parse failures (counted, not swallowed): ${failHouses.map(([h, c]) => `${h} json=${c.json} page=${c.page}`).join(' · ')}`);
  for (const [house, counts] of Object.entries(houseCounts)) {
    console.log(`  [${house}] ${counts.success}/${counts.total} enriched`);
  }
}
