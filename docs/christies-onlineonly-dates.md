# Christie's online-sale close times (onlineonly enrichment)

**Status:** wired (Oct 10 2026). Module `scripts/lib/houses/christies-close.ts`,
called from `scripts/ray-crawl.ts` just before the global sanitize net. Runs in
the nightly crawl on GitHub Actions only, never serverless.

## History
- **Jul 14 2026:** branch `christies-onlineonly-dates` wrote the module as
  `scripts/enrich-christies-dates.ts` and left it unwired.
- **Aug (GA hardening, 077ce88):** the same logic was pasted inline into
  `ray-crawl.ts`, after the sanitize net. It took the **first** `"end_date"`
  regex match on the page, and it did not stamp `closeKind`.
- **Oct 9 2026:** `app/lib/house-tz.ts` added `closeKind` (`'online' | 'session'`)
  and `liveUntilMs`. An unmarked timed close reads live for 8h after the stamp;
  an `'online'` close reads live for 3h.
- **Oct 10 2026:** the logic moved into its own tested module: a keyed parse,
  `closeKind: 'online'`, a run order before the sanitize net, and
  `fetchWithRetry` backoff.

## The bug
`www.christies.com`'s auction data is **stale for online-only ("First Open")
sales**. It can report a live lot as `is_auction_over: true` with
`end_date: 2013-10-29`. Trusting that buried live lots. One example was a saved
Tom Sachs pair that vanished from a watchlist. The auction crawler never trusts
www to close a lot: a resultless lot stays upcoming, and a stale date is anchored
to now with `resultsPending`. Since Oct 10 that anchored lot no longer carries
the stale www date as `saleDateTime`. House-tz would have read the 2013 stamp as
a timed close and dropped the lot from live.

## The source (probed Oct 10 2026)
An online-only lot carries an SSO url:

```
https://onlineonly.christies.com/sso?ObjectID=24498.339&LotNumber=339
  → 302 https://onlineonly.christies.com/s/photographs/andy-warhol-1928-1987-339/326588
```

A plain `fetch` with the crawler's Chrome UA returns HTTP 200 and needs no
browser. The page embeds `window.chrComponents`:

| path | what | `end_date` |
|---|---|---|
| `lots.data.lots[0]` | **this lot**: `analytics_id` `24498.339` (= SSO ObjectID), `object_id` `326588` (= /s/ tail), `lot_id_txt` `339`, `event_type` `OnlineSale` | `2026-10-23T17:17:00.000Z` ← the close |
| `lots.data.lots[0].sale` | the sale block | `2026-10-23T11:00:00.000Z` (sale-level, not this lot) |
| `moreFrom.data.lots[]` | neighbours | their own staggered closes (`17:18`, `17:19`, …) |

The page carries about a dozen end_dates, so the parse is keyed to **this** lot.
It matches on `analytics_id`, then `object_id`, then a lot number if exactly one
lot matches. If none of those match, the parse returns nothing. It never takes
the first end_date on the page.

## What it does
For every **non-sold** Christie's lot with an onlineonly url, including corpus
rows that stale www data closed (the legacy id is not re-produced nightly):
- `saleDateTime` = the lot's end_date (full ISO, `Z`)
- `closeKind` = `'online'`: the end_date is this lot's own staggered close, so
  house-tz's 3h online slack applies
- `saleDate` = the sale-location day (`lib/sale-day`)
- future close → `status: 'upcoming'`, `resultsPending: false`. This revives a
  wrongly-closed lot.
- past close → status unchanged; `resultsPending` = inside `RESULT_PENDING_MS`.
  The sanitize net, which runs right after, then judges the lot on the **true**
  date.

**Hard rule:** if a lot can't be reached, gets a non-200, or has no keyed
end_date, it keeps its date and status. It stays visible and is never dropped.

Limits: up to 1500 lots (live lots first), 6 fetches at a time, a 20s timeout per
attempt, `fetchWithRetry` with 1 retry (429 backoff honours Retry-After), a
120ms pause between batches, and an 8-minute wall-clock budget. Lots not reached
in a run keep their state.

## Coverage, Oct 10 2026 (live book of Oct 9)
- 169 live Christie's lots. **11 are online-only**: sales 24498 NY, 24595 LDN,
  25230 LDN and 24550 NY. All 11 carry SSO urls, and **11/11 yield an end_date**
  on a live fetch.
- The other 158 are on `www.christies.com/en/lot/…`. One lot from each of their
  14 sales was probed, and every sale is `type: Traditional` (a live room). They
  have no onlineonly page and stay date-only. House-tz closes them at the end of
  the sale day in the room's time zone. Their www `T00:00Z` / local-midnight
  stamps are day stamps and are normalized away.

## Follow-ups
- `api.christies.com` REST paths (`/sales/{id}/lots`, …) 404. The per-lot SSO
  fetch avoids needing them.
- One page lists about 12 neighbouring lots with their closes. If the online
  book grows a lot, a sale-level pass could stamp neighbours from one fetch.
- Live-room (`Traditional`) sales have no per-lot time on www. They would need a
  session start (as with Phillips `closeKind: 'session'`) from another source.
