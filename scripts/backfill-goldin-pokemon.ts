// One-time Goldin Pokémon SOLD backfill — the 'pokemon' culture slug's corpus.
// Goldin's sold index holds ~41k Pokémon rows but flat pagination dies past
// from:10000, so this sweeps PER COMPLETED AUCTION (each fully paginable) with
// the sub_category:['Pokemon'] facet — the query scope IS the identity (lot
// payloads carry no category field). Existing goldin-{id} rows always win:
// this only seeds history, never touches the live tracker's records. Run:
//   RAY_SKIP_MAIN=1 NODE_OPTIONS=--max-old-space-size=10240 \
//     npx tsx scripts/backfill-goldin-pokemon.ts [--write] [--max-auctions N]
// then push:  npx wrangler r2 object put lectr-data/latest/segments/goldin.ndjson.gz \
//     --file data/corpus/segments/goldin.ndjson.gz --remote
import type { AuctionLot } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { readSegment, writeSegment } from './corpus-io';

const LOTS_API = 'https://d1wu47wucybvr3.cloudfront.net/api/lots_v2';
const AUCTIONS_API = 'https://d2l9s2774i83t9.cloudfront.net/api/auctions';
const IMG = (lotId: string, img: string) => `https://d2tt46f3mh26nl.cloudfront.net/public/Lots/${lotId}/${img}@1x`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const LEAK = /\bdo not list\b|per shaneeza|per wagner|do not sell\b/i;
const GAMES = /\b(video game|nintendo|playstation|\bps[1-5]\b|xbox|sega|atari|game ?boy|n64|game ?cube|wii|famicom|wata|vga\b|sealed game|arcade)\b/i;

const argNum = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function post(url: string, body: object): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1000 * attempt);
    }
  }
}

function toLot(lot: any): AuctionLot | null {
  if (!lot.lot_id || !lot.title) return null;
  if (LEAK.test(lot.title) || GAMES.test(lot.title)) return null;
  const bid = lot.current_price || 0;
  if (bid <= 0) return null;
  const bp = lot.buyer_premium ?? 20; // historical Goldin premium; current is 22
  const end = lot.end_timestamp || lot.start_timestamp;
  if (!end) return null;
  const endMs = new Date(end).getTime();
  if (isNaN(endMs) || endMs > Date.now() + 30 * 24 * 60 * 60 * 1000) return null; // phantom future close
  const saleDate = String(end).split('T')[0];
  const realized = Math.round(bid * (1 + bp / 100));
  // money block mirrors ray-crawl's goldin sold stamp: USD identity fx,
  // hammer = winning bid, realized = hammer + premium, basis final-bid-plus-bp
  return {
    id: `goldin-${lot.lot_id}`,
    artist: 'pokemon',
    title: String(lot.title).replace(/\s+/g, ' ').trim(),
    year: null, medium: null, dimensions: null,
    category: 'object',
    imageUrl: lot.primary_image_name ? IMG(lot.lot_id, lot.primary_image_name) : null,
    auctionHouse: 'Goldin',
    saleName: lot.auction_type ? `Goldin ${lot.auction_type} Auction` : 'Goldin Auction',
    saleDate,
    saleDateTime: end,
    lotNumber: lot.lot_number || null,
    nativeCurrency: 'USD',
    hammerNative: bid, premiumNative: realized, realizedNative: realized,
    buyerPremiumPct: bp,
    fxRate: 1, fxAsOf: saleDate,
    hammerUsd: bid, premiumUsd: realized, realizedUsd: realized,
    estLowNative: null, estHighNative: null, estLowUsd: null, estHighUsd: null,
    currency: 'USD', estimateLow: null, estimateHigh: null,
    hammerPrice: bid, premiumPrice: realized, priceUsd: realized,
    priceBasis: 'final-bid-plus-bp',
    status: 'sold',
    url: lot.meta_slug ? `https://goldin.co/item/${lot.meta_slug}` : 'https://goldin.co',
    currentBid: bid,
    bidCount: lot.number_of_bids || 0,
    buyerPremium: bp,
    auctionId: lot.auction_id || undefined,
  } as unknown as AuctionLot;
}

async function main() {
  const write = process.argv.includes('--write');
  const maxAuctions = argNum('max-auctions', 1000);

  const aj = await post(AUCTIONS_API, { status: 'All', order: 'desc' });
  const completed = (aj?.auctions || []).filter((a: any) => a.status === 'Completed');
  console.log(`[pkmn] ${completed.length} completed auctions`);

  const fresh = new Map<string, AuctionLot>();
  let auctionsWithPokemon = 0;
  for (const [i, a] of completed.slice(0, maxAuctions).entries()) {
    let from = 0, total = Infinity, got = 0;
    while (from < total) {
      const j = await post(LOTS_API, { search: {
        queryType: 'Ending_Soonest', hasAnalyticsConsent: false, show_only: 'Sold',
        auction_id: [a.auction_id], category: ['Non-Sport'], sub_category: ['Pokemon'],
        size: 100, from,
      } });
      const lots = j?.searchalgolia?.lots || [];
      total = j?.searchalgolia?.total || 0;
      if (!lots.length) break;
      for (const l of lots) { const lot = toLot(l); if (lot && !fresh.has(lot.id)) { fresh.set(lot.id, lot); got++; } }
      from += 100;
      await sleep(350);
    }
    if (got) { auctionsWithPokemon++; console.log(`  [pkmn] ${i + 1}/${Math.min(completed.length, maxAuctions)} ${String(a.title || a.auction_id).slice(0, 50)}: ${got} (running ${fresh.size})`); }
    await sleep(200);
  }
  console.log(`[pkmn] ${fresh.size} sold Pokémon lots from ${auctionsWithPokemon} auctions`);

  const batch = Array.from(fresh.values());
  const rep = assertInvariants(batch);
  console.log(`[pkmn] invariant FATALs: ${rep.fatal.length} | warns: ${rep.warn.length}`);
  rep.fatal.slice(0, 6).forEach(f => console.error('  FATAL', f));
  if (rep.fatal.length) process.exit(1);

  if (write) {
    // EXISTING ROWS WIN — the live tracker/flip owns anything it already
    // recorded; the backfill only fills history the nightly can't reach.
    const existing = readSegment('goldin');
    const have = new Set(existing.map(r => String((r as { id?: string }).id)));
    const add = batch.filter(l => !have.has(l.id));
    writeSegment('goldin', existing.concat(add as unknown as Record<string, unknown>[]));
    console.log(`[pkmn] merged into segment 'goldin': +${add.length} new (${batch.length - add.length} already tracked), ${existing.length + add.length} total`);
  } else {
    const s = batch[0];
    if (s) console.log('[pkmn] sample:', JSON.stringify({ id: s.id, title: s.title.slice(0, 60), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd }, null, 0));
    console.log('[pkmn] dry run (pass --write to persist)');
  }
}
main().catch(e => { console.error('[pkmn] fatal', e); process.exit(1); });
