/**
 * Sotheby's per-maker HISTORY pass — the public Algolia search index, one
 * roster maker at a time.
 *
 * Why: the nightly Sotheby's legs are the GraphQL auction crawler (the
 * current departments' sales) and the artist-page scrape (no results). The
 * 2025 Algolia discovery backfill (removed in 7f8cbef) routed with the routing
 * table of ITS day — the blue-chip makers added Aug 2026 (Basquiat,
 * Lichtenstein, Bacon, Calder, Koons, Rashid Johnson) never got history, so
 * the corpus holds 6 Basquiat Sotheby's sales while the index holds ~420+
 * sold, and ~150 live art lots abstain for want of comps.
 *
 * What: for each selected maker, enumerate `type:Lot AND soldStatus:SOLD`
 * hits (endDate-window bisection under Algolia's 1,000-hit page cap), keep
 * only hits whose OWN creator/brand text routes to that maker through the
 * shared routeItem (item-level doctrine; watches also require the Watches
 * department), and mint rows IDENTICAL in shape to the GraphQL auction
 * crawler's:
 *   · id `sothebys-<lotId>` — Algolia's objectID IS the GraphQL lotId
 *     (verified: Condo "Politician", HK 2026 → 9619a8a2-…), so a later
 *     nightly re-crawl of the same lot lands on the same id;
 *   · price: `salePrice` is the buyer-inclusive realized total → premiumNative
 *     (exactly the crawler's `finalPrice`), priceBasis 'realized'. The index
 *     also carries `hammerPrice` on most archive lots; it is stamped as
 *     hammerNative ONLY when it is a plausible hammer under that total
 *     (1.0 < total/hammer ≤ 1.40) — never derived from a premium schedule;
 *   · currency fail-closed: the "Sale price: N CUR" tail of `details` (its
 *     amount must equal salePrice) else `estimateCurrency`; an unconvertible
 *     or missing code skips the hit; estimates ride only when they are in the
 *     price currency;
 *   · saleDate: `endDate` read in the sale-currency zone (lib/sale-day), as
 *     the crawler does with its endDate.
 * Dedupe: a hit is skipped when its lotId already exists under either crawled
 * scheme (`sothebys-<uuid>` live crawl, `sothebys-alg-<uuid>` 2025 archive) or
 * its lot URL path is already held by a crawled row. A path held only by an
 * artist-page/seed row (`sothebys-<slug>`, June-1 placeholder date, no price)
 * does NOT block — the priced row supersedes it in assemble's
 * dedupeUrlSchemeCollisions (crawled id wins).
 *
 * Gated: SOTHEBYS_HISTORY=1 (the dispatch-only backfill workflow). The nightly
 * never sets it — unchanged. A 403 (or a 429 that does not clear after a short
 * backoff) STOPS the pass: never retried with another identity.
 */
import { isCurrency, type AuctionLot, type Currency, type LotCategory } from '../../../app/types';
import type { ArtistConfig } from './artists';
import { MEDIUM_PATTERNS, UA, noteFetched, sleep, stampMoney, statusWithMoney } from './common';
import { routeItem } from './routing';
import { saleDayOf } from '../sale-day';

export const SOTHEBYS_HISTORY = process.env.SOTHEBYS_HISTORY === '1';
/** only sales ending on/after Jan 1 of this year (0 = the full index) */
export const SOTHEBYS_HISTORY_SINCE = Number(process.env.SOTHEBYS_HISTORY_SINCE) || 0;

export const SOTHEBYS_WATCH_SLUGS: readonly string[] = ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'];

// last-known-good creds (same as resolve-sothebys.ts) — the page scrape heals a rotation
export const ALGOLIA_FALLBACK = { appId: 'O28SY4Q7WU', apiKey: 'e732e65c70ebf8b51d4e2f922b536496', index: 'bsp_dotcom_prod_en' } as const;
type Creds = { appId: string; apiKey: string; index: string };

export type AlgoliaLotHit = {
  objectID?: string | null; url?: string | null; title?: string | null;
  conciseHeading?: string | null; imageAltText?: string | null; guaranteeLine?: string | null;
  salePrice?: number | null; hammerPrice?: number | null; details?: string | null; soldStatus?: string | null;
  lowEstimate?: number | null; highEstimate?: number | null; estimateCurrency?: string | null;
  artistName?: string | null; artists?: string[] | null; brands?: string[] | null; departments?: string[] | null;
  endDate?: number | null; lotNumber?: string | number | null; fullText?: string | null;
  auctionTitle?: string | null; image?: string | null; landscapeImage?: string | null; portraitImage?: string | null;
};

