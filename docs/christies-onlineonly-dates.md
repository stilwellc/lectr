# Christie's online-sale accurate close times (onlineonly enrichment)

**Status:** PR for later — module written + verified, **not yet wired into the crawl.**

## The bug
`www.christies.com`'s auction data (`window.chrComponents.lots`) is **stale for
online "First Open" / onlineonly sales**. For a lot that actually closes
`2026-07-17`, it can report `is_auction_over: true` with `end_date: 2013-10-29`.
Trusting that flag/date buried genuinely-live lots (a saved Tom Sachs pair
vanished from a watchlist).

## Interim fix already shipped
`scripts/ray-crawl.ts` no longer trusts `www.christies.com` to **close** a lot:
a resultless Christie's lot is always kept **visible/upcoming**, and if its www
date is stale/past it's anchored to "now" (never a garbage 2013 date). So no lot
is lost — but the close time reads ~"closing today/soon", not the exact date.

## The accurate source (confirmed July 2026)
Every Christie's lot we ingest carries an onlineonly SSO url:

```
https://onlineonly.christies.com/sso?ObjectID=24194.184&LotNumber=184
```

Following it (302 → the real lot page) returns embedded JSON with the true close:

```json
"start_date":"2026-07-01T14:00:00Z","end_date":"2026-07-17T17:03:00.000Z"
```

`end_date` is the accurate per-lot hammer/close (the value behind the on-page
"ends in 3 days" countdown). Verified: `HTTP 200`, `end_date: 2026-07-17T17:03`.

## The module
`scripts/enrich-christies-dates.ts` exports `enrichChristiesCloseTimes(lots)`.
It mirrors `enrichSothebysCloseTimes`: for each **live** Christie's lot with an
onlineonly url, fetch the page, stamp the real `end_date` as `saleDate`.
Best-effort, capped (1000), concurrency-limited (6), with a hard rule — a lot we
can't reach keeps its date and stays visible. **Accuracy never costs a lot.**

## To wire (one line)
In `scripts/ray-crawl.ts`, right after the Christie's auction crawl:

```ts
import { enrichChristiesCloseTimes } from './enrich-christies-dates';
// ...
freshLots.push(...await crawlChristiesAuctions(auctionScope));
await enrichChristiesCloseTimes(freshLots);   // <-- add
```

## Follow-ups / notes
- The `api.christies.com` REST paths tried (`/sales/{id}/lots`, etc.) all 404 —
  the SSO-url-per-lot approach above sidesteps needing that endpoint.
- Consider a bulk sale-level fetch if per-lot page fetching proves too slow at
  scale (it's ~1 page per live Christie's lot, same cost profile as the Sotheby's
  enrichment, which runs fine).
- The interim "anchor to now" is safe but imprecise; wiring this makes Christie's
  online close times exact, matching what Sotheby's enrichment already does.
