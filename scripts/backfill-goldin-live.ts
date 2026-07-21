/**
 * backfill-goldin-live.ts — pull the LIVE/upcoming Goldin Sport book (cards +
 * objects) so upcoming cards are on the block AND searchable immediately,
 * rather than waiting for the first nightly. Same category:['Sport'] scope
 * (never Non-Sport/Pokémon). Upcoming rows → main corpus (lots.json.gz), so
 * they ship to the client payload, sync to Supabase (upcoming-only), and land
 * in ⌘K's client-side live search. The nightly crawlGoldin keeps them fresh
 * after this; this is the one-time seed of the current live book.
 *
 * Run: npx tsx scripts/backfill-goldin-live.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { AuctionLot, Currency } from '../app/types';
import { sportOf } from '../app/utils';

const LOTS_API = 'https://d1wu47wucybvr3.cloudfront.net/api/lots_v2';
const IMG = (id: string, img: string) => `https://d2tt46f3mh26nl.cloudfront.net/public/Lots/${id}/${img}@1x`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CORPUS = path.join(process.cwd(), 'data', 'corpus');

const GAME_USED = /\b(game[- ](used|worn|issued)|match[- ](used|worn)|player[- ]worn|team[- ]issued|fight[- ]worn|tour[- ](used|worn)|warm[- ]?up[- ]worn|practice[- ]worn|game bat|game ball|photo[- ]?match(ed)?|mears\b)\b/i;
const TROPHY = /\b(trophy|award|championship ring|title belt|winners? medal|olympic medal|plaque|mvp\b|heisman|hall of fame ring|championship pendant)\b/i;
const TICKET = /\b(tickets?\b|stub|full ticket|season pass|press pass|credential|all[- ]access pass)\b/i;
const EXCLUDE = /\b(video game|nintendo|playstation|\bps[1-5]\b|xbox|sega|atari|game ?boy|wata|vga\b|do not list|per shaneeza|per wagner)\b/i;
const routeSport = (t: string) => GAME_USED.test(t) ? 'game-used' : TROPHY.test(t) ? 'trophies-awards' : TICKET.test(t) ? 'tickets-passes' : 'sports-cards';
const cleanTitle = (t: string) => t.replace(/^\s*(?:do not list[^-]*-\s*)?/i, '').replace(/^\s*(?:[A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}|\d{4})\s*-\s*/i, '').trim();

async function query(from: number) {
  const res = await fetch(LOTS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ search: { queryType: 'Featured', category: ['Sport'], hasAnalyticsConsent: false, size: 100, from } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json() as any;
  return { lots: j?.searchalgolia?.lots || [], total: j?.searchalgolia?.total || 0 };
}

function liveRow(lot: any): AuctionLot | null {
  if (!lot.title || !lot.lot_id) return null;
  const title = cleanTitle(lot.title);
  if (!title || EXCLUDE.test(title.toLowerCase())) return null;
  if (lot.status && lot.status !== 'Live' && lot.status !== 'Preview') return null;
  const end: string = lot.end_timestamp || lot.start_timestamp || '';
  if (!end) return null;
  const bp = lot.buyer_premium || 20;
  const bid = lot.current_price || 0;
  const saleDay = end.split('T')[0] || null;
  return {
    id: `goldin-${lot.lot_id}`,
    artist: routeSport(title.toLowerCase()),
    title, year: null, medium: null, dimensions: null, description: null,
    category: 'object',
    imageUrl: lot.primary_image_name ? IMG(lot.lot_id, lot.primary_image_name) : null,
    auctionHouse: 'Goldin',
    saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
    saleDate: saleDay, saleDateTime: end || null,
    lotNumber: lot.lot_number || null,
    // live = NOT sold: all realized fields null; currentBid carries the bid.
    nativeCurrency: 'USD' as Currency,
    hammerNative: null, premiumNative: null, realizedNative: null,
    buyerPremiumPct: bp, fxRate: 1, fxAsOf: saleDay,
    hammerUsd: null, premiumUsd: null, realizedUsd: null,
    estLowNative: null, estHighNative: null, estLowUsd: null, estHighUsd: null,
    priceBasis: undefined,
    currency: 'USD' as Currency, estimateLow: null, estimateHigh: null,
    hammerPrice: null, premiumPrice: null, priceUsd: null,
    status: 'upcoming' as any,
    url: lot.meta_slug ? `https://goldin.co/item/${lot.meta_slug}` : 'https://goldin.co',
    currentBid: bid, bidCount: lot.number_of_bids || 0, buyerPremium: bp,
    auctionId: lot.auction_id || undefined,
    sport: sportOf(title), schemaVersion: 2,
  } as unknown as AuctionLot;
}

const readGz = (f: string): Record<string, unknown>[] => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) => fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));

(async () => {
  const lots = readGz('lots.json');
  const archive = readGz('sold-archive.json');
  const existing = new Set<string>([...lots, ...archive].map(l => String(l.id)));
  const before = lots.length;

  const fresh = new Map<string, AuctionLot>();
  let total = Infinity;
  for (let from = 0; from < Math.min(total, 8000); from += 100) {
    const { lots: rows, total: t } = await query(from);
    total = t;
    if (!rows.length) break;
    for (const l of rows) {
      const id = `goldin-${l.lot_id}`;
      if (existing.has(id) || fresh.has(id)) continue;
      const row = liveRow(l);
      if (row) fresh.set(id, row);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  const rows = Array.from(fresh.values());
  const byArtist: Record<string, number> = {};
  for (const r of rows) byArtist[r.artist] = (byArtist[r.artist] || 0) + 1;
  console.log(`[goldin-live] Sport live total ${total} · ${rows.length} new upcoming rows:`, JSON.stringify(byArtist));
  if (!rows.length) { console.log('[goldin-live] nothing new.'); return; }
  for (const r of rows) lots.push(r as unknown as Record<string, unknown>);
  writeGz('lots.json', lots);
  console.log(`[goldin-live] lots.json.gz: ${before} → ${lots.length} rows (+${rows.length}). Run build-market to publish.`);
})();