const ATTRS = ['objectID', 'url', 'title', 'conciseHeading', 'imageAltText', 'guaranteeLine', 'salePrice', 'hammerPrice',
  'details', 'soldStatus', 'lowEstimate', 'highEstimate', 'estimateCurrency', 'artistName', 'artists', 'brands',
  'departments', 'endDate', 'lotNumber', 'fullText', 'auctionTitle', 'image', 'landscapeImage', 'portraitImage'];

// ── pure helpers (unit-tested) ─────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Sotheby's lot id (Algolia objectID ≡ GraphQL lotId), or null. */
export function lotIdOf(hit: AlgoliaLotHit): string | null {
  const id = String(hit.objectID || '').trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/** Canonical lot key: the URL path (query/fragment stripped, lower-cased) of a
 *  LOT page — new `/buy/auction/<yr>/<sale>/<lot>` or legacy
 *  `/auctions/ecatalogue/<yr>/<sale>/lot.<n>.html`. null for anything else. */
export function lotPathKey(url: string | null | undefined): string | null {
  const p = String(url || '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  if (/^\/(?:[a-z]{2}\/)?buy\/auction\/\d{4}\/[^/]+\/[^/]+$/.test(p)) return p.replace(/^\/[a-z]{2}\//, '/');
  if (/^\/(?:[a-z]{2}\/)?auctions\/ecatalogue\/\d{4}\/[^/]+\/lot\.[^/]+\.html$/.test(p)) return p.replace(/^\/[a-z]{2}\//, '/');
  return null;
}

/** Title-cased sale name from the lot URL's sale slug (the crawler's
 *  transform), the legacy ecatalogue sale-number suffix stripped. */
export function saleNameOf(url: string | null | undefined, fallback?: string | null): string {
  const u = String(url || '');
  let slug = (u.match(/\/buy\/auction\/\d{4}\/([a-z0-9-]+)\//i) || [])[1] || '';
  if (!slug) {
    const m = u.match(/\/ecatalogue\/\d{4}\/([a-z0-9-]+)\/lot\./i);
    if (m) slug = m[1].replace(/-[a-z]{0,3}\d{3,}[a-z]?$/i, '');
  }
  if (!slug) return (fallback || '').trim();
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Display title: the cased heading forms first (`title` is lower-cased in
 *  the index), the bare `title` last. */
export function titleOf(hit: AlgoliaLotHit): string {
  const alt = String(hit.imageAltText || '').replace(/^View \d+ of Lot [^:]*:\s*/i, '').trim();
  if (alt && !/^view \d+/i.test(alt)) return alt;
  const head = String(hit.conciseHeading || '').trim();
  const creator = String(hit.artistName || '').trim();
  if (head) {
    const stripped = creator && head.toLowerCase().startsWith(creator.toLowerCase() + ',') ? head.slice(creator.length + 1).trim() : head;
    if (stripped) return stripped;
  }
  // bare index title: "jean-michel basquiat | flexible" → "flexible"
  const bare = String(hit.title || '').trim();
  const bar = bare.indexOf(' | ');
  if (bar > 0 && creator && bare.slice(0, bar).toLowerCase() === creator.toLowerCase()) return bare.slice(bar + 3).trim();
  return bare;
}

/** "… | Sale price: 1,605,500 USD": the code (and its amount). */
export function detailsPrice(details: string | null | undefined): { amount: number; code: string } | null {
  const m = String(details || '').match(/Sale price:\s*([\d,.]+)\s*([A-Z]{3})/);
  if (!m) return null;
  return { amount: Number(m[1].replace(/,/g, '')), code: m[2] };
}

/** The price currency, fail-closed: the details tail (whose amount must equal
 *  salePrice) else estimateCurrency. null = unknown/unconvertible → skip. */
export function priceCurrencyOf(hit: AlgoliaLotHit): Currency | null {
  const d = detailsPrice(hit.details);
  if (d) {
    if (!isCurrency(d.code)) return null;
    if (hit.salePrice != null && Math.abs(d.amount - Number(hit.salePrice)) > 0.5) return null; // two numbers disagree
    return d.code;
  }
  const est = String(hit.estimateCurrency || '').trim().toUpperCase();
  return isCurrency(est) ? est : null;
}

/** Attribution qualifiers — a lot "after"/"circle of" a maker is not theirs. */
const QUALIFIED = /^\s*(?:after|attributed to|circle of|school of|follower of|manner of|studio of|workshop of|style of|in the manner of)\b/i;

/** The creator text a hit routes on: artistName, else the artists list, else brands. */
export function creatorOf(hit: AlgoliaLotHit): string {
  return String(hit.artistName || '').trim()
    || (Array.isArray(hit.artists) ? hit.artists.join(' / ') : '')
    || (Array.isArray(hit.brands) ? hit.brands.join(' / ') : '');
}

/** Art/design departments a maker's work sells through (the 2025 Algolia
 *  backfill's allowlist, art side). A department outside it — Books &
 *  Manuscripts (a book OF Basquiat drawings), Wine, Asian works — is not the
 *  maker's artwork market. A hit with no departments at all is allowed. */
export const ART_DEPARTMENTS: ReadonlySet<string> = new Set([
  'Contemporary Art', 'Impressionist & Modern Art', 'Modern British & Irish Art', 'American Art',
  'Latin American Art', 'Prints', 'Photographs', 'Digital Art', '20th Century Design',
  'European Sculpture & Works of Art', 'Sneakers, Sports Memorabilia & Modern Collectibles', 'Popular Culture',
]);

/** Watch-ness of a watch-maker title (verbatim from the 2025 Algolia backfill's
 *  vertical guard) and the accessories the Watches department also sells. */
export const WATCH_SIGNAL = /watch|montre|chronograph|chronometer|chronometre|tourbillon|calibre|caliber|\bref\.?\b|reference|automatic|self-?winding|manual wind|movement|\bdial\b|perpetual|minute repeat|moonphase|moon phase|day-?date|tank|santos|panth|ballon|pasha|tortue|baignoire|\bronde\b|roadster|\bdrive\b|cloche|oyster|cosmograph|datejust|submariner|seamaster|speedmaster|constellation|nautilus|aquanaut|calatrava|royal oak|cellini|de ville|must de|must 21|jaeger|reverso/i;
export const NOT_A_WATCH = /\b(?:cuff ?links?|tie (?:clip|bar|pin)s?|key ?rings?|keychains?|fountain pens?|lighters?|watch (?:box|winder|stand)(?:es|s)?|presentation box(?:es)?|display cases?|earrings|brooch(?:es)?|necklaces?)\b/i;

/** Does this hit belong to `slug`? Art: the CREATOR field alone must route to
 *  the maker (a Warhol portrait OF Basquiat is Warhol's; a collaboration
 *  routes like the crawler's creatorsDisplayTitle — first tracked name) and
 *  the department must be an art one. Watches: the Watches department + the
 *  brand/creator/title routing to the maker. */
export function hitBelongsTo(hit: AlgoliaLotHit, slug: string): boolean {
  const depts = Array.isArray(hit.departments) ? hit.departments : [];
  if (SOTHEBYS_WATCH_SLUGS.includes(slug)) {
    if (!depts.includes('Watches')) return false;
    const title = titleOf(hit);
    // the Watches department also sells a maker's cufflinks, boxes, clocks'
    // keys… — a watch-maker row must read as a watch (the 2025 backfill's guard)
    if (NOT_A_WATCH.test(title) || !WATCH_SIGNAL.test(title)) return false;
    const brands = Array.isArray(hit.brands) ? hit.brands.join(' / ') : '';
    return routeItem(`${brands} ${hit.artistName || ''}`.trim() || null, title, '') === slug;
  }
  if (depts.length && !depts.some(d => ART_DEPARTMENTS.has(d))) return false;
  const creator = creatorOf(hit);
  if (!creator || QUALIFIED.test(creator)) return false;
  return routeItem(creator, '', '') === slug;
}

/** Medium / dimensions / year from the catalogue `fullText`, read AFTER the
 *  title so a provenance line cannot leak in. Archive hits carry no fullText
 *  but a catalogue-line title ("Untitled, 1981, acrylic on canvas, 152 by
 *  127cm.") — then the facts are read from the title after its first comma. */
export function catalogueFacts(hit: AlgoliaLotHit): { medium: string | null; dimensions: string | null; year: string | null } {
  const full = String(hit.fullText || '').replace(/\s+/g, ' ').trim();
  const t = titleOf(hit);
  let tail: string;
  let fromTitle = false;
  if (full) {
    const at = t ? full.toLowerCase().indexOf(t.toLowerCase()) : -1;
    tail = at >= 0 ? full.slice(at + t.length) : full;
  } else {
    const comma = t.indexOf(',');
    if (comma < 0) return { medium: null, dimensions: null, year: null };
    tail = t.slice(comma + 1);
    fromTitle = true;
  }
  const med = tail.match(new RegExp(`\\b(${MEDIUM_PATTERNS.source}[^,;.]{0,60})`, 'i'));
  const medium = med ? med[1].replace(/\s+\d.*$/, '').trim() || null : null;
  const dim = tail.match(/(\d+(?:\s?[¼½¾⅓⅔⅛⅜⅝⅞]|\.\d+)?\s*(?:by|[×x])\s*\d+(?:\s?[¼½¾⅓⅔⅛⅜⅝⅞]|\.\d+)?(?:\s*(?:by|[×x])\s*\d+(?:\s?[¼½¾⅓⅔⅛⅜⅝⅞]|\.\d+)?)?\s*(?:in|cm|mm)\.?)/i);
  const yr = tail.match(/(?:executed|painted|conceived|created|cast|drawn|printed)\s+(?:circa\s+|c\.\s*)?(?:in\s+)?(\d{4})/i)
    || tail.match(/(?:circa|c\.)\s*(\d{4})/i)
    // catalogue-line title: the first ", 1985," segment is the year
    || (fromTitle ? tail.match(/^\s*(?:circa\s+|c\.\s*)?((?:18|19|20)\d\d)\b/i) : null);
  return { medium, dimensions: dim ? dim[1].trim() : null, year: yr ? yr[1] : null };
}

export type HitSkip = 'not-sold' | 'no-lot-id' | 'no-price' | 'currency' | 'no-date' | 'before-since';

/** One sold hit → a crawler-shaped AuctionLot for `artist`, or the skip reason. */
export function hitToLot(hit: AlgoliaLotHit, artist: string, opts: { sinceMs?: number } = {}): AuctionLot | HitSkip {
  if (hit.soldStatus !== 'SOLD') return 'not-sold';
  const lotId = lotIdOf(hit);
  if (!lotId) return 'no-lot-id';
  const premiumNative = Number(hit.salePrice);
  if (!(premiumNative > 0)) return 'no-price';
  const cur = priceCurrencyOf(hit);
  if (!cur) return 'currency';
  const end = Number(hit.endDate);
  if (!Number.isFinite(end) || end <= 0) return 'no-date';
  if (opts.sinceMs && end < opts.sinceMs) return 'before-since';
  const iso = new Date(end).toISOString();
  const saleDay = saleDayOf("Sotheby's", iso, { currency: cur }) || iso.slice(0, 10);

  // a hammer rides only when it is a plausible hammer under the total
  const h = Number(hit.hammerPrice);
  const hammerNative = h > 0 && premiumNative > h && premiumNative / h <= 1.40 ? h : null;
  // estimates are in estimateCurrency — they ride only in the price currency
  const estCur = String(hit.estimateCurrency || '').trim().toUpperCase();
  const estOk = !estCur || estCur === cur;
  const lo = estOk && Number(hit.lowEstimate) > 0 ? Number(hit.lowEstimate) : null;
  const hi = estOk && Number(hit.highEstimate) > 0 ? Number(hit.highEstimate) : null;

  const money = stampMoney({
    isSold: true,
    nativeCurrency: cur,
    saleDate: saleDay,
    hammerNative,
    premiumNative,
    estLowNative: lo,
    estHighNative: hi && lo && hi < lo ? null : hi,
    priceBasis: 'realized',
  });
  // art facts only — a watch's catalogue line yields "steel back" / "enamel
  // dial" as a medium (the crawler leaves watch medium to its subtitle)
  const facts = SOTHEBYS_WATCH_SLUGS.includes(artist) ? { medium: null, dimensions: null, year: null } : catalogueFacts(hit);
  const full = String(hit.fullText || '').replace(/\s+/g, ' ').trim();
  const url = String(hit.url || '').replace(/^http:\/\//, 'https://');
  const lotNumber = hit.lotNumber != null ? (parseInt(String(hit.lotNumber), 10) || null) : null;
  return {
    id: `sothebys-${lotId}`,
    artist,
    title: titleOf(hit) || '(untitled)',
    year: facts.year,
    medium: facts.medium,
    dimensions: facts.dimensions,
    description: full ? full.slice(0, 800) : null,
    category: 'unknown' as LotCategory,
    imageUrl: hit.landscapeImage || hit.portraitImage || hit.image || null,
    auctionHouse: "Sotheby's",
    saleName: saleNameOf(url, hit.auctionTitle),
    saleDate: saleDay,
    saleDateTime: iso,
    lotNumber,
    ...money,
    status: statusWithMoney('sold', money) as AuctionLot['status'],
    resultsPending: false,
    url,
  } as AuctionLot;
}

/** What the segment already holds: crawled lot ids (both schemes) + lot paths. */
export interface SothebysKnown { ids: Set<string>; crawledPaths: Set<string>; seedPaths: Set<string> }

const CRAWLED_ID = /^sothebys-(?:alg-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function buildSothebysKnown(rows: Iterable<{ id?: unknown; url?: unknown; auctionHouse?: unknown }>): SothebysKnown {
  const k: SothebysKnown = { ids: new Set(), crawledPaths: new Set(), seedPaths: new Set() };
  for (const r of Array.from(rows)) {
    if (r.auctionHouse !== "Sotheby's") continue;
    const id = String(r.id || '');
    const m = CRAWLED_ID.exec(id);
    if (m) k.ids.add(m[1].toLowerCase());
    const p = lotPathKey(String(r.url || ''));
    if (p) (m ? k.crawledPaths : k.seedPaths).add(p);
  }
  return k;
}

export type DedupeVerdict = 'new' | 'supersedes-seed' | 'dup-id' | 'dup-path';

/** new · supersedes-seed (only an artist-page/seed row holds the path) ·
 *  dup-id (lot id held under either crawled scheme) · dup-path. */
export function dedupeVerdict(known: SothebysKnown, lot: { id: string; url: string }): DedupeVerdict {
  const m = CRAWLED_ID.exec(lot.id);
  if (m && known.ids.has(m[1].toLowerCase())) return 'dup-id';
  const p = lotPathKey(lot.url);
  if (p && known.crawledPaths.has(p)) return 'dup-path';
  if (p && known.seedPaths.has(p)) return 'supersedes-seed';
  return 'new';
}

/** Roster entries this pass can serve: makers (art/design with a house id) + watches. */
export function sothebysHistoryMakers(roster: readonly ArtistConfig[]): ArtistConfig[] {
  return roster.filter(a => SOTHEBYS_WATCH_SLUGS.includes(a.slug)
    || !!(a.sothebys || a.christies || a.phillips || a.wright || a.bonhams));
}

// ── Algolia plumbing ───────────────────────────────────────────────────────

class AlgoliaBlocked extends Error {}

async function algoliaCreds(): Promise<Creds> {
  try {
    const r = await fetch('https://www.sothebys.com/en/search', { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const html = r.ok ? await r.text() : '';
    const appId = (html.match(/ALGOLIA_SEARCH_APP_ID['":\s]+([A-Z0-9]{8,12})/) || [])[1];
    const apiKey = (html.match(/ALGOLIA_SEARCH_API_KEY['":\s]+([a-f0-9]{32})/) || [])[1];
    const index = (html.match(/ALGOLIA_SEARCH_INDEX['":\s]+([a-z0-9_]+)/) || [])[1];
    if (appId && apiKey && index) return { appId, apiKey, index };
  } catch { /* fall through */ }
  return { ...ALGOLIA_FALLBACK };
}

async function algoliaQuery(c: Creds, body: Record<string, unknown>): Promise<{ nbHits: number; hits: AlgoliaLotHit[] }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let r: Response;
    try {
      r = await fetch(`https://${c.appId}-dsn.algolia.net/1/indexes/${c.index}/query`, {
        method: 'POST',
        headers: { 'x-algolia-application-id': c.appId, 'x-algolia-api-key': c.apiKey, 'content-type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch { await sleep(800 * (attempt + 1)); continue; }
    // a block is a STOP, never something to route around
    if (r.status === 401 || r.status === 403) throw new AlgoliaBlocked(`HTTP ${r.status}`);
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    if (!r.ok) throw new AlgoliaBlocked(`HTTP ${r.status}`);
    const j = (await r.json()) as { nbHits?: number; hits?: AlgoliaLotHit[] };
    noteFetched('sothebys');
    return { nbHits: j.nbHits || 0, hits: j.hits || [] };
  }
  throw new AlgoliaBlocked('retries exhausted (429/5xx/network)');
}

const PAGE = 1000;

/** Every sold hit for `query` under `filters`, by endDate-window bisection
 *  (a full page means the window overflowed → split; never page past 1,000). */
async function enumerateSold(c: Creds, query: string, filters: string, loMs: number, hiMs: number): Promise<{ hits: AlgoliaLotHit[]; queries: number; truncated: number }> {
  const out: AlgoliaLotHit[] = [];
  const seen = new Set<string>();
  let queries = 0, truncated = 0;
  const queue: [number, number][] = [[loMs, hiMs]];
  while (queue.length) {
    const [lo, hi] = queue.shift()!;
    queries++;
    const r = await algoliaQuery(c, { query, hitsPerPage: PAGE, filters, numericFilters: [`endDate>=${lo}`, `endDate<${hi}`], attributesToRetrieve: ATTRS, attributesToHighlight: [] });
    if (r.hits.length >= PAGE && hi - lo > 1) {
      const mid = lo + Math.floor((hi - lo) / 2);
      queue.unshift([lo, mid], [mid, hi]);
      continue;
    }
    if (r.hits.length >= PAGE) truncated++;
    for (const h of r.hits) {
      const k = String(h.objectID || h.url || '');
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(h);
    }
    await sleep(120);
  }
  return { hits: out, queries, truncated };
}

export interface HistoryReport {
  maker: string; hits: number; routed: number; rows: number; queries: number; truncated: number;
  skips: Record<string, number>; dedupe: Record<DedupeVerdict, number>;
}

/** The pass: per selected maker, sold hits → crawler-shaped rows that the
 *  segment (`known`) does not already hold. Stops on a block. */
export async function crawlSothebysMakerHistory(roster: readonly ArtistConfig[], known: SothebysKnown, opts: { sinceYear?: number; log?: boolean } = {}): Promise<{ lots: AuctionLot[]; reports: HistoryReport[]; blocked: string | null }> {
  const makers = sothebysHistoryMakers(roster);
  const lots: AuctionLot[] = [];
  const reports: HistoryReport[] = [];
  if (!makers.length) return { lots, reports, blocked: null };
  const creds = await algoliaCreds();
  const sinceYear = opts.sinceYear ?? SOTHEBYS_HISTORY_SINCE;
  const sinceMs = sinceYear > 0 ? Date.UTC(sinceYear, 0, 1) : 0;
  const loMs = sinceMs || Date.UTC(1998, 0, 1);
  const hiMs = Date.now() + 864e5;
  const minted = new Set<string>();
  console.log(`  [Sotheby's history] ${makers.length} maker(s) · algolia ${creds.appId}/${creds.index} · since ${sinceYear || 'all'}`);
  for (const a of makers) {
    const watch = SOTHEBYS_WATCH_SLUGS.includes(a.slug);
    const filters = `type:Lot AND soldStatus:SOLD${watch ? ' AND departments:"Watches"' : ''}`;
    let res: { hits: AlgoliaLotHit[]; queries: number; truncated: number };
    try {
      res = await enumerateSold(creds, a.displayName.replace(/&/g, 'and'), filters, loMs, hiMs);
    } catch (e) {
      const why = (e as Error).message;
      console.warn(`  [Sotheby's history] ${a.slug}: STOPPED — ${why} (a block is never retried around)`);
      return { lots, reports, blocked: `${a.slug}: ${why}` };
    }
    const rep: HistoryReport = { maker: a.slug, hits: res.hits.length, routed: 0, rows: 0, queries: res.queries, truncated: res.truncated, skips: {}, dedupe: { 'new': 0, 'supersedes-seed': 0, 'dup-id': 0, 'dup-path': 0 } };
    for (const h of res.hits) {
      if (!hitBelongsTo(h, a.slug)) { rep.skips['not-this-maker'] = (rep.skips['not-this-maker'] || 0) + 1; continue; }
      rep.routed++;
      const lot = hitToLot(h, a.slug, { sinceMs });
      if (typeof lot === 'string') { rep.skips[lot] = (rep.skips[lot] || 0) + 1; continue; }
      const v = dedupeVerdict(known, lot);
      rep.dedupe[v]++;
      if (v === 'dup-id' || v === 'dup-path' || minted.has(lot.id)) continue;
      minted.add(lot.id);
      lots.push(lot);
      rep.rows++;
    }
    reports.push(rep);
    if (opts.log !== false) {
      console.log(`  [Sotheby's history] ${a.slug}: ${rep.hits} sold hits (${rep.queries} queries${rep.truncated ? `, ${rep.truncated} TRUNCATED windows` : ''}) → ${rep.routed} this maker → ${rep.rows} new rows · dedupe ${JSON.stringify(rep.dedupe)} · skips ${JSON.stringify(rep.skips)}`);
    }
  }
  return { lots, reports, blocked: null };
}
