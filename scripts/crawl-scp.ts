// SCP Auctions crawler — the 'scp' segment, on the SHARED Bidsquare platform
// (scripts/lib/bidsquare.ts), which Hake's also rides.
//
// Catalog on a Bidsquare white-label at catalogs.scpauctions.com — server-
// rendered, plain curl 200 (real Chrome UA; avoid ClaudeBot UA, which SCP's
// robots names). Each lot page carries a JSON-LD Product plus the subject's
// own `lbl_<item>_<event>` / `tcb_<item>_<event>` price pair. SCP encodes cert
// + photo-match in the lot title itself. Enumerate: /auctions/past →
// per-auction /catalog?page=N (50/pg) → lot pages.
//
// Sep 3 2026 — HARDENED as part of the Hake's build. The behaviour changes,
// all of which are the Bidsquare lib's:
//   · the realized price is read from the SUBJECT lot's own lbl_/tcb_ pair,
//     not a page-wide `id="tcb_[0-9_]+"` first match (the price-bleed shape
//     that poisoned NFL Auction and Memory Lane);
//   · the sold gate is the platform's own "Sold for" LABEL (a "Current Bid"
//     figure can never be published as a result), and the money basis is read
//     from the "Sold Price includes BP" marker instead of assumed;
//   · a batch poison detector runs before EVERY write, incremental flushes
//     included, and a run that fetched pages but parsed nothing refuses to
//     write at all (the prior segment rides);
//   · fetched/parsed/null counts are logged per batch; pagination is bounded.
//
// Run: RAY_SKIP_MAIN=1 npx tsx scripts/crawl-scp.ts --auctions 1 --cap 40 [--write]
import { crawlBidsquare, optsFromArgv, parseBidsquareSold, parseBidsquareLive, type BidsquareHouse } from './lib/bidsquare';
import type { AuctionLot } from '../app/types';

const SCP: BidsquareHouse = {
  segment: 'scp',
  label: 'SCP',
  host: 'https://catalogs.scpauctions.com',
  houseSlug: 'scp-auctions-inc',
  idPrefix: 'scp',
  auctionHouse: 'SCP',
  // SCP's own premium rate is not published on a page we read, so nothing is
  // stamped — premiums.ts's house schedule stays the fallback. (Do not guess.)
  defaultBasis: 'realized',
  skipCatalogRe: /buy-now|test|marketplace/i,
};

/** kept as named exports: the SCP parsers are the Bidsquare parsers bound to
 *  the SCP config (same output as before the extraction). */
export const parseScpLot = (html: string, url: string): AuctionLot | null => parseBidsquareSold(SCP, html, url);
export const parseScpLive = (html: string, url: string): AuctionLot | null => parseBidsquareLive(SCP, html, url);

if (import.meta.url === `file://${process.argv[1]}`) {
  crawlBidsquare(SCP, optsFromArgv({ auctions: 1, cap: 40, delayMs: 200 }))
    .catch(e => { console.error('[SCP] fatal', e); process.exit(1); });
}

export { SCP };
