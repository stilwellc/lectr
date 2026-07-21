/**
 * backfill-goldin-sports.ts — the one-time historical pull of Goldin's SOLD
 * Sport archive (cards + objects), ~348k lots. Collin's mandate: all Goldin
 * sport items INCLUDING sport cards, never Non-Sport (Pokémon/TCG). Goldin's
 * own `category:['Sport']` filter IS that line — Non-Sport is a separate 109k
 * bucket — so this scopes every query to Sport and never sees a Pokémon card.
 *
 * The lots_v2 Algolia index caps pagination at from+size ≤ 10,000, and the
 * whole Sport archive is 348k, so we shard two ways and dedupe by lot_id:
 *   1. AUCTION ENUMERATION — the auctions API lists completed auctions; each
 *      auction's Sport-sold set is bounded (<5k), so we page each fully. Covers
 *      ~310k (the auctions still listed).
 *   2. SUB-CATEGORY BACKSTOP — for the ~38k in auctions Goldin no longer lists,
 *      each sport (Baseball/Basketball/…) is walked OLDEST-first up to the 10k
 *      cap, catching the old tail the auction list dropped.
 *
 * Routing (sport-scoped): game-used / trophies / tickets by object signal, else
 * sports-cards. SOLD rows are permanent facts (winning bid + buyer's premium).
 * These are a CORPUS/DATA asset — they land in sold-archive.json.gz for the
 * engine and the ~500k-lot goal, but build-market keeps them out of the client
 * payload AND the Supabase mirror (they'd balloon both). Never deletes rows.
 *
 * Run: npx tsx scripts/backfill-goldin-sports.ts   (RESUMABLE via the id cache)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { AuctionLot, Currency } from '../app/types';
import { sportOf } from '../app/utils';

const LOTS_API = 'https://d1wu47wucybvr3.cloudfront.net/api/lots_v2';
const AUCTIONS_API = 'https://d2l9s2774i83t9.cloudfront.net/api/auctions';
const IMG = (lotId: string, img: string) => `https://d2tt46f3mh26nl.cloudfront.net/public/Lots/${lotId}/${img}@1x`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const PAGE = 100;
const CAP = 10000; // Algolia from+size hard cap
const SUB_CATEGORIES = ['Baseball', 'Basketball', 'Football', 'Hockey', 'Soccer', 'Boxing', 'Golf', 'Tennis', 'Wrestling', 'Racing', 'Olympics', 'Multi-Sport', 'Other Sports'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── sport-scoped router (mirrors ray-crawl goldinRoute, sportScoped=true) ────
const GAME_USED = /\b(game[- ](used|worn|issued)|match[- ](used|worn)|player[- ]worn|team[- ]issued|fight[- ]worn|tour[- ](used|worn)|warm[- ]?up[- ]worn|practice[- ]worn|game bat|game ball|photo[- ]?match(ed)?|mears\b)\b/i;
const TROPHY = /\b(trophy|award|championship ring|title belt|winners? medal|olympic medal|plaque|mvp\b|heisman|hall of fame ring|championship pendant)\b/i;
const TICKET = /\b(tickets?\b|stub|full ticket|season pass|press pass|credential|all[- ]access pass)\b/i;
const EXCLUDE = /\b(video game|nintendo|playstation|\bps[1-5]\b|xbox|sega|atari|game ?boy|wata|vga\b|do not list|per shaneeza|per wagner)\b/i;

function routeSport(title: string): string {
  const t = title.toLowerCase();
  if (GAME_USED.test(t)) return 'game-used';
  if (TROPHY.test(t)) return 'trophies-awards';
  if (TICKET.test(t)) return 'tickets-passes';
  return 'sports-cards'; // a Sport lot with no object signal is a card
}

/** cleanGoldinTitle equivalent — strip the "Month DD, YYYY - " / "YYYY-YY - "
 *  date prefixes Goldin titles carry, so the stored title is the item. */
function cleanTitle(t: string): string {
  return t
    .replace(/^\s*(?:do not list[^-]*-\s*)?/i, '')
    .replace(/^\s*(?:[A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}|\d{4})\s*-\s*/i, '')
    .trim();
}

