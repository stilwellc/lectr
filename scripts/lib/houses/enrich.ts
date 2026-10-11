/**
 * Detail-page enrichment pass (medium / dimensions / year) across the houses that
 * have an enricher — bounded per run by count and wall clock.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import type { AuctionLot, AuctionHouse } from '../../../app/types';
import { ARTIST_MARKET } from '../../../app/constants';
import { enrichBonhams } from './bonhams';
import { enrichChristies } from './christies';
import { DEEP, ENRICH_FAILS, ENRICH_TIME_BUDGET_MS, type EnrichResult, sleep } from './common';
import { enrichPhillips } from './phillips';
import { enrichSothebys } from './sothebys';

const ENRICH_MAX_PER_RUN = DEEP ? 6000 : 500;

const ENRICH_DELAY = 250;

// STALLED-HOST BREAKER (Oct 11 2026, W6 pipeline pass). The detail fetchers
// time out at 10s and swallow the abort, so a host that stops answering costs
// 10s × every one of its lots in the batch: bruun-rasmussen.dk (the Bruun lots
// riding the Bonhams segment) stalled on some nights for all 89 of its batch
// lots, 15 of the Bonhams leg's 18 minutes, for 0 enriched (on the nights it
// answers it yields nothing either — the JSON-LD fails to parse). After
// STALL_LIMIT CONSECUTIVE stalls (a call that took ≥ STALL_MS and returned no
// field) from one HOST, the rest of that host's lots are skipped this run; any
// quick answer from the host resets its count. Other hosts are untouched.
const STALL_MS = 9_000;
const STALL_LIMIT = 3;
const hostOf = (url: string): string => { try { return new URL(url).hostname; } catch { return ''; } };

// Only houses with an enricher in the switch below — anything else (Goldin
// especially: all upcoming, always null medium/dims/year) would sort to the
// front of the batch and burn slots on guaranteed no-ops.
const ENRICHABLE_HOUSES = new Set<AuctionHouse>(['Phillips', "Christie's", 'Bonhams', "Sotheby's"]);

// ── ATTEMPT POLICY (Oct 11 2026, W14 data hygiene) ──
// Christie's (6.5–7.3 min/night) and Sotheby's (10–12 min/night) fetched the
// SAME ~500 lot pages every night for 0–6 fills: the batch was "any lot
// missing medium, dimensions or year", sorted upcoming-then-newest, and
// nothing remembered a page that had already come back empty — so the newest
// 500 (mostly watches, whose pages the art-material regexes never read, and
// Christie's onlineonly pages, which carry none of the parsed selectors) came
// round again every night. For these two houses now:
//   · SCOPE — only lots whose fields the house parser can produce: art /
//     design makers (ARTIST_MARKET), and only the page shapes the parser
//     reads: Christie's main-site lot pages (www.christies.com/en/lot/…; not
//     onlineonly, not private sales), Sotheby's /en/buy/auction/… pages (not
//     the pre-2018 ecatalogue urls);
//   · MEMORY — a small per-lot record { n: attempts, e: empty attempts,
//     last: YYYY-MM-DD } persisted with the segment (enrichTries; corpus-only);
//   · BACKOFF — a SOLD lot waits 1 / 2 / 4 / 8 days after attempt 1 / 2 / 3 /
//     4+ and stops after 3 empty attempts (its page will not change); an
//     UPCOMING lot is tried at most daily, at most 5 times (catalogue notes
//     can land before the sale);
//   · ORDER — never-tried lots first, then upcoming, then newest sale.
// Phillips and Bonhams keep the old selection (not measured here).
export const POLICY_HOUSES = new Set<AuctionHouse>(["Christie's", "Sotheby's"]);
export type EnrichTries = { n: number; e: number; last: string };
type TLot = AuctionLot & { enrichTries?: EnrichTries };
const SOLD_MAX_EMPTY = 3;
const UPCOMING_MAX_TRIES = 5;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);

/** Can the house parser produce a field for this lot at all? */
export function enrichInScope(l: AuctionLot): boolean {
  if (!POLICY_HOUSES.has(l.auctionHouse)) return true;
  const mkt = ARTIST_MARKET[l.artist];
  if (mkt !== 'art' && mkt !== 'design') return false;
  if (l.auctionHouse === "Christie's") return /^https:\/\/www\.christies\.com\/(?:[a-z]{2}\/)?lot\//i.test(l.url || '');
  // Sotheby's: the current lot pages (/en/buy/auction/…) carry the JSON-LD
  // description the parser reads; the pre-2018 /en/auctions/ecatalogue/… urls
  // return none (live probe Oct 11 2026: 0 of 10)
  return /^https:\/\/www\.sothebys\.com\/(?:[a-z]{2}\/)?buy\/auction\//i.test(l.url || '');
}

/** Is this lot due an attempt today under the backoff? */
export function enrichDue(l: AuctionLot, today: string): boolean {
  if (!POLICY_HOUSES.has(l.auctionHouse)) return true;
  const t = (l as TLot).enrichTries;
  if (!t || !t.n) return true;
  const since = dayDiff(today, t.last);
  if (l.status === 'upcoming') return t.n < UPCOMING_MAX_TRIES && since >= 1;
  if (t.e >= SOLD_MAX_EMPTY) return false;
  return since >= Math.min(8, 2 ** (t.n - 1));
}

