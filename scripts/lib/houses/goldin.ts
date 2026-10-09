/**
 * Goldin — live-inventory facet passes, sold-results archive, auction status
 * (Completed flip source) and the recent-close sold sweep.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import type { AuctionLot } from '../../../app/types';
import { routeCulture } from '../../culture';
import { goldinNonSportFix, trophyIsTicketOrPhoto, hasSportsTitleEvidence, DROP } from '../classify';
import { fetchWithRetry } from '../fetch-retry';
import { DEEP, UA, noteExpected, noteFetched, parseDrop, sleep, stampMoney } from './common';
import { saleDayOf } from '../sale-day';
import { GOLDIN_CARD_MAKERS, GOLDIN_EXCLUDE_GAMES, GOLDIN_EXCLUDE_MISC, GOLDIN_LEAK_NOTE, GOLDIN_POKEMON, goldinRoute } from './routing';

// ── Goldin Crawler ──
// goldin.co runs bid auctions (no published estimates). Their lots_v2 API is
// open and FACETED — Goldin curates item types themselves, so we query the
// object facets directly and never touch Single Cards, Cases/Boxes/Packs, or
// Video Games. DOCTRINE, item-level and belt-and-braces:
//   sports  = game-used / trophies & awards / tickets & passes — NEVER cards
//   science = Apple & computing history + fossils/meteorites — NEVER video games
// Live inventory only (no public sold archive): the crawl returns the CURRENT
// live set; the merge step promotes tracked lots to sold when their auction
// flips 'Completed' (Ray IS the archive) and evicts genuinely delisted stock.
const GOLDIN_API_V2 = 'https://d1wu47wucybvr3.cloudfront.net/api/lots_v2';

const GOLDIN_AUCTIONS_API = 'https://d2l9s2774i83t9.cloudfront.net/api/auctions';

const GOLDIN_IMG = (lotId: string, img: string) =>
  `https://d2tt46f3mh26nl.cloudfront.net/public/Lots/${lotId}/${img}@1x`;

const GOLDIN_FACET_PASSES: { itemType: string; fallback: string | null }[] = [
  { itemType: 'Game-Used Memorabilia', fallback: 'game-used' },
  { itemType: 'Tickets and Passes', fallback: 'tickets-passes' },
  { itemType: 'Awards and Trophies', fallback: 'trophies-awards' },
  { itemType: 'Memorabilia', fallback: null }, // mixed — router only
];

// (wave 2) the item-type facet's sports fallback is trusted only for a lot
// with no music / film / TV reading (classify.ts goldinNonSportFix — the same
// rule corpus-normalize re-applies): a sealed Beatles LP in the Game-Used
// facet is not game-used. Returns the culture slug, or null to drop.
// (Oct 8 sports audit) + the sale name (a Thematic-auction lot is sports only
// on sports evidence) and the trophy-facet photo / ticket fix (E2/E3).
function facetArtist(artist: string | null, title: string, saleName = ''): string | null {
  if (!artist) return null;
  const to = goldinNonSportFix({ artist, title, auctionHouse: 'Goldin', saleName });
  if (to === DROP) return null;
  if (to) return to;
  return trophyIsTicketOrPhoto({ artist, title, auctionHouse: 'Goldin' }) ?? artist;
}

const GOLDIN_SCIENCE_QUERIES = ['apple computer', 'macintosh', 'steve jobs', 'fossil', 'meteorite', 'dinosaur', 'amber'];

// RESULTS ARCHIVE — the buy page's `show_only:'Sold'` filter serves Goldin's
// full sold history with realized prices (verified: Ohtani 50th-HR ball
// current_price $3.6M × 1.22 premium = the $4.39M widely reported). These are
// permanent facts; we pull them into lots.json as sold records. Game-Used and
// Tickets are the clean, card-free sport buckets (~13k sold combined);
// 'Awards and Trophies' returns 0 sold and 'Memorabilia' is 34k card-heavy —
// both left to the live pass + router until they earn a dedicated gate.
const GOLDIN_SOLD_PASSES: { label: string; scope: Record<string, unknown>; fallback: string | null; sportScoped?: boolean }[] = [
  // sport OBJECTS — these buckets are small enough that Ending_Soonest's tail
  // window (from ≈ total-500) stays under the 10k Algolia cap. sportScoped so a
  // game-used relic card still routes game-used, not dropped.
  { label: 'Game-Used', scope: { item_type: ['Game-Used Memorabilia'], category: ['Sport'] }, fallback: 'game-used', sportScoped: true },
  { label: 'Tickets', scope: { item_type: ['Tickets and Passes'], category: ['Sport'] }, fallback: 'tickets-passes', sportScoped: true },
  // sold CARDS are NOT pulled here: at 348k the newest closes sit past the 10k
  // cap (Ending_Soonest tail unreachable). Instead the live Sport pass tracks
  // upcoming cards and the Completed-flip promotes them to sold — so the card
  // archive grows nightly — while the one-time backfill seeds the history.
  // science: NASA/space + Apple/computing (Collin's science sold sources)
  { label: 'NASA', scope: { sub_category: ['NASA'], category: ['Non-Sport'] }, fallback: 'space-exploration' },
  { label: 'iPhone', scope: { item_type: ['iPhone'], category: ['Non-Sport'] }, fallback: 'scientific-instruments' },
  { label: 'Apple', scope: { item_type: ['Apple'], category: ['Non-Sport'] }, fallback: 'scientific-instruments' },
];

async function goldinQuery(body: object): Promise<{ lots: any[]; total: number }> {
  const res = await fetchWithRetry(GOLDIN_API_V2, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ search: { queryType: 'Featured', hasAnalyticsConsent: false, ...body } }),
    timeoutMs: 25000,
  });
  // a 5xx/403 HTML body must throw here, not half-parse — the callers treat a
  // failed page as an INCOMPLETE feed (goldinFeedComplete=false), never as
  // "these lots are gone".
  if (!res.ok) throw new Error(`Goldin lots_v2 HTTP ${res.status}`);
  noteFetched('goldin');
  const j = await res.json() as any;
  return { lots: j?.searchalgolia?.lots || [], total: j?.searchalgolia?.total || 0 };
}

// Goldin's live index purges each lot the instant its auction closes, but the
// buy page's show_only:'Sold' filter serves the full realized-price archive
// (see GOLDIN_SOLD_PASSES) — that is the primary sold source. This set carries
// the completed-auction ids to the merge as a SAME-CRAWL FALLBACK only, for the
// freshest closes not yet in the sold index.
export let goldinCompletedAuctions = new Set<string>();

// True only when the auctions-status fetch succeeded this run. When false the
// merge must NOT touch tracked Goldin lots at all — with an empty Completed set
// every closed lot would look "delisted" and be evicted, permanently destroying
// the sold archive over one transient network error (Ray IS the archive).
export let goldinStatusOk = false;

// True only when every facet/keyword pass enumerated fully. A failed page
// truncates freshGoldinIds — absence from a partial feed is UNKNOWN, not
// delisted, so eviction is skipped for the run when this is false.
export let goldinFeedComplete = true;

/** a close timestamp more than 5 years out is a house placeholder (Goldin
 *  uses 2050-01-01 for lots not yet slotted into an auction), never a date */
