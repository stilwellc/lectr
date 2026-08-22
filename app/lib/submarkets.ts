/**
 * submarkets.ts — client helpers for the sub-category taxonomy.
 * drillRowFor: resolve a lot to its drills row in market.json (the sub-market
 * read that contextualizes the lot). sportOfLot: the ONE sport derivation —
 * crawl-stamped fields first (l.sport is Goldin's own value; l.drill is the
 * normalize stamp at 82% coverage), title heuristic last. Display strings
 * match sportOf()'s labels so saved-search sport values stay stable.
 */
import type { AuctionLot } from '../types';
import type { MarketData, SubMarketRead } from '../hooks/useRayData';
import { ARTIST_MARKET } from '../constants';
import { sportOf } from '../utils';

export type DrillRow = SubMarketRead & { parent: string };

const DRILL_SPORT: Record<string, string> = {
  basketball: 'Basketball', baseball: 'Baseball', football: 'Football',
  soccer: 'Soccer', hockey: 'Hockey', 'boxing-mma': 'Boxing / MMA',
  golf: 'Golf', racing: 'Racing', tennis: 'Tennis', olympics: 'Olympics',
  wrestling: 'Wrestling',
};

/** Goldin sport string → drill slug ('Boxing / MMA' → 'boxing-mma') */
export const sportDrillOf = (sport: string | null | undefined): string | null => {
  if (!sport) return null;
  const hit = Object.entries(DRILL_SPORT).find(([, label]) => label === sport);
  return hit ? hit[0] : null;
};

/** sports ARTIST slug → taxonomy kind (players.json cats key the slugs) */
export const SPORTS_SLUG_KIND: Record<string, string> = {
  'sports-cards': 'cards', 'game-used': 'game-used', 'sports-memorabilia': 'memorabilia',
  'tickets-passes': 'tickets', 'trophies-awards': 'trophies',
};

export function sportOfLot(l: Pick<AuctionLot, 'title' | 'sport' | 'drill'>): string | null {
  if (typeof l.sport === 'string' && l.sport) return l.sport;
  if (l.drill && DRILL_SPORT[l.drill]) return DRILL_SPORT[l.drill];
  return sportOf(l.title || '');
}

/** The drills-row slug a lot belongs to (mirrors buildDrillRows' emission). */
export function drillSlugFor(l: Pick<AuctionLot, 'artist' | 'subCat' | 'drill'>): { vertical: string; slug: string } | null {
  const vert = ARTIST_MARKET[l.artist as keyof typeof ARTIST_MARKET];
  if (!vert || !l.subCat) return null;
  if (vert === 'sports') return l.drill ? { vertical: 'sports', slug: `${l.subCat}:${l.drill}` } : null;
  if (vert === 'watches') return l.drill ? { vertical: 'watches', slug: `${l.artist}:${l.drill}` } : null;
  if (vert === 'tcg') return l.drill ? { vertical: 'tcg', slug: `pokemon-era:${l.drill}` }
    : l.subCat !== 'other' ? { vertical: 'tcg', slug: `tcg:${l.subCat}` } : null;
  if (vert === 'culture') return l.drill ? { vertical: 'culture', slug: `culture:${l.drill}` }
    : l.subCat !== 'other' ? { vertical: 'culture', slug: `culture-kind:${l.subCat}` } : null;
  if (vert === 'science') return l.drill ? { vertical: 'science', slug: `${l.subCat}:${l.drill}` } : null;
  if (vert === 'art') return l.subCat !== 'other' ? { vertical: 'art', slug: `art:${l.subCat}` } : null;
  if (vert === 'design') return { vertical: 'design', slug: `design:${l.subCat}` };
  return null;
}

/** A lot's sub-market read from market.json's drills (null when unpublished). */
export function drillRowFor(l: Pick<AuctionLot, 'artist' | 'subCat' | 'drill'>, marketData: MarketData | null | undefined): DrillRow | null {
  const ref = drillSlugFor(l);
  if (!ref || !marketData?.drills) return null;
  return (marketData.drills[ref.vertical] || []).find(r => r.slug === ref.slug) ?? null;
}