/** Record one attempt (filled = how many fields it wrote). */
export function recordEnrichAttempt(l: AuctionLot, filled: number, today: string): void {
  if (!POLICY_HOUSES.has(l.auctionHouse)) return;
  const t = (l as TLot).enrichTries || { n: 0, e: 0, last: today };
  (l as TLot).enrichTries = { n: t.n + 1, e: t.e + (filled ? 0 : 1), last: today };
}

const missingAny = (l: AuctionLot) => !l.medium || !l.dimensions || !l.year;

/** The night's candidates, in order. */
export function selectEnrichBatch(lots: AuctionLot[], today: string, max = ENRICH_MAX_PER_RUN): { candidates: AuctionLot[]; batch: AuctionLot[]; outOfScope: number; backedOff: number } {
  let outOfScope = 0, backedOff = 0;
  const candidates: AuctionLot[] = [];
  for (const l of lots) {
    if (!ENRICHABLE_HOUSES.has(l.auctionHouse) || !missingAny(l) || !l.url) continue;
    if (!enrichInScope(l)) { outOfScope++; continue; }
    if (!enrichDue(l, today)) { backedOff++; continue; }
    candidates.push(l);
  }
  const tried = (l: AuctionLot) => ((l as TLot).enrichTries?.n ? 1 : 0);
  candidates.sort((a, b) => {
    const ta = tried(a), tb = tried(b);
    if (ta !== tb) return ta - tb;
    if (a.status === 'upcoming' && b.status !== 'upcoming') return -1;
    if (b.status === 'upcoming' && a.status !== 'upcoming') return 1;
    return new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
  });
  return { candidates, batch: candidates.slice(0, max), outOfScope, backedOff };
}

export async function enrichLots(lots: AuctionLot[], today: string = new Date().toISOString().slice(0, 10)): Promise<void> {
  const { candidates: needsEnrich, batch, outOfScope, backedOff } = selectEnrichBatch(lots, today);
  if (outOfScope || backedOff) console.log(`[Enrich] attempt policy (${Array.from(POLICY_HOUSES).join(', ')}): ${outOfScope} lots out of parser scope (not art/design, or not a main-site lot page) · ${backedOff} backed off / exhausted`);

  if (needsEnrich.length === 0) {
    console.log('[Enrich] All lots already have complete data (or are backed off).');
    return;
  }

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
  const stalls = new Map<string, number>();     // host → consecutive stalls
  const skippedByHost = new Map<string, number>();

  for (const lot of batch) {
    if (Date.now() - enrichStart > ENRICH_TIME_BUDGET_MS) {
      console.log('[Enrich] Time budget exhausted — stopping early so the crawl still writes/commits.');
      break;
    }
    const host = hostOf(lot.url);
    if (host && (stalls.get(host) || 0) >= STALL_LIMIT) {
      skippedByHost.set(host, (skippedByHost.get(host) || 0) + 1);
      continue;
    }
    const house = lot.auctionHouse;
    if (!houseCounts[house]) houseCounts[house] = { total: 0, success: 0 };
    houseCounts[house].total++;

    let result: EnrichResult = {};
    const callStart = Date.now();
    switch (house) {
      case 'Phillips': result = await enrichPhillips(lot); break;
      case "Christie's": result = await enrichChristies(lot); break;
      case 'Bonhams': result = await enrichBonhams(lot); break;
      case "Sotheby's": result = await enrichSothebys(lot); break;
      default: continue;
    }
    if (host) {
      const stalled = Date.now() - callStart >= STALL_MS && !result.medium && !result.dimensions && !result.year;
      const n = stalled ? (stalls.get(host) || 0) + 1 : 0;
      stalls.set(host, n);
      if (n === STALL_LIMIT) console.warn(`[Enrich] ${host}: ${STALL_LIMIT} consecutive stalled fetches (≥${STALL_MS / 1000}s, nothing returned) — skipping its remaining lots this run`);
    }

    let filled = 0;
    if (result.medium && !lot.medium) { lot.medium = result.medium; filled++; }
    if (result.dimensions && !lot.dimensions) { lot.dimensions = result.dimensions; filled++; }
    if (result.year && !lot.year) { lot.year = result.year; filled++; }
    recordEnrichAttempt(lot, filled, today);
    const updated = filled > 0;

    if (updated) {
      enriched++;
      houseCounts[house].success++;
    }

    await sleep(ENRICH_DELAY);
  }

  console.log(`[Enrich] Enriched ${enriched}/${batch.length} lots in ${((Date.now() - enrichStart) / 60_000).toFixed(1)} min.`);
  if (skippedByHost.size) console.warn(`[Enrich] stalled hosts skipped (retried next run): ${Array.from(skippedByHost).map(([h, c]) => `${h} ${c} lot(s)`).join(' · ')}`);
  const failHouses = Object.entries(ENRICH_FAILS);
  if (failHouses.length) console.warn(`[Enrich] parse failures (counted, not swallowed): ${failHouses.map(([h, c]) => `${h} json=${c.json} page=${c.page}`).join(' · ')}`);
  for (const [house, counts] of Object.entries(houseCounts)) {
    console.log(`  [${house}] ${counts.success}/${counts.total} enriched`);
  }
}
