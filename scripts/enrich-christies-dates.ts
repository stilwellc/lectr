/**
 * Christie's ONLINE-sale accurate close times — the onlineonly enrichment.
 * (Companion to enrichSothebysCloseTimes in ray-crawl.ts. NOT yet wired in — see
 * docs/christies-onlineonly-dates.md; merge + wire when ready.)
 *
 * THE BUG THIS SOLVES
 * -------------------
 * www.christies.com's auction data (window.chrComponents.lots) is STALE for
 * online ("First Open" / onlineonly) sales. It reports a live sale as OVER with
 * years-old dates — e.g. a Tom Sachs lot that actually closes 2026-07-17 shows
 * `is_auction_over: true`, `end_date: 2013-10-29`. Trusting it buried live lots.
 * The REAL close lives on onlineonly.christies.com.
 *
 * CONFIRMED (July 2026)
 * ---------------------
 * Every Christie's lot we ingest carries an onlineonly SSO url, e.g.
 *   https://onlineonly.christies.com/sso?ObjectID=24194.184&LotNumber=184
 * Following it (302 → the real lot page) yields embedded JSON with the true
 * close time:
 *   "start_date":"2026-07-01T14:00:00Z","end_date":"2026-07-17T17:03:00.000Z"
 * That `end_date` is the accurate per-lot hammer/close (the on-page countdown).
 *
 * WHAT THIS DOES
 * --------------
 * For each LIVE (upcoming) Christie's lot with an onlineonly url, fetch the page
 * and stamp the real `end_date` as saleDate. Best-effort + capped + concurrency-
 * limited: a lot we cannot reach keeps its existing date and stays visible —
 * accuracy NEVER costs a tracked lot (the standing rule). Until this is wired,
 * those lots read ~"closing today/soon" (anchored to now) rather than the exact
 * date; this pass makes them precise.
 *
 * TO WIRE (in scripts/ray-crawl.ts, after the Christie's auction crawl):
 *   import { enrichChristiesCloseTimes } from './enrich-christies-dates';
 *   ...
 *   freshLots.push(...await crawlChristiesAuctions(auctionScope));
 *   await enrichChristiesCloseTimes(freshLots);   // <-- add this line
 */
import type { AuctionLot } from '../app/types';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function enrichChristiesCloseTimes(lots: AuctionLot[]): Promise<void> {
  const targets = lots.filter(l =>
    l.auctionHouse === "Christie's" &&
    l.status === 'upcoming' &&
    !!l.url &&
    /onlineonly\.christies\.com/.test(l.url)
  );
  if (!targets.length) return;

  const CONC = 6, CAP = 1000;
  const slice = targets.slice(0, CAP);
  let enriched = 0;

  for (let i = 0; i < slice.length; i += CONC) {
    await Promise.all(slice.slice(i, i + CONC).map(async lot => {
      try {
        const r = await fetch(lot.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        if (!r.ok) return;
        const h = await r.text();
        const raw = (h.match(/"end_date":"([0-9T:.\-]+Z)"/) || [])[1];
        if (!raw) return;
        const d = new Date(raw);
        if (isNaN(d.getTime())) return;
        const iso = d.toISOString();
        lot.saleDate = iso.slice(0, 10);
        (lot as AuctionLot & { saleDateTime?: string }).saleDateTime = iso;
        // genuinely future now → stands on its own date; drop the keep-visible flag
        if (d.getTime() > Date.now()) (lot as AuctionLot & { resultsPending?: boolean }).resultsPending = false;
        enriched++;
      } catch { /* unreachable → keep existing date + resultsPending; never drop */ }
    }));
    await sleep(120);
  }
  console.log(`  [Christie's] enriched ${enriched}/${slice.length} live lots with accurate onlineonly close times`);
}
