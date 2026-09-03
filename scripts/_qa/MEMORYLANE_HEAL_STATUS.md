# Memory Lane price-bleed heal — status (2026-09-02)

## The defect
Memory Lane rows dated **2026-06-06** carry ≥15× identical-price clusters
($11,296 ×20, $10,359 ×20, $15,561 ×16, $15,034 ×15, $46,197 ×6 …). Same
signature as the Aug 2026 Lelands/LOTG bleed: the pre-fix gallery extractor
walked up past a card's boundary and stole a NEIGHBOR's "SOLD FOR"; the
whole card blob was also stored as the row's `title`.

## Fixed at source (this pass)
- `scripts/crawl-lelands-gallery.ts` — `extractCards` now collects every
  anchor per itemid and takes the lot's OWN anchor text as the title (the
  card blob is only the fallback, with ribbon label + boxed lot number
  stripped); the price still comes from the boundary-scoped card only.
  Adds `--sale-date YYYY-MM-DD` (auctions whose season date lands within
  ±75 days) and `--auction <substring>` targeting, and PRESERVES a row's
  existing exact `saleDate`/`saleDateTime` when re-pricing it (the gallery
  only knows season-approximate day-15 dates; the 2026-06-06 rows were
  stamped by the live-leg/per-lot paths and must keep that date).
- `scripts/crawl-createauction.ts` — live gallery cards: the boxed-lot-number
  strip now applies to the blob fallback only (it was eating the year off
  "1952 Topps …" titles taken from the anchor).

## Can the heal run from THIS machine? — NO (today)
`scripts/_qa/heal-local.sh` + `scripts/_qa/resolve-suspects.ts` exist and
are the right tools (residential IP survives the CF-walled auction-switcher
postback; resolve-suspects re-reads each suspect's own bidplace.aspx page
and restamps the true price / deletes a not-sold row / keeps on doubt). But
both need R2 via `scripts/data-store.sh pull-segment/push-segment`, and:

- `CLOUDFLARE_API_TOKEN` is not set in the environment or `.env.local`.
- `wrangler` is not installed (not global, not in `node_modules/.bin`).
- The wrangler OAuth token data-store.sh falls back to
  (`~/Library/Preferences/.wrangler/config/default.toml`) **expired
  2026-08-30T19:36Z** and its scope list carries no `r2:*` scope.
- `data/corpus/segments/` does not exist locally — the memorylane segment
  has never been pulled here, so the clusters can't even be inspected
  offline.

### To run it locally (when Collin is at the keyboard)
```bash
npx wrangler login            # re-auth; make sure R2 scopes are granted
#   — or —  export CLOUDFLARE_API_TOKEN=<token with Workers R2 Storage: Edit>
bash scripts/data-store.sh pull-segment memorylane
# targeted gallery re-crawl (fixed extractor, exact dates preserved):
RAY_SKIP_MAIN=1 npx tsx scripts/crawl-lelands-gallery.ts --house memorylane --sale-date 2026-06-06 --write
# then the per-lot pass over any remaining same-auction price clusters
# (withdrawn lots never render in a settled gallery, so only this fixes them):
RAY_SKIP_MAIN=1 npx tsx scripts/_qa/resolve-suspects.ts --house memorylane --cap 400        # dry run
RAY_SKIP_MAIN=1 npx tsx scripts/_qa/resolve-suspects.ts --house memorylane --cap 400 --write
bash scripts/data-store.sh push-segment memorylane
```
Run AFTER a nightly completes (don't race the matrix pushes). Full trio:
`bash scripts/_qa/heal-local.sh`.

## CI path made usable instead — `.github/workflows/gallery-heal.yml`
The single prior run (Aug 13, 31662850740) was CF-walled from CI IPs
(106 auctions → 0 sold) and cancelled at 103 min. Now:
- inputs `house` (all|lelands|memorylane|lotg), `sale_date`, `auction`,
  `max_auctions` → dispatch with house=memorylane, sale_date=2026-06-06 to
  target only that sale's auction(s);
- Chrome install step capped at 8 min (dep-less install first, falls through
  to the runner's system Chrome);
- job capped at 90 min, crawl step at 75.
It may STILL be CF-walled from datacenter IPs — the log now prints the
targeted auction names and per-auction sold counts, so a walled run shows
as "N sold lots = 0" immediately rather than after 100 minutes. If so, the
local path above is the fallback.

## Not done
- The actual heal (no R2 credentials on this machine).
- `resolve-suspects.ts` is unchanged (it already preserves the original
  saleDate and never deletes on doubt).
