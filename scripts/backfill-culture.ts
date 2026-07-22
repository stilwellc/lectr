/**
 * backfill-culture.ts — seed the POP CULTURE vertical from Goldin. Collin's
 * scope: high-end 1/1 cultural artifacts (screen-used props, stage-worn music,
 * handwritten lyrics, iconic entertainment/historic memorabilia), NEVER the
 * mass market (comics, trading cards, video games, VHS, vinyl, toys, posters).
 *
 * Goldin has no "culture" flag, but its Non-Sport SUB-CATEGORIES do the work:
 * 'Pop Culture/Entertainment', "Rock N' Roll", 'History' are where the real
 * memorabilia lives. routeCulture() then drops any mass/graded signal inside
 * those and routes the survivors to movie-tv / music-memorabilia /
 * entertainment-memorabilia. No price floor — the curation is the signal.
 *
 * Two passes, mirroring the sport backfills:
 *   LIVE  — Featured Non-Sport curated sub-cats → main corpus (lots.json.gz),
 *           so upcoming culture lots ship to the client + Supabase + ⌘K now.
 *   SOLD  — auction-enumeration over completed auctions (beats the 10k Algolia
 *           cap the way sports does), each auction's curated sub-cats →
 *           sold-archive.json.gz for the engine/analytics. Never deletes rows.
 *
 * The nightly crawlGoldin now carries the same live culture pass, so this is a
 * one-time seed; the historical Sotheby's/Christie's culture sales are a
 * separate (bigger) backlog. Run: npx tsx scripts/backfill-culture.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { AuctionLot, Currency } from '../app/types';
import { routeCulture } from './culture';

const LOTS_API = 'https://d1wu47wucybvr3.cloudfront.net/api/lots_v2';
const AUCTIONS_API = 'https://d2l9s2774i83t9.cloudfront.net/api/auctions';
const IMG = (id: string, img: string) => `https://d2tt46f3mh26nl.cloudfront.net/public/Lots/${id}/${img}@1x`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const PAGE = 100;
const CAP = 10000; // Algolia from+size hard cap
const SUB_CATS = ['Pop Culture/Entertainment', "Rock N' Roll", 'History'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const cleanTitle = (t: string) => t.replace(/^\s*(?:do not list[^-]*-\s*)?/i, '').replace(/^\s*(?:[A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}|\d{4})\s*-\s*/i, '').trim();

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
const soldQuery = (scope: object) => post(LOTS_API, { search: { queryType: 'Ending_Soonest', show_only: 'Sold', category: ['Non-Sport'], sub_category: SUB_CATS, hasAnalyticsConsent: false, ...scope } });
const liveQuery = (from: number) => post(LOTS_API, { search: { queryType: 'Featured', category: ['Non-Sport'], sub_category: SUB_CATS, hasAnalyticsConsent: false, size: PAGE, from } });

/* ── row builders: routeCulture is the gate — null means mass, drop it ─────── */
function soldRow(lot: any): AuctionLot | null {
  if (!lot.title || !lot.lot_id) return null;
  const title = cleanTitle(lot.title);
  const artist = title && routeCulture(title);
  if (!artist) return null;
  const bid = lot.current_price || 0;
  if (!(bid > 0)) return null;
  const end: string = lot.end_timestamp || lot.start_timestamp || '';
  const endMs = new Date(end).getTime();
  if (!isNaN(endMs) && endMs > Date.now() + 30 * 864e5) return null; // phantom future close
  const bp = lot.buyer_premium || 20;
  const premium = Math.round(bid * (1 + bp / 100));
  const saleDay = end.split('T')[0] || null;
  return {
    id: `goldin-${lot.lot_id}`,
    artist, title,
    year: null, medium: null, dimensions: null, description: null,
    category: 'object',
    imageUrl: lot.primary_image_name ? IMG(lot.lot_id, lot.primary_image_name) : null,
    auctionHouse: 'Goldin',
    saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
    saleDate: saleDay, saleDateTime: end || null,
    lotNumber: lot.lot_number || null,
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
    schemaVersion: 2,
  } as unknown as AuctionLot;
}

function liveRow(lot: any): AuctionLot | null {
  if (!lot.title || !lot.lot_id) return null;
  const title = cleanTitle(lot.title);
  const artist = title && routeCulture(title);
  if (!artist) return null;
  if (lot.status && lot.status !== 'Live' && lot.status !== 'Preview') return null;
  const end: string = lot.end_timestamp || lot.start_timestamp || '';
  if (!end) return null;
  const bp = lot.buyer_premium || 20;
  const bid = lot.current_price || 0;
  const saleDay = end.split('T')[0] || null;
  return {
    id: `goldin-${lot.lot_id}`,
    artist, title,
    year: null, medium: null, dimensions: null, description: null,
    category: 'object',
    imageUrl: lot.primary_image_name ? IMG(lot.lot_id, lot.primary_image_name) : null,
    auctionHouse: 'Goldin',
    saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
    saleDate: saleDay, saleDateTime: end || null,
    lotNumber: lot.lot_number || null,
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
    schemaVersion: 2,
  } as unknown as AuctionLot;
}