async function post(url: string, body: object): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const query = (scope: object) => post(LOTS_API, { search: { queryType: 'Ending_Soonest', show_only: 'Sold', category: ['Sport'], hasAnalyticsConsent: false, ...scope } });

/* ── build a v2 sold-card row (lean — cards carry no dims/edition/medium) ──── */
function cardRow(lot: any): AuctionLot | null {
  if (!lot.title || !lot.lot_id) return null;
  const title = cleanTitle(lot.title);
  if (!title || EXCLUDE.test(title.toLowerCase())) return null;
  const bid = lot.current_price || 0;
  if (!(bid > 0)) return null;
  const end: string = lot.end_timestamp || lot.start_timestamp || '';
  const endMs = new Date(end).getTime();
  if (!isNaN(endMs) && endMs > Date.now() + 30 * 864e5) return null; // phantom future close
  const bp = lot.buyer_premium || 20;
  const premium = Math.round(bid * (1 + bp / 100));
  const artist = routeSport(title);
  const saleDay = end.split('T')[0] || null;
  return {
    id: `goldin-${lot.lot_id}`,
    artist,
    title,
    year: null, medium: null, dimensions: null, description: null,
    category: 'object',
    imageUrl: lot.primary_image_name ? IMG(lot.lot_id, lot.primary_image_name) : null,
    auctionHouse: 'Goldin',
    saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
    saleDate: saleDay,
    saleDateTime: end || null,
    lotNumber: lot.lot_number || null,
    // v2 money: hammer = winning bid, realized = +buyer's premium; no estimates.
    nativeCurrency: 'USD' as Currency,
    hammerNative: bid, premiumNative: premium, realizedNative: premium,
    buyerPremiumPct: bp, fxRate: 1, fxAsOf: saleDay,
    hammerUsd: bid, premiumUsd: premium, realizedUsd: premium,
    estLowNative: null, estHighNative: null, estLowUsd: null, estHighUsd: null,
    priceBasis: 'final-bid-plus-bp',
    currency: 'USD' as Currency, estimateLow: null, estimateHigh: null,
    hammerPrice: bid, premiumPrice: premium, priceUsd: premium,
    status: 'sold' as any,
    url: lot.meta_slug ? `https://goldin.co/item/${lot.meta_slug}` : 'https://goldin.co',
    currentBid: bid, bidCount: lot.number_of_bids || 0, buyerPremium: bp,
    auctionId: lot.auction_id || undefined,
    // lean identity: sport for the vertical filter; schema tag. Heavy v2 stamp
    // (dims/edition/tokens) is skipped — cards are a data asset, re-stampable.
    sport: sportOf(title),
    schemaVersion: 2,
  } as unknown as AuctionLot;
}

/* ── main ────────────────────────────────────────────────────────────────── */
const readGz = (f: string): Record<string, unknown>[] =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) =>
  fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));