export function isPlaceholderClose(ts: string): boolean {
  const t = Date.parse(ts);
  if (isNaN(t)) return true;
  return t > Date.now() + 5 * 365 * 86_400_000;
}

/**
 * The §3b sold-sweep window over Completed auctions' end_timestamp.
 *   default (nightly): the last RAY_GOLDIN_SWEEP_DAYS days (21).
 *   backfill:          RAY_GOLDIN_SWEEP_FROM=YYYY-MM-DD (inclusive) and/or
 *                      RAY_GOLDIN_SWEEP_TO=YYYY-MM-DD (exclusive) — a fixed
 *                      date slice of Goldin's per-auction sold history (the
 *                      auctions API lists Completed auctions back to 2012),
 *                      so .github/workflows/backfill-goldin.yml can walk
 *                      2019–22 one bounded slice per dispatch.
 * Throws on a malformed date — a typo must fail the run, not sweep everything.
 */
export function goldinSweepWindow(env: Record<string, string | undefined> = process.env, now = Date.now()): { fromMs: number; toMs: number; label: string } {
  const day = (k: string): number | null => {
    const v = (env[k] || '').trim();
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(`${v}T00:00:00Z`))) throw new Error(`${k} must be YYYY-MM-DD (got '${v}')`);
    return Date.parse(`${v}T00:00:00Z`);
  };
  const from = day('RAY_GOLDIN_SWEEP_FROM'), to = day('RAY_GOLDIN_SWEEP_TO');
  if (from === null && to === null) {
    const days = parseInt(env.RAY_GOLDIN_SWEEP_DAYS || '21', 10);
    return { fromMs: now - days * 86_400_000, toMs: Infinity, label: `≤${days}d` };
  }
  const fromMs = from ?? 0, toMs = to ?? Infinity;
  if (fromMs >= toMs) throw new Error(`empty Goldin sweep window: RAY_GOLDIN_SWEEP_FROM ${env.RAY_GOLDIN_SWEEP_FROM} ≥ RAY_GOLDIN_SWEEP_TO ${env.RAY_GOLDIN_SWEEP_TO}`);
  return { fromMs, toMs, label: `${env.RAY_GOLDIN_SWEEP_FROM || 'start'} → ${env.RAY_GOLDIN_SWEEP_TO || 'now'}` };
}

