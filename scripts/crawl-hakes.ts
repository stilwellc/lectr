// Hake's Auctions crawler — the 'hakes' segment, on the SHARED Bidsquare
// platform (scripts/lib/bidsquare.ts), which SCP also rides.
//
// MIGRATION (verified Sep 3 2026, plain curl 200 with a real Chrome UA):
// hakes.com is now a Bidsquare white-label. The old ASP.NET plan in
// scripts/_qa/sports-expansion-recon.md — `/{SLUG}-LOT{id}.aspx`,
// `pastauctionlanding.aspx`, the Akamai wall, Playwright — is DEAD: those URLs
// return 404 and no bot wall was hit anywhere on the new site.
//
//   /auctions                     → 2 catalogs (Sept 2026 Pop Culture 24709,
//                                   Lawrence Klein Collection Part 1 24684)
//   /auctions/past                → server-renders "No Auction Available"
//   /online-auctions/hakes-auctions/<slug>-<itemId>  → JSON-LD Product + the
//                                   subject's own lbl_/tcb_ price pair
//
// ⚠ SOLD HISTORY: Hake's Bidsquare instance carries ZERO past auctions today —
// their FIRST sale on the platform (Sept 2026 Pop Culture) closes 2026-09-30.
// bidsquare.com/auction-house/hakes-auctions/past is empty too, and the old
// ASP.NET archive is gone. So there is no sold backfill to run: the sold leg
// starts producing the night after Hake's first sale closes and its catalog
// moves to /auctions/past — exactly the SCP path, byte for byte the same code.
// Until then this crawler's value is the LIVE leg (the running catalogue as
// status:'upcoming'), and the standing resolve pattern retires each upcoming
// row into a sold row at the same `hakes-<itemId>` id once the sale settles.
//
// MONEY: Hake's publishes "HAKE'S BUYER'S PREMIUM IS 20%" on
// https://www.hakes.com/terms-conditions (read Sep 3 2026). The platform's
// settled figure is labelled "Sold for" and marked "Sold Price includes BP"
// (verified on a settled SCP lot on the same stack), i.e. PREMIUM-INCLUSIVE =
// our `realized` basis, so buyerPremiumPct:20 is stamped alongside it and
// inferHammerUsd divides by the house's real 1.20 rather than the 1.25 default.
//
// Run: RAY_SKIP_MAIN=1 npx tsx scripts/crawl-hakes.ts --live [--write]
//      [--auctions 3] [--cap 600] [--delay 150] [--conc 2]
import { crawlBidsquare, optsFromArgv, type BidsquareHouse } from './lib/bidsquare';
import type { SportsCategory } from './lib/sports-crawl';

/** Hake's is a POP-CULTURE house (comics, toys, original art, political
 *  Americana, movie material) — the shared sports classifier would file a
 *  signed comic as an 'autograph' and a lunchbox as 'other-memorabilia'. The
 *  hint only ever RE-ROUTES those two weak buckets into pop-memorabilia; a lot
 *  the classifier confidently read as a graded card / game-used / ticket /
 *  wax box is left exactly where it landed. */
const POP_RE = /\b(comic|comics|cgc|cbcs|original art|splash page|cover art|action figure|figure|toy|toys|playset|lunch\s?box|poster|one[-\s]?sheet|prop|costume|model kit|pinback|button|badge|robot|doll|board game|ring toy|premium ring|movie|film|animation|cel|statue|bust|kenner|mego|afa|ukg)\b/i;
const HAKES: BidsquareHouse = {
  segment: 'hakes',
  label: "Hake's",
  host: 'https://www.hakes.com',
  houseSlug: 'hakes-auctions',
  idPrefix: 'hakes',
  auctionHouse: "Hake's",
  bpPct: 20,                                   // published, hakes.com/terms-conditions
  defaultBasis: 'realized',
  skipCatalogRe: /buy-now|test|marketplace/i,
  categoryHint: (title, desc, base): SportsCategory => {
    if (base !== 'autograph' && base !== 'other-memorabilia') return base;
    return POP_RE.test(`${title} ${desc}`) ? 'pop-memorabilia' : base;
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  crawlBidsquare(HAKES, optsFromArgv({ auctions: 3, cap: 600, delayMs: 150 }))
    .catch(e => { console.error("[Hake's] fatal", e); process.exit(1); });
}

export { HAKES };
