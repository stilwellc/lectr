import fs from 'node:fs';
import path from 'node:path';
import { MARKETS, marketArtists, type Market } from '../constants';
import { isLiveUpcoming } from '../utils';

/**
 * BUILD-TIME share facts — the live numbers each route's <title>,
 * description and share card name. SERVER-ONLY (node:fs): imported by
 * metadata exports and scripts/build-og.tsx, never by a client component.
 * Every figure is a count read from the served payload the page itself
 * renders from; a data-less checkout returns nulls and the copy falls back
 * to its plain sentence.
 */

const SERVED = path.join(process.cwd(), 'public', 'data', 'ray');
const memo = new Map<string, unknown>();
function served<T>(name: string): T | null {
  if (memo.has(name)) return memo.get(name) as T | null;
  let v: T | null = null;
  try { v = JSON.parse(fs.readFileSync(path.join(SERVED, name), 'utf8')) as T; } catch { v = null; }
  memo.set(name, v);
  return v;
}

interface LiteLot { id: string; artist: string; status: string; saleDate?: string; saleDateTime?: string | null; resultsPending?: boolean; signal?: { label: string } | null }

export interface MarketFacts {
  label: string;
  /** lots live on the block in this market at build time */
  live: number;
  /** of those, flagged Below Market by the engine */
  flagged: number;
  /** settled results on file for this market's makers/categories */
  settled: number | null;
}

/** the served book's headline totals */
export function bookFacts(): { settled: number | null; tracked: number | null; houses: number | null; replayed: number | null; asOf: string | null } {
  const meta = served<{ totalSold?: number; totalLots?: number; sources?: unknown[]; lastCrawl?: string }>('meta.json');
  const bt = served<{ flagged?: { n?: number } }>('backtest.json');
  return {
    settled: meta?.totalSold ?? null,
    tracked: meta?.totalLots ?? null,
    houses: meta?.sources?.length ?? null,
    replayed: bt?.flagged?.n ?? null,
    asOf: meta?.lastCrawl ? meta.lastCrawl.slice(0, 10) : null,
  };
}

export function marketFacts(market: Market): MarketFacts {
  const label = MARKETS.find(m => m.key === market)?.label || market;
  const lots = served<{ lots?: LiteLot[] }>('upcoming.json')?.lots || [];
  const stats = served<Record<string, { totalSoldTracked?: number }>>('stats.json') || {};
  const set = marketArtists(market);
  // the build's own day: a static page is cut once, so "live" means live
  // when the deploy was built — the nightly rebuild refreshes it
  const today = new Date().toISOString().slice(0, 10);
  let live = 0, flagged = 0;
  for (const l of lots) {
    if (market !== 'all' && !set.has(l.artist)) continue;
    if (!isLiveUpcoming(l, today) || l.resultsPending) continue;
    live++;
    if (l.signal?.label === 'Below Market') flagged++;
  }
  let settled = 0, any = false;
  for (const [slug, s] of Object.entries(stats)) {
    if (market !== 'all' && !set.has(slug)) continue;
    if (typeof s.totalSoldTracked === 'number') { settled += s.totalSoldTracked; any = true; }
  }
  if (market === 'all') settled = bookFacts().settled ?? settled;
  return { label, live, flagged, settled: any || market === 'all' ? settled : null };
}

export const n = (x: number) => x.toLocaleString('en-US');

/** the engine's expected hammer, printed to the precision it has */
export function fmtExpected(v: number): string {
  if (v < 1000) return `$${Math.round(v).toLocaleString('en-US')}`;
  if (v < 100_000) return `$${(Math.round(v / 100) * 100).toLocaleString('en-US')}`;
  if (v < 1_000_000) return `$${Math.round(v / 1000)}K`;
  return `$${(v / 1e6).toFixed(2)}M`;
}

/** One route's share block: the <title>/description plus matching Open Graph
 *  and Twitter entries carrying the route's own card. A child segment that
 *  sets `openGraph` replaces the parent's wholesale (Next merges metadata
 *  shallowly), so every route that names itself must name its image too —
 *  /art used to ship with no og:image at all for exactly that reason. */
export function shareMeta(opts: { title: string; description: string; image?: string; ogTitle?: string; absolute?: boolean; canonical?: string }) {
  const image = opts.image || '/opengraph-image';
  const ogTitle = opts.ogTitle || (opts.absolute ? opts.title : `${opts.title} — lectr`);
  return {
    title: opts.absolute ? { absolute: opts.title } : opts.title,
    description: opts.description,
    ...(opts.canonical ? { alternates: { canonical: opts.canonical } } : {}),
    openGraph: { title: ogTitle, description: opts.description, images: [image] },
    twitter: { card: 'summary_large_image' as const, title: ogTitle, description: opts.description, images: [image] },
  };
}

/** shareMeta for a metadata object that already reads well — adds the
 *  matching og/twitter block (site card unless an image is named). */
export function withShare<M extends { title: string | { absolute: string }; description: string }>(m: M, image?: string) {
  const t = typeof m.title === 'string' ? m.title : m.title.absolute;
  const s = shareMeta({ title: t, description: m.description, image, absolute: typeof m.title !== 'string' });
  return { ...m, openGraph: s.openGraph, twitter: s.twitter };
}


const LOT_NOUN: Partial<Record<Market, [string, string]>> = {
  art: ['artwork', 'artworks'], design: ['design lot', 'design lots'], watches: ['watch', 'watches'], sports: ['sports lot', 'sports lots'],
  tcg: ['card', 'cards'], science: ['science lot', 'science lots'], culture: ['pop-culture lot', 'pop-culture lots'],
};
/** the market's own word for a lot ("watch", "artworks") */
export function lotNoun(market: Market, count = 1): string {
  const w = LOT_NOUN[market] || ['lot', 'lots'];
  return count === 1 ? w[0] : w[1];
}

/** a vertical's description — its own counts at build */
export function verticalDescription(market: Market): string {
  const f = marketFacts(market);
  const settled = f.settled ? `${n(f.settled)} settled results` : 'the settled record';
  if (!f.live) {
    return `No ${lotNoun(market, 2)} on the block right now. The next sale is read against ${settled} the night it lists.`;
  }
  const flagged = f.flagged
    ? `${n(f.flagged)} where the record says the hammer clears the house estimate`
    : 'none the record calls above its estimate tonight';
  return `${n(f.live)} ${lotNoun(market, f.live)} on the block; ${flagged}. Read against ${settled}.`;
}