export async function crawlGoldin(): Promise<AuctionLot[]> {
  const byId = new Map<string, AuctionLot>();
  // BACKFILL MODE (RAY_GOLDIN_SWEEP_ONLY=1, backfill-goldin.yml): run ONLY the
  // §3b per-auction sold sweep over the RAY_GOLDIN_SWEEP_FROM/TO slice. The
  // live passes and the archive tail are skipped, so the feed is NOT
  // enumerated (goldinFeedComplete=false → the merge evicts nothing) and the
  // status fetch does not arm promotion (goldinStatusOk stays false → no
  // tracked lot is promoted/evicted by a backfill). Sold rows only.
  const sweepOnly = process.env.RAY_GOLDIN_SWEEP_ONLY === '1';
  const sweepWindow = goldinSweepWindow(); // validate up front — a bad date fails before any fetch
  if (sweepOnly) {
    goldinFeedComplete = false;
    console.log(`  [Goldin] SWEEP-ONLY backfill: per-auction sold sweep over ${sweepWindow.label}; live passes + archive tail skipped`);
  }
  if (!sweepOnly) console.log('  [Goldin] Fetching live auction lots (facet-driven: objects, never cards)...');
  let dropped = 0;
  // Title-cleaner from the comps lib — strips a leaked-note prefix and the
  // "Month DD, YYYY - " / "YYYY-YY - " date prefixes Goldin titles carry, so
  // the stored title is the object, not the annotation. Imported here (not at
  // module scope) to match the dynamic-import pattern the classification pass
  // already uses for comps.
  const { cleanGoldinTitle } = await import('../../../app/lib/comps');

  // ingest LIVE inventory only (upcoming, with the running bid + its auction id).
  // There is no ended branch on the live feed — sold is decided at merge time,
  // strictly from the auction's own 'Completed' status, never a timestamp or bid.
  // A live bid is NEVER a sale: Goldin's clock crosses end_timestamp BEFORE
  // extended bidding resolves, and its lot-level `status` field lies (always
  // "Live"), so sold is never inferred here from a timestamp or a bid.
  const ingest = (lot: any, fallback: string | null, sportScoped = false, cultureScoped = false) => {
    // REQUIRED-field gate: lot_id keys the record; title is the identity text.
    if (!lot.lot_id) { parseDrop('goldin', 'missing lot_id', String(lot.title || '').slice(0, 80)); return; }
    if (!lot.title) { parseDrop('goldin', 'missing title', `lot ${lot.lot_id}`); return; }
    const t = lot.title.toLowerCase();
    if (GOLDIN_LEAK_NOTE.test(lot.title)) { dropped++; return; }
    // culture-scoped (Goldin's Pop-Culture/Entertainment/Rock-N-Roll/History
    // sub-categories): route via routeCulture (drops mass/graded, keeps the 1/1
    // artifacts). Otherwise sport-scoped or plain object routing.
    // sport-scoped (category:['Sport']) passes KEEP cards → sports-cards; only
    // unscoped passes hard-drop cards (they could be Non-Sport/Pokémon).
    if (!cultureScoped && (GOLDIN_EXCLUDE_GAMES.test(t) || GOLDIN_EXCLUDE_MISC.test(t) || (!sportScoped && GOLDIN_CARD_MAKERS.test(t) && !GOLDIN_POKEMON.test(t)))) { dropped++; return; }
    // culture-scoped lots get a SCIENCE pre-check before routeCulture: Goldin
    // files Jobs/Wozniak cuts and Apple hardware under Pop Culture, but the
    // product's home for computing/space is the science vertical (Collin,
    // Aug 14 — 26 Jobs cuts were sitting in entertainment-memorabilia).
    const sciRoute = cultureScoped ? goldinRoute(lot.title) : null;
    const SCI_SLUGS_SET = ['space-exploration', 'scientific-instruments', 'meteorites', 'fossils'];
    const routed = cultureScoped
      ? (GOLDIN_POKEMON.test(t) && !GOLDIN_EXCLUDE_GAMES.test(t) ? 'pokemon'
        : sciRoute && SCI_SLUGS_SET.includes(sciRoute) ? sciRoute
        : routeCulture(lot.title))
      : goldinRoute(lot.title, sportScoped);
    // 'blocked' is a hard exclusion (slab with no object signal, etc.) — the
    // facet fallback must never resurrect it, or graded cards ride the
    // Tickets/Game-Used facets straight into the sports vertical.
    if (routed === 'blocked') { dropped++; return; }
    const artist = facetArtist(routed || fallback, lot.title, lot.auction_type ? `Goldin ${lot.auction_type} Auction` : '');
    if (!artist) { dropped++; return; }
    const rawEnd = lot.end_timestamp || lot.start_timestamp;
    if (!rawEnd) return;
    // Goldin parks not-yet-scheduled lots on a far-future placeholder close
    // (2050-01-01 — 9 live lots on Sep 27 2026). That is "no date yet", not a
    // 2050 sale: carry the lot UNDATED (no saleDate/saleDateTime, flagged
    // datePrecision:'unknown') instead of minting a 24-years-out close.
    const undated = isPlaceholderClose(rawEnd);
    const end = undated ? '' : rawEnd;
    const bp = lot.buyer_premium || 22;
    const bid = lot.current_price || 0;

    if (byId.has(lot.lot_id)) return;
    if (lot.status && lot.status !== 'Live' && lot.status !== 'Preview') return;
    // A lot whose end has passed but that Goldin still SERVES is in extended
    // bidding / awaiting its auction's 'Completed' flip — keep tracking it as
    // upcoming (with its latest bid). Dropping it here would keep it out of
    // freshGoldinIds and the merge would evict it as delisted, losing the
    // hammer forever. The Completed flip decides its fate, nothing else.
    byId.set(lot.lot_id, {
      id: `goldin-${lot.lot_id}`,
      artist,
      title: cleanGoldinTitle(lot.title),
      year: null, medium: null, dimensions: null,
      category: 'object',
      imageUrl: lot.primary_image_name ? GOLDIN_IMG(lot.lot_id, lot.primary_image_name) : null,
      auctionHouse: 'Goldin',
      saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
      // born-v2: saleDate is the canonical bare YYYY-MM-DD (invariant 7) — the
      // ET sale night (lib/sale-day), not the UTC day of a 10 PM ET close; the
      // full close timestamp is retained on saleDateTime.
      saleDate: saleDayOf('Goldin', end) || (end || '').split('T')[0],
      saleDateTime: end || null,
      ...(undated ? { datePrecision: 'unknown' } : {}),
      lotNumber: lot.lot_number || null,
      // v2 money: a live lot is NOT sold — all price fields null (a live bid is
      // never a sale). currentBid carries the running bid; buyerPremiumPct is
      // stamped so a later promotion can gross it to realized.
      ...stampMoney({
        isSold: false,
        nativeCurrency: 'USD',
        saleDate: saleDayOf('Goldin', end) || (end || '').split('T')[0] || null,
        hammerNative: null,
        premiumNative: null,
        estLowNative: null,
        estHighNative: null,
        priceBasis: 'final-bid-plus-bp',
        buyerPremiumPct: bp,
      }),
      status: 'upcoming',
      url: lot.meta_slug ? `https://goldin.co/item/${lot.meta_slug}` : 'https://goldin.co',
      currentBid: bid,
      bidCount: lot.number_of_bids || 0,
      buyerPremium: bp,
      auctionId: lot.auction_id || undefined, // app type: string | undefined, never null
    } as unknown as AuctionLot);
  };

  // ingest a SOLD result (show_only:'Sold') — a permanent record at the
  // realized price (winning bid + buyer's premium). Same gates as live; a
  // zero-price row is unusable and skipped. Returns true when it logged one.
  const ingestSold = (lot: any, fallback: string | null, sportScoped = false): boolean => {
    // REQUIRED-field gate (same as ingest).
    if (!lot.lot_id) { parseDrop('goldin', 'missing lot_id (sold)', String(lot.title || '').slice(0, 80)); return false; }
    if (!lot.title) { parseDrop('goldin', 'missing title (sold)', `lot ${lot.lot_id}`); return false; }
    if (byId.has(lot.lot_id)) return false; // live pass or an earlier sold row won
    const t = lot.title.toLowerCase();
    if (GOLDIN_LEAK_NOTE.test(lot.title)) { dropped++; return false; }
    if (GOLDIN_EXCLUDE_GAMES.test(t) || GOLDIN_EXCLUDE_MISC.test(t) || (!sportScoped && GOLDIN_CARD_MAKERS.test(t) && !GOLDIN_POKEMON.test(t))) { dropped++; return false; }
    const routed = goldinRoute(lot.title, sportScoped);
    if (routed === 'blocked') { dropped++; return false; }
    const artist = facetArtist(routed || fallback, lot.title, lot.auction_type ? `Goldin ${lot.auction_type} Auction` : '');
    if (!artist) { dropped++; return false; }
    const bid = lot.current_price || 0;
    if (bid <= 0) return false;
    const bp = lot.buyer_premium || 22;
    const end = lot.end_timestamp || lot.start_timestamp;
    // Drop phantom future closes (a Goldin sold row dated 2050-01-01 slips
    // through the archive feed). A "sold" record whose saleDate is more than a
    // month out is bad data, not a realized sale — it would otherwise wear a
    // fabricated "current quarter" in the realized series.
    const endMs = new Date(end).getTime();
    if (!isNaN(endMs) && endMs > Date.now() + 30 * 24 * 60 * 60 * 1000) { dropped++; return false; }
    byId.set(lot.lot_id, {
      id: `goldin-${lot.lot_id}`,
      artist,
      title: cleanGoldinTitle(lot.title),
      year: null, medium: null, dimensions: null,
      category: 'object',
      imageUrl: lot.primary_image_name ? GOLDIN_IMG(lot.lot_id, lot.primary_image_name) : null,
      auctionHouse: 'Goldin',
      saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
      // born-v2: canonical bare YYYY-MM-DD saleDate (the ET sale night, lib/sale-day);
      // full timestamp on saleDateTime.
      saleDate: saleDayOf('Goldin', end) || (end || '').split('T')[0],
      saleDateTime: end || null,
      lotNumber: lot.lot_number || null,
      // v2 money: hammer = the winning bid; realized = hammer + buyer's premium.
      // Goldin is USD; basis 'final-bid-plus-bp'. estimates: none (bid auction).
      ...stampMoney({
        isSold: true,
        nativeCurrency: 'USD',
        saleDate: saleDayOf('Goldin', end) || (end || '').split('T')[0] || null,
        hammerNative: bid,
        premiumNative: Math.round(bid * (1 + bp / 100)),
        estLowNative: null,
        estHighNative: null,
        priceBasis: 'final-bid-plus-bp',
        buyerPremiumPct: bp,
      }),
      status: 'sold',
      url: lot.meta_slug ? `https://goldin.co/item/${lot.meta_slug}` : 'https://goldin.co',
      currentBid: bid,
      bidCount: lot.number_of_bids || 0,
      buyerPremium: bp,
      auctionId: lot.auction_id || undefined,
    } as unknown as AuctionLot);
    return true;
  };

  // (sections 1–2 are skipped in SWEEP-ONLY backfill mode — see the top)
  let soldLogged = 0;
  if (!sweepOnly) {
    // 1 · LIVE inventory — object facets + science keyword passes. A failed or
    // capped page marks the whole feed incomplete: the merge must never read
    // "absent from a partial fetch" as "delisted".
    for (const pass of GOLDIN_FACET_PASSES) {
      let from = 0, total = Infinity;
      const CAP = 3000; // headroom for flagship events; today's facets run ~30-160
      while (from < Math.min(total, CAP)) {
        try {
          const { lots, total: t } = await goldinQuery({ item_type: [pass.itemType], size: 100, from });
          total = t;
          if (!lots.length) break;
          lots.forEach((l: any) => ingest(l, pass.fallback));
          from += 100;
          await sleep(400);
        } catch (e) {
          console.log(`  [Goldin] facet '${pass.itemType}' truncated at ${from}:`, e);
          goldinFeedComplete = false;
          break;
        }
      }
      if (from < Math.min(total, CAP)) goldinFeedComplete = false; // early exit (empty page mid-pagination) ≠ enumerated
      if (Number.isFinite(total) && total > CAP) goldinFeedComplete = false; // windowed, not enumerated
      if (Number.isFinite(total)) noteExpected('goldin', Math.min(total, CAP)); // health: facet's own count
    }
    // 1a · LIVE SPORT CARDS — the whole live Sport book (category:['Sport'],
    // which is Goldin's own line: Non-Sport/Pokémon is a separate category we
    // never touch). sportScoped ingest routes cards → sports-cards, objects →
    // their slugs. ~3.5k live lots; capped generously. This is the on-the-block
    // + ⌘K-searchable card feed; the 348k SOLD history is the one-time backfill.
    {
      let from = 0, total = Infinity;
      const CAP = 8000;
      while (from < Math.min(total, CAP)) {
        try {
          const { lots, total: t } = await goldinQuery({ queryType: 'Featured', category: ['Sport'], size: 100, from });
          total = t;
          if (!lots.length) break;
          lots.forEach((l: any) => ingest(l, 'sports-cards', true));
          from += 100;
          await sleep(400);
        } catch (e) {
          console.log(`  [Goldin] live Sport pass truncated at ${from}:`, e);
          goldinFeedComplete = false;
          break;
        }
      }
      if (from < Math.min(total, CAP)) goldinFeedComplete = false; // early exit (empty page mid-pagination) ≠ enumerated
      if (Number.isFinite(total) && total > CAP) goldinFeedComplete = false;
      if (Number.isFinite(total)) noteExpected('goldin', Math.min(total, CAP)); // health: facet's own count
      console.log(`  [Goldin] live Sport pass: ${Math.min(total, CAP)} lots enumerated`);
    }
    // 1a-culture · LIVE POP CULTURE — Goldin's curated Non-Sport sub-categories
    // (Pop Culture/Entertainment, Rock N' Roll, History): the high-end 1/1
    // artifacts. cultureScoped ingest drops mass/graded (comics/cards/games/VHS/
    // vinyl/toys/posters) via routeCulture and routes the rest to culture slugs.
    {
      let from = 0, total = Infinity;
      const CAP = 8000;
      while (from < Math.min(total, CAP)) {
        try {
          const { lots, total: t } = await goldinQuery({ queryType: 'Featured', category: ['Non-Sport'], sub_category: ['Pop Culture/Entertainment', "Rock N' Roll", 'History'], size: 100, from });
          total = t;
          if (!lots.length) break;
          lots.forEach((l: any) => ingest(l, null, false, true));
          from += 100;
          await sleep(400);
        } catch (e) {
          console.log(`  [Goldin] live Culture pass truncated at ${from}:`, e);
          goldinFeedComplete = false;
          break;
        }
      }
      if (from < Math.min(total, CAP)) goldinFeedComplete = false; // early exit (empty page mid-pagination) ≠ enumerated
      if (Number.isFinite(total) && total > CAP) goldinFeedComplete = false;
      if (Number.isFinite(total)) noteExpected('goldin', Math.min(total, CAP)); // health: facet's own count
      console.log(`  [Goldin] live Culture pass: ${Math.min(total, CAP)} lots enumerated`);
    }
    // 1a-pokemon · LIVE POKÉMON — the one allowlisted Non-Sport TCG line
    // (category:['Non-Sport'], sub_category:['Pokemon'] — Goldin's own facet, so
    // the query scope IS the identity). Routes to the 'pokemon' culture slug;
    // the 40k sold history is the one-time backfill (backfill-goldin-pokemon),
    // the nightly Completed-flip + §3b sweep grow it — same doctrine as cards.
    {
      let from = 0, total = Infinity;
      const CAP = 3000; // live Pokémon runs ~950 today; headroom for TCG Elite weeks
      while (from < Math.min(total, CAP)) {
        try {
          const { lots, total: t } = await goldinQuery({ queryType: 'Featured', category: ['Non-Sport'], sub_category: ['Pokemon'], size: 100, from });
          total = t;
          if (!lots.length) break;
          lots.forEach((l: any) => ingest(l, 'pokemon'));
          from += 100;
          await sleep(400);
        } catch (e) {
          console.log(`  [Goldin] live Pokémon pass truncated at ${from}:`, e);
          goldinFeedComplete = false;
          break;
        }
      }
      if (from < Math.min(total, CAP)) goldinFeedComplete = false; // early exit ≠ enumerated
      if (Number.isFinite(total) && total > CAP) goldinFeedComplete = false;
      if (Number.isFinite(total)) noteExpected('goldin', Math.min(total, CAP));
      console.log(`  [Goldin] live Pokémon pass: ${Math.min(total, CAP)} lots enumerated`);
    }
    // 1b · AUCTION-AWARE LIVE PASS — newly launched flagship auctions (e.g.
    // "2026 Summer Game Used Memorabilia Auction") can go Active with their
    // lots carrying NO item_type facet yet, so the facet passes above miss the
    // entire event (581 live lots invisible, verified Jul 2026). Enumerate
    // Active object auctions by NAME from the auctions API and ingest their
    // lots by auction_id through the SAME per-lot gates — the router still
    // decides every lot (cards/slabs still drop), so a mixed auction is safe.
    try {
      const aRes = await fetchWithRetry(GOLDIN_AUCTIONS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ status: 'All', order: 'desc' }),
        timeoutMs: 25000,
      });
      if (aRes.ok) {
        const auctions = ((await aRes.json() as any).auctions || []) as any[];
        const objectAuctions = auctions.filter(a =>
          a.status === 'Active'
          && /\b(game.used|memorabilia|jersey|sneaker)\b/i.test(a.name || a.title || '')
          && !/\b(tcg|card|pok[eé]mon|comic|box break)\b/i.test(a.name || a.title || ''));
        for (const a of objectAuctions) {
          let from = 0, total = Infinity;
          while (from < Math.min(total, 3000)) {
            const { lots, total: t } = await goldinQuery({ auction_id: [a.auction_id], size: 100, from });
            total = t;
            if (!lots.length) break;
            // (Oct 8 sports audit, E1) an auction NAMED "memorabilia" is not a
            // sports auction: Goldin's Thematic auctions (animation cels,
            // Madonna backstage passes, RIAA awards, Bob Hope studio photos —
            // ~410 live) fell back to game-used here. Sports only on sports
            // evidence; everything else takes the culture route.
            lots.forEach((l: any) => (hasSportsTitleEvidence(String(l.title || ''))
              ? ingest(l, 'game-used')
              : ingest(l, null, false, true)));
            from += 100;
            await sleep(400);
          }
          console.log(`  [Goldin] auction pass '${(a.name || '').slice(0, 48)}': ${Math.min(total, 3000)} lots enumerated`);
        }
      }
    } catch (e) {
      console.log('  [Goldin] auction-aware live pass failed:', e);
      goldinFeedComplete = false;
    }

    for (const q of GOLDIN_SCIENCE_QUERIES) {
      try {
        const { lots } = await goldinQuery({ searchTerm: q, size: 100, from: 0 });
        lots.forEach((l: any) => ingest(l, null));
        await sleep(400);
      } catch (e) {
        console.log(`  [Goldin] science query '${q}' failed:`, e);
        goldinFeedComplete = false;
      }
    }

    // 2 · RESULTS ARCHIVE — show_only:'Sold' serves the full sold history with
    // realized prices. Sold rows are permanent, so we pull DEEP once (the whole
    // history) and a tail window daily. `Ending_Soonest` sorts oldest→newest, so
    // the freshest closes sit at the tail (from ≈ total); the daily window reads
    // just those. Skipping any lot already in byId keeps the live pass's own
    // records authoritative.
    for (const pass of GOLDIN_SOLD_PASSES) {
      try {
        const scope = { queryType: 'Ending_Soonest', show_only: 'Sold', ...pass.scope };
        const head = await goldinQuery({ ...scope, size: 1, from: 0 });
        const total = head.total;
        const windowN = DEEP ? total : 500; // daily: the last ~500 closes; DEEP: all of it
        const start = Math.max(0, total - windowN);
        for (let from = start; from < total; from += 100) {
          const { lots } = await goldinQuery({ ...scope, size: 100, from });
          if (!lots.length) break;
          for (const l of lots) if (ingestSold(l, pass.fallback, pass.sportScoped)) soldLogged++;
          await sleep(400);
        }
      } catch (e) {
        console.log(`  [Goldin] sold '${pass.label}' pass failed:`, e);
      }
    }
    console.log(`  [Goldin] results archive: ${soldLogged} sold lots logged (${DEEP ? 'DEEP full-history' : 'daily tail window'})`);
  }

  // 3 · COMPLETION — a same-crawl fallback for the very freshest closes that
  // haven't hit the sold index yet: record which auctions Goldin marks
  // 'Completed' so the merge can promote a still-tracked lot's LAST bid to a
  // sold record. The results archive above is the primary, authoritative source
  // (true realized price); this only catches the tail between a lot's auction
  // closing and its appearance under show_only:'Sold'. Never a bid on an open lot.
  try {
    const aRes = await fetchWithRetry(GOLDIN_AUCTIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ status: 'All', order: 'desc' }),
      timeoutMs: 25000,
    });
    if (!aRes.ok) throw new Error(`Goldin auctions HTTP ${aRes.status}`);
    const auctions = (await aRes.json() as any).auctions || [];
    goldinCompletedAuctions = new Set<string>(
      auctions.filter((a: any) => a.status === 'Completed').map((a: any) => a.auction_id)
    );
    goldinStatusOk = !sweepOnly; // only a verified fetch may drive promotion/eviction (never a backfill)
    console.log(`  [Goldin] ${goldinCompletedAuctions.size} auctions marked Completed (promotion source)`);

    // 3b · RECENT-CLOSE SOLD SWEEP — the authoritative price CORRECTION pass.
    // Promotion (below) stamps a closed lot with its LAST-TRACKED bid, but
    // Goldin's endgame (extended bidding) happens after our last snapshot, so
    // promoted prices run systematically low — and the global sold-index tail
    // above can't reach cards at all (10k pagination cap over a 348k history).
    // Per-AUCTION sold queries stay far under the cap (an auction is ≤ a few
    // thousand lots), so: for every auction completed in the last N days,
    // re-pull its full sold list — true final prices — and ingest. The merge's
    // fresh-wins overwrite then corrects any promoted placeholder, cards
    // included. N via RAY_GOLDIN_SWEEP_DAYS (default 21 — Goldin indexes sold
    // results within ~2 days; 21 is a wide safety net at ~2min of API time).
    // RAY_GOLDIN_SWEEP_FROM/TO replace the rolling window with a fixed date
    // slice (backfill) — see goldinSweepWindow.
    const recentDone = auctions.filter((a: any) => {
      if (a.status !== 'Completed' || !a.auction_id) return false;
      const end = new Date(a.end_timestamp || 0).getTime();
      return !isNaN(end) && end >= sweepWindow.fromMs && end < sweepWindow.toMs;
    });
    // nightly: 6000 lots/auction (headroom over a monthly). Backfill: up to
    // the 10k Algolia window — an auction past it is logged as truncated.
    const PER_AUCTION_CAP = sweepOnly ? 10_000 : 6000;
    let sweptSold = 0;
    for (const a of recentDone) {
      try {
        let from = 0, total = Infinity, got = 0;
        while (from < Math.min(total, PER_AUCTION_CAP)) {
          const { lots, total: t } = await goldinQuery({ queryType: 'Ending_Soonest', show_only: 'Sold', auction_id: [a.auction_id], size: 100, from });
          total = t;
          if (!lots.length) break;
          for (const l of lots) if (ingestSold(l, null, true)) { sweptSold++; got++; }
          from += 100;
          await sleep(400);
        }
        if (Number.isFinite(total) && total > PER_AUCTION_CAP) console.log(`  [Goldin] sold sweep '${(a.title || '').slice(0, 40)}' TRUNCATED: ${total} sold > ${PER_AUCTION_CAP} reachable`);
        if (sweepOnly) console.log(`  [Goldin] sold sweep ${(a.end_timestamp || '').slice(0, 10)} '${(a.title || '').slice(0, 48)}': ${Number.isFinite(total) ? total : 0} sold listed, ${got} ingested`);
      } catch (e) {
        console.log(`  [Goldin] sold sweep '${(a.title || '').slice(0, 40)}' failed:`, e);
        // a backfill STOPS on the first failed auction (a WAF/403/5xx wall is
        // never retried around) — the crash leaves the segment unwritten
        if (sweepOnly) throw e;
      }
    }
    console.log(`  [Goldin] recent-close sold sweep: ${recentDone.length} auctions (${sweepWindow.label}), ${sweptSold} sold lots ingested`);
  } catch (e) {
    // Leave goldinStatusOk false: the merge skips the whole promotion/eviction
    // pass and tracked lots simply wait for the next run — nothing is lost by
    // waiting, everything is lost by evicting on an empty Completed set.
    console.log('  [Goldin] auction-status fetch FAILED — promotion/eviction deferred to next run:', e);
    if (sweepOnly) throw e; // backfill: no partial slice is written
  }

  const goldinSold = Array.from(byId.values()).filter(l => l.status === 'sold').length;
  console.log(`  [Goldin] ${byId.size} lots kept — ${byId.size - goldinSold} live, ${goldinSold} sold results (${dropped} gated out)`);
  return Array.from(byId.values());
}