const readGz = (f: string): Record<string, unknown>[] => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) => fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));

(async () => {
  const lots = readGz('lots.json');
  const archive = readGz('sold-archive.json');
  const existing = new Set<string>([...lots, ...archive].map(l => String(l.id)));
  const lotsBefore = lots.length, archiveBefore = archive.length;

  // ── LIVE pass → main corpus ─────────────────────────────────────────────
  const liveFresh = new Map<string, AuctionLot>();
  {
    let total = Infinity;
    for (let from = 0; from < Math.min(total, 8000); from += PAGE) {
      try {
        const j = await liveQuery(from);
        const rows = j?.searchalgolia?.lots || [];
        total = j?.searchalgolia?.total || 0;
        if (!rows.length) break;
        for (const l of rows) {
          const id = `goldin-${l.lot_id}`;
          if (existing.has(id) || liveFresh.has(id)) continue;
          const row = liveRow(l);
          if (row) liveFresh.set(id, row);
        }
        await sleep(200);
      } catch (e) { console.warn('[culture] live pass truncated:', (e as Error).message); break; }
    }
    console.log(`[culture] LIVE: ${Math.min(total, 8000)} enumerated · ${liveFresh.size} new upcoming rows`);
  }

  // ── SOLD pass → sold-archive, auction-enumeration to beat the 10k cap ────
  const soldFresh = new Map<string, AuctionLot>();
  const considerSold = (lot: any) => {
    const id = `goldin-${lot.lot_id}`;
    if (existing.has(id) || soldFresh.has(id)) return;
    const row = soldRow(lot);
    if (row) soldFresh.set(id, row);
  };
  console.log('[culture] enumerating completed auctions…');
  const auctions = (await post(AUCTIONS_API, { status: 'All', order: 'desc' })).auctions || [];
  const completed = auctions.filter((a: any) => a.status === 'Completed').map((a: any) => a.auction_id);
  console.log(`[culture] ${completed.length} completed auctions to sweep`);

  let ai = 0, aWith = 0, capped = 0;
  for (const aid of completed) {
    ai++;
    try {
      const head = await soldQuery({ auction_id: [aid], size: 1, from: 0 });
      const total = head?.searchalgolia?.total || 0;
      if (!total) { await sleep(120); continue; }
      aWith++;
      if (total > CAP) capped++;
      for (let from = 0; from < Math.min(total, CAP); from += PAGE) {
        const d = await soldQuery({ auction_id: [aid], size: PAGE, from });
        const rows = d?.searchalgolia?.lots || [];
        if (!rows.length) break;
        rows.forEach(considerSold);
        await sleep(150);
      }
    } catch (e) { /* skip a bad auction, never fabricate */ }
    if (ai % 25 === 0) console.log(`[culture] auctions ${ai}/${completed.length} · ${aWith} w/culture · ${soldFresh.size} new sold rows`);
  }
  console.log(`[culture] auction sweep done: ${aWith} auctions w/culture, ${soldFresh.size} new sold rows (${capped} hit 10k cap)`);

  // sub-category backstop for the tail auctions no longer listed
  for (const sc of SUB_CATS) {
    try {
      const head = await soldQuery({ sub_category: [sc], size: 1, from: 0 });
      const total = head?.searchalgolia?.total || 0;
      if (!total) continue;
      const before = soldFresh.size;
      for (let from = 0; from < Math.min(total, CAP); from += PAGE) {
        const d = await soldQuery({ sub_category: [sc], size: PAGE, from });
        const rows = d?.searchalgolia?.lots || [];
        if (!rows.length) break;
        rows.forEach(considerSold);
        await sleep(150);
      }
      console.log(`[culture] sub_category '${sc}' (${total} total): +${soldFresh.size - before} new rows`);
    } catch (e) { console.warn(`[culture] sub_category '${sc}' failed:`, (e as Error).message); }
  }

  const liveRows = Array.from(liveFresh.values());
  const soldRows = Array.from(soldFresh.values());
  const ckpt = '/private/tmp/culture-rows.json';
  fs.writeFileSync(ckpt, JSON.stringify({ live: liveRows, sold: soldRows }));
  console.log(`[culture] checkpointed → ${ckpt}`);

  const by = (rows: AuctionLot[]) => { const m: Record<string, number> = {}; for (const r of rows) m[r.artist] = (m[r.artist] || 0) + 1; return m; };
  console.log(`[culture] LIVE by slug:`, JSON.stringify(by(liveRows)));
  console.log(`[culture] SOLD by slug:`, JSON.stringify(by(soldRows)));

  for (const r of liveRows) lots.push(r as unknown as Record<string, unknown>);
  for (const r of soldRows) archive.push(r as unknown as Record<string, unknown>);
  writeGz('lots.json', lots);
  writeGz('sold-archive.json', archive);
  console.log(`[culture] lots.json.gz: ${lotsBefore} → ${lots.length} (+${liveRows.length})`);
  console.log(`[culture] sold-archive.json.gz: ${archiveBefore} → ${archive.length} (+${soldRows.length})`);
  console.log('[culture] done. Run build-market to re-partition + rebuild served.');
})();
