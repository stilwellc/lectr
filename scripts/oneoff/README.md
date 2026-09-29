# scripts/oneoff — one-shot repairs, backfills and research harnesses

Nothing here is run by a workflow or an npm script. Each file was written for a
single repair, backfill or measurement and is kept as the receipt for it (and
so it can be re-run). If something here becomes recurring, move it back to
`scripts/` and wire it into a workflow.

Run from the repo root, e.g. `RAY_SKIP_MAIN=1 npx tsx scripts/oneoff/backfill-lama.ts`.
Most write-capable scripts are report-only unless given `--write` / `--commit`.

## Backfills and repairs (typechecked with the rest of the repo)

| script | what it did |
|---|---|
| `backfill-bonhams-artists.ts` | Bonhams backfill for newly added art makers (Typesense search per maker) |
| `backfill-createauction.ts` | CreateAuction (Lelands / Memory Lane / LOTG) full-depth parallel itemid backfill |
| `backfill-goldin-pokemon.ts` | Goldin Pokémon SOLD history, the corpus behind the `pokemon` culture slug |
| `backfill-lama.ts` | LAMA deep backfill over the full paginator per tracked maker |
| `resolve-bonhams.ts` | re-resolve gated / mis-settled Bonhams results against bonhams.com lot pages |
| `resolve-wright.ts` | re-resolve stuck Wright / Rago / LA Modern / Toomey results |
| `restamp-rago.ts` | repair the Wright/Rago house crosstalk in existing data |
| `one-shot.mjs` | full-page Playwright screenshot of one URL (`node scripts/oneoff/one-shot.mjs <url> <out.png>`) |

## qa/ — research, audits and equivalence harnesses (tsconfig-excluded)

`qa/` is excluded from `tsc` (see tsconfig.json), so files here may drift from
the live engine APIs. Files that no longer typechecked and that nothing
referenced were deleted on Sep 28 2026; the ones that remain but fail `tsc`
(`classification-normalize-spec`, `culture-lib`, `design-gates`,
`game-used-final`, `game-used-fix4`, `repeat-sale-equiv`, `watches-backtest`,
`watches-backtest2`) are cited by docs or code comments — fix before re-running.

- **Plans / status write-ups:** `JULIENS_PROPSTORE_PLAN.md`, `MEMORYLANE_HEAL_STATUS.md`, `sports-expansion-recon.md`, `audit-*.md`, `data-engine-audit-2026-08.md`, `engine-value-audit-2026-08.md`.
- **Generators for committed app data:** `gen-coverage.ts` (app/about/coverage.json), `gen-distribution.ts`, `gen-proof-comps.ts` (app/about/proof-cases.json), `deep-value.ts`.
- **Equivalence proofs cited by production code:** `repeat-sale-equiv.ts` (build-market / lib/repeat-sale), `maker-pool-equiv.ts` (build-market maker pool), `maker-cov-equiv.ts` (hedonic-index covariance solve).
- **Engine backtests / leave-one-out gates:** `window-replay.ts`, `backtest-sample.ts`, `live-rescore.ts`, `noest-replay.ts`, `idtier-holdout.ts`, `dims-gate-loo.ts`, `era-gate-loo.ts`, `roster-tier-loo.ts`, `grade-ladder-holdout.ts`, `validate-engine-v2.ts`, `validate-stage1.ts`.
- **Per-vertical studies:** `art-*.ts`, `audit-pools.ts`, `audit2.ts`, `classification-*.ts`, `culture-0*.ts` + `culture-lib.ts`, `design-*.ts`, `game-used-*.ts`, `science-*.ts`, `watches-*.ts`, `submarket-mine*.ts`, `validate-drills.ts`, `validate-subcats.ts`.
- **Crawler probes and heals:** `bidsquare-probe.ts`, `struts-probe.ts`, `test-lama.ts`, `resolve-suspects.ts`, `heal-local.sh` (residential-IP CreateAuction heal), `call-probe*.ts`, `repro.ts`, `shape-check.ts`, `dump-subjects.ts`, `extract-eval.ts`, `audit-datasci-sample.js`, `shot-analytics.js`.
- **Outputs of the above:** the `*.json`, `*.ndjson`, `*.txt` files and `ga/`.
