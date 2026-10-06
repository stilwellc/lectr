# Engine accuracy reports

One report per calendar month: `<YYYY-MM>.md` (to read) and `<YYYY-MM>.json`
(machine-readable; the next report reads the previous three for its trend
table). They are written by `scripts/accuracy-report.ts` and proposed as a PR
by `.github/workflows/accuracy-report.yml` at 07:23 UTC on the 2nd of every
month.

## What is graded

Every lot lectr put a number on before its sale, that settled inside the
window (default: the previous calendar month), graded against what it actually
hammered at. A claim only counts if it was made on or before the sale day.

| record | what it holds | where it lives |
|---|---|---|
| value tape | the FIRST value each upcoming lot was served (value, band, confidence tier, signal, expected hammer, max bid), engine-version tagged | `data/corpus/value-tape.json.gz`, R2 `latest/value-tape.json.gz` |
| calls ledger | the first call per lot for each product: card comp value, bid projection, THE GAP, THE SLEEPERS | `data/corpus/calls-ledger.json.gz`, R2 `latest/calls-ledger.json.gz` |
| sold corpus | realized price, hammer, buyer's premium, house estimate | `data/corpus/lots.json.gz` + `sold-archive.json.gz` (or the per-house segments) |

The value tape has only persisted across nights since **Oct 3 2026**. Before
then it was rebuilt empty every night, so months up to and including September
2026 have no tape rows. The calls ledger covers those months for the card,
projection and lane products.

## Basis and definitions

Everything is on **hammer**:

- **lectr**: the served `expectedHammerUsd`. Rows from before that field existed fall back to the all-in value ÷ the lot's premium factor.
- **house**: the estimate midpoint. Estimates are hammer figures.
- **realized**: the published hammer, or else realized all-in ÷ the lot's own premium (`inferHammerUsd`).

"lectr closer than the house" on this basis is the same comparison as lectr's
all-in value against the house mid × premium.

| metric | definition |
|---|---|
| median absolute error | exp(median \|ln(actual ÷ predicted)\|) − 1, the same convention as validate-engine G5 |
| within ±30% | share with \|ln(actual ÷ predicted)\| ≤ ln 1.3 |
| bias | exp(median ln(actual ÷ predicted)). Above 1× means lots sold above the call |
| lectr closer | share of estimate-carrying lots where lectr's call was strictly nearer the hammer than the house mid (ties count half) |
| band coverage | share of hammers inside the published band (the all-in band ÷ the served premium factor). Nominal is 70% |
| hammer ≤ max bid | share of hammers at or under the max bid. The target is about 30% |
| Flags edge | estimate lots flagged "below comparable market" against all others: median hammer ÷ estimate mid, and the beat-high rate (hammer above the high estimate) |
| abstention | the live book at report time (valued, abstained and why), plus the share of the window's settled lots that wore a served value |

## Small samples

A figure prints only at n ≥ 10. Below that it shows "—". Under n 30 it is
marked *thin* and should not be read as a trend. Thin data never fails the
workflow. The report says how thin it is.

## Running it

```sh
bash scripts/data-store.sh pull           # sold corpus (read-only)
bash scripts/data-store.sh pull-backtest  # persisted value tape + calls ledger
npx tsx scripts/accuracy-report.ts                       # previous calendar month
npx tsx scripts/accuracy-report.ts --month 2026-09
npx tsx scripts/accuracy-report.ts --from 2026-10-01 --to 2026-10-05 --out-dir /tmp/acc   # partial
```

`--snapshot-tape <dir>` (backfill only, never in CI) rebuilds first-served
values for the weeks before the tape persisted. It reads dated served
snapshots laid out as `<dir>/<YYYYMMDD…>/upcoming.json`, which are the
`upcoming.json` files from R2 `versions/<stamp>/served.tar.gz`. Those rows
are labelled *reconstructed* and get their own "By record origin" table. A lot
first served before the earliest snapshot is graded on its first snapshot
value, which is a later and easier claim.
