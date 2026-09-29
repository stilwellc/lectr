/**
 * scripts/lib/houses — one module per auction house behind one small interface.
 *
 * Each house exposes:
 *   fetch+parse  crawlArtist (per tracked maker) / crawlAuctions (cross-roster
 *                auction pass) / crawl (whole-feed houses) — the network walk
 *                and the parse into AuctionLot rows, exactly as ray-crawl ran
 *                them before the split;
 *   parse        the house's pure row parsers (payload → AuctionLot | null),
 *                for fixture tests;
 *   enrich       the detail-page enricher (medium/dimensions/year), if any;
 *   invariants   row-level checks every lot this house emits must pass
 *                (id namespace, house label, required fields) — returns the
 *                violations, never throws;
 *   health       this house's counters from the shared HEALTH tally
 *                (source-advertised total, lot-bearing pages fetched, rows
 *                dropped at parse for a missing required field).
 *
 * scripts/ray-crawl.ts keeps the CLI, the maker sweep, merge/reconcile and the
 * segment write; it calls the house functions directly. The registry below is
 * what the record/replay equivalence harness (scripts/ci/crawl-replay-check.ts)
 * and tests walk.
 */
import type { AuctionHouse, AuctionLot } from '../../../app/types';
import type { ArtistConfig } from './artists';
import { HEALTH, type EnrichResult } from './common';
import { crawlPhillips, enrichPhillips } from './phillips';
import { crawlSothebys, crawlSothebysAuctions, enrichSothebysCloseTimes, enrichSothebys } from './sothebys';
import { crawlChristies, crawlChristiesAuctions, enrichChristies, parseChristiesHtml, parseChristiesJson, parseChristiesCurrency } from './christies';
import { crawlWright, fixWrightRagoSessions, parseWrightBasicItem, parseWrightAdvancedItem } from './wright';
import { crawlLama, parseLamaItem } from './lama';
import { crawlBonhams, enrichBonhams, parseBonhamsLot } from './bonhams';
import { crawlGoldin, isPlaceholderClose, goldinCompletedAuctions, goldinStatusOk, goldinFeedComplete } from './goldin';

export type AuctionScope = 'watches' | 'science' | 'sports' | 'art' | 'all';

export interface HouseHealth { expected: number | null; fetched: number; parseErrors: number }

export interface HouseModule {
  /** HEALTH / RAY_HOUSE key (the segment, or the sub-house key for LAMA) */
  key: string;
  /** the AuctionLot.auctionHouse labels this module emits */
  houses: AuctionHouse[];
  /** id namespaces (`<prefix>-…`) this module emits */
  idPrefixes: string[];
  crawlArtist?: (artist: ArtistConfig) => Promise<AuctionLot[]>;
  crawlAuctions?: (scope: AuctionScope) => Promise<AuctionLot[]>;
  /** accurate per-lot close times for a crawled auction set (mutates in place) */
  closeTimes?: (lots: AuctionLot[]) => Promise<void>;
  crawl?: () => Promise<AuctionLot[]>;
  /** run-level state a whole-feed crawl leaves for the merge (Goldin) */
  state?: () => unknown;
  enrich?: (lot: AuctionLot) => Promise<EnrichResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parse: Record<string, (...args: any[]) => unknown>;
  invariants: (lots: readonly AuctionLot[]) => string[];
  health: () => HouseHealth;
}

const healthOf = (key: string) => (): HouseHealth => ({
  expected: HEALTH.expected[key] ?? null,
  fetched: HEALTH.fetched[key] || 0,
  parseErrors: HEALTH.parseErrors[key] || 0,
});

/** Shared row checks: the id namespace + house label this module owns, and the
 *  required identity fields (id/title/url) every emitted row must carry. */
const invariantsOf = (houses: AuctionHouse[], idPrefixes: string[]) => (lots: readonly AuctionLot[]): string[] => {
  const out: string[] = [];
  for (const l of lots) {
    const ref = l?.id || '(no id)';
    if (!l?.id || !idPrefixes.some(p => l.id.startsWith(`${p}-`))) out.push(`${ref}: id outside namespace [${idPrefixes.join(', ')}]`);
    if (!houses.includes(l?.auctionHouse)) out.push(`${ref}: auctionHouse ${JSON.stringify(l?.auctionHouse)} not in [${houses.join(', ')}]`);
    if (!l?.title) out.push(`${ref}: missing title`);
    if (!l?.url) out.push(`${ref}: missing url`);
  }
  return out;
};

const house = (m: Omit<HouseModule, 'invariants' | 'health'>): HouseModule => ({
  ...m,
  invariants: invariantsOf(m.houses, m.idPrefixes),
  health: healthOf(m.key),
});

export const HOUSES = {
  phillips: house({
    key: 'phillips', houses: ['Phillips'], idPrefixes: ['phillips'],
    crawlArtist: crawlPhillips, enrich: enrichPhillips, parse: {},
  }),
  sothebys: house({
    key: 'sothebys', houses: ["Sotheby's"], idPrefixes: ['sothebys'],
    crawlArtist: crawlSothebys, crawlAuctions: crawlSothebysAuctions, closeTimes: enrichSothebysCloseTimes,
    enrich: enrichSothebys, parse: {},
  }),
  christies: house({
    key: 'christies', houses: ["Christie's"], idPrefixes: ['christies'],
    crawlArtist: crawlChristies, crawlAuctions: crawlChristiesAuctions, enrich: enrichChristies,
    parse: { parseChristiesHtml, parseChristiesJson, parseChristiesCurrency },
  }),
  wright: house({
    key: 'wright', houses: ['Wright', 'Rago'], idPrefixes: ['wright', 'rago'],
    crawlArtist: crawlWright, parse: { parseWrightBasicItem, parseWrightAdvancedItem, fixWrightRagoSessions },
  }),
  lama: house({
    key: 'lama', houses: ['LAMA'], idPrefixes: ['lama'],
    crawlArtist: crawlLama, parse: { parseLamaItem },
  }),
  bonhams: house({
    key: 'bonhams', houses: ['Bonhams'], idPrefixes: ['bonhams'],
    crawlArtist: crawlBonhams, enrich: enrichBonhams, parse: { parseBonhamsLot },
  }),
  goldin: house({
    key: 'goldin', houses: ['Goldin'], idPrefixes: ['goldin'],
    crawl: crawlGoldin,
    state: () => ({ completedAuctions: Array.from(goldinCompletedAuctions).sort(), statusOk: goldinStatusOk, feedComplete: goldinFeedComplete }),
    parse: { isPlaceholderClose },
  }),
} satisfies Record<string, HouseModule>;

export type HouseKey = keyof typeof HOUSES;