(async () => {
  const LIMIT_AUCTIONS = parseInt(process.env.GOLDIN_LIMIT || '', 10) || Infinity;
  const MERGE_FROM = process.env.MERGE_FROM;

  // existing corpus ids — never re-add, never touch existing rows
  const lots = readGz('lots.json');
  const archive = readGz('sold-archive.json');
  const existing = new Set<string>([...lots, ...archive].map(l => String(l.id)));
  const archiveBefore = archive.length;

  // fast path: merge a previous crawl's checkpoint without re-hitting the API
  if (MERGE_FROM) {
    const cached = (JSON.parse(fs.readFileSync(MERGE_FROM, 'utf8')) as AuctionLot[])
      .filter(r => !existing.has(String(r.id)));
    for (const r of cached) archive.push(r as unknown as Record<string, unknown>);
    writeGz('sold-archive.json', archive);
    console.log(`[goldin] MERGE_FROM ${MERGE_FROM}: sold-archive ${archiveBefore} → ${archive.length} (+${cached.length})`);
    return;
  }

  const fresh = new Map<string, AuctionLot>();
  const consider = (lot: any) => {
    const id = `goldin-${lot.lot_id}`;
    if (existing.has(id) || fresh.has(id)) return;
    const row = cardRow(lot);
    if (row) fresh.set(id, row);
  };

  // 1 · auction enumeration
  console.log('[goldin] enumerating completed auctions…');
  const auctions = (await post(AUCTIONS_API, { status: 'All', order: 'desc' })).auctions || [];
  const completed = auctions.filter((a: any) => a.status === 'Completed').map((a: any) => a.auction_id).slice(0, LIMIT_AUCTIONS);
  console.log(`[goldin] ${completed.length} completed auctions to sweep`);

  let ai = 0, aWithSport = 0, capped = 0;
  for (const aid of completed) {
    ai++;
    try {
      const head = await query({ auction_id: [aid], size: 1, from: 0 });
      const total = head?.searchalgolia?.total || 0;
      if (!total) { await sleep(120); continue; }
      aWithSport++;
      if (total > CAP) capped++;
      for (let from = 0; from < Math.min(total, CAP); from += PAGE) {
        const d = await query({ auction_id: [aid], size: PAGE, from });
        const rows = d?.searchalgolia?.lots || [];
        if (!rows.length) break;
        rows.forEach(consider);
        await sleep(150);
      }
    } catch (e) { /* skip a bad auction, never fabricate */ }
    if (ai % 25 === 0) console.log(`[goldin] auctions ${ai}/${completed.length} · ${aWithSport} w/sport · ${fresh.size} new rows`);
  }
  console.log(`[goldin] auction sweep done: ${aWithSport} sport auctions, ${fresh.size} new rows (${capped} auctions hit the 10k cap)`);

  // 2 · sub-category backstop — OLDEST first, to catch lots whose auction Goldin
  //     no longer lists. queryType Ending_Soonest sorts oldest→newest, so
  //     from:0 is the oldest; we walk up to the cap per sport.
  for (const sc of SUB_CATEGORIES) {
    try {
      const head = await query({ sub_category: [sc], size: 1, from: 0 });
      const total = head?.searchalgolia?.total || 0;
      if (!total) continue;
      const before = fresh.size;
      for (let from = 0; from < Math.min(total, CAP); from += PAGE) {
        const d = await query({ sub_category: [sc], size: PAGE, from });
        const rows = d?.searchalgolia?.lots || [];
        if (!rows.length) break;
        rows.forEach(consider);
        await sleep(150);
      }
      console.log(`[goldin] sub_category '${sc}' (${total} total): +${fresh.size - before} new rows`);
    } catch (e) { console.warn(`[goldin] sub_category '${sc}' failed:`, (e as Error).message); }
  }

  const rows = Array.from(fresh.values());
  // checkpoint the crawl result BEFORE the merge — a merge failure then costs a
  // re-merge, not a 15-min re-crawl (MERGE_FROM=<path> loads this and skips the API).
  const ckpt = '/private/tmp/goldin-sold-rows.json';
  fs.writeFileSync(ckpt, JSON.stringify(rows));
  console.log(`[goldin] checkpointed ${rows.length} rows → ${ckpt}`);
  const byArtist: Record<string, number> = {};
  for (const r of rows) byArtist[r.artist] = (byArtist[r.artist] || 0) + 1;
  console.log(`\n[goldin] ${rows.length} new sold rows by slug:`, JSON.stringify(byArtist));

  if (!rows.length) { console.log('[goldin] nothing new — corpus untouched.'); return; }

  // merge into the sold-archive corpus (Goldin sold → archive; build-market's
  // isArchived puts them there anyway, and isCorpusOnly keeps them off the wire)
  // NOT push(...rows): spread blows the call stack past ~100k args. Append in a loop.
  for (const r of rows) archive.push(r as unknown as Record<string, unknown>);
  writeGz('sold-archive.json', archive);
  console.log(`[goldin] sold-archive.json.gz: ${archiveBefore} → ${archive.length} rows (+${rows.length})`);
  console.log('[goldin] done. Run build-market to re-partition + rebuild served.');
})();
