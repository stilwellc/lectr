# ENGINE WORKFLOW PATCH — nightly.yml changes for the Sep 2 2026 engine audit

The engine agent may not edit `.github/workflows/*`. Apply the following to
`.github/workflows/nightly.yml` verbatim. Everything referenced here already
exists in the repo (`scripts/build-backtest.ts --market/--merge`,
`scripts/build-backtest-incremental.ts`, `scripts/validate-engine.ts`).

Summary of what changes and why:

| # | Change | Why |
|---|--------|-----|
| 1 | `backtest` job: `continue-on-error: false`, `timeout-minutes: 120` | The job has been red every night since Aug 26 with nobody noticing because it could never fail the run. A backtest that cannot produce a record now fails loudly (the scripts exit non-zero). |
| 2 | Sunday full replay runs as **per-market legs** (matrix) + a **merge** step | The single-process replay outgrew the 350-min cap. With the exact candidate pre-filter one leg is minutes, not hours; legs bound the blast radius and parallelise. |
| 3 | **Stale-record check** after the backtest step | Fail if `backtest.json.generatedAt` is older than 3 days — a "green" night can no longer ship a record from last week. |
| 4 | **`validate-engine` gate** in `assemble` after the engine build | Exits non-zero on any failed gate (monotonic beat-rate, tier honesty, coverage). Runs before the R2 push so a failed gate keeps last-good live. |
| 5 | `assemble` sentinel now exits non-zero on ≥2 poison price signatures and writes `::warning::` annotations | Already in `scripts/assemble.ts`; no YAML change needed beyond noting the new failure mode. `RAY_SENTINEL_WARN_ONLY=1` overrides after inspection. |

Measured locally (Aug 14 corpus snapshot, 1.10M lots, 283k targets): exact
pre-filter replays at **~460 targets/s** (was ~31/s; culture 2.3 ms/target vs
148 ms) — the full 283k-target replay is **~12 minutes** of scoring plus ~1
minute of corpus prep, per process. Leg timeouts below carry 10× headroom.

---

## 1 · `plan` job (new) — one place decides full vs incremental

Insert before `crawl:` (it has no dependencies):

```yaml
  # Decides once, for every downstream job, whether tonight is the FULL
  # per-market replay (Sunday UTC) or the incremental append. A job-level
  # output (not a per-step `date` call) so the leg matrix can be skipped
  # on weekdays without evaluating shell in an `if:`.
  plan:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    outputs:
      full: ${{ steps.dow.outputs.full }}
    steps:
      - id: dow
        run: |
          if [ "${{ github.event.inputs.backtest_mode }}" = "full" ]; then echo "full=true" >> "$GITHUB_OUTPUT";
          elif [ "${{ github.event.inputs.backtest_mode }}" = "incremental" ]; then echo "full=false" >> "$GITHUB_OUTPUT";
          elif [ "$(date -u +%u)" = "7" ]; then echo "full=true" >> "$GITHUB_OUTPUT";
          else echo "full=false" >> "$GITHUB_OUTPUT"; fi
```

Add to `workflow_dispatch.inputs`:

```yaml
      backtest_mode:
        description: "backtest: auto (Sunday = full per-market legs, else incremental) / full / incremental"
        type: choice
        options: [auto, full, incremental]
        default: auto
```

## 2 · `assemble` job — add the engine gate after the engine build

Insert AFTER the step `Rebuild eager upcoming payload` and BEFORE `Emit value book → private R2 (Starling)`:

```yaml
      # ENGINE GATE (Sep 2 2026): temporal holdout through the production
      # replay path. Exits non-zero on: non-monotonic beat-rate (global or any
      # market with ≥2 buckets at n≥30), a 'high' tier worse than 1.6× median
      # error or less accurate than 'low' in any market at n≥30, or <10%
      # coverage. Runs BEFORE the R2 push so a failed gate keeps last-good live.
      # ~3 min at --sample 30000 (stratified per market, incl. culture/tcg).
      - name: Validate engine (temporal holdout gate)
        run: |
          mkdir -p data/qa
          NODE_OPTIONS=--max-old-space-size=10240 npx tsx scripts/validate-engine.ts --sample 30000 --json data/qa/validate-engine.json
      - name: Upload engine validation report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: validate-engine
          path: data/qa/validate-engine.json
          retention-days: 14
          if-no-files-found: ignore
```

## 3 · Replace the whole `backtest:` job with the two jobs below

Delete the existing `backtest:` job (from `  backtest:` through the
`Push refreshed backtest.json (+ accumulator state)` step) and insert:

```yaml
  # ── FULL REPLAY LEGS (Sunday, or backtest_mode=full) ──────────────────────
  # One leg per market. Each scores ONLY its market's targets from scratch,
  # with point-in-time calibration, and uploads its state as an artifact; the
  # `backtest` job below merges them. Legs are independent — a failed market
  # fails the merge (partial records are never published), but never another
  # leg. Markets are the roster's market keys + 'other' (unrostered slugs;
  # legitimately empty → the leg exits 1 on "no targets" and is allowed to).
  backtest-leg:
    needs: [plan, assemble]
    if: needs.plan.outputs.full == 'true' && needs.assemble.result == 'success'
    runs-on: ubuntu-latest
    # measured: the largest leg (culture, ~94k targets) is ~5 min of scoring +
    # ~1 min prep at ~460 targets/s; 60 gives 10× headroom. If a leg ever
    # nears this, the fix is the pre-filter (backtest-core.candidatePriors),
    # not a bigger cap.
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        market: [art, design, watches, sports, science, culture, tcg, other]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - name: Fetch served payload (same-run artifact)
        uses: actions/download-artifact@v4
        continue-on-error: true
        with:
          name: served-payload
          path: public/data/ray
      - name: Fetch corpus (same-run artifact)
        uses: actions/download-artifact@v4
        continue-on-error: true
        with:
          name: corpus-payload
          path: data/corpus
      - name: Pull corpus + served from R2 (fallback if artifacts absent)
        run: |
          if [ -f public/data/ray/meta.json ] && [ -f data/corpus/lots.json.gz ]; then
            echo "payloads delivered by same-run artifacts — skipping R2 pull"
          else
            bash scripts/data-store.sh pull
          fi
      - name: Replay leg ${{ matrix.market }}
        run: |
          set +e
          NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/build-backtest.ts --market ${{ matrix.market }} --leg-dir data/backtest-legs
          rc=$?
          # 'other' holds only unrostered slugs and may have zero targets; every
          # rostered market must produce a leg.
          if [ $rc -ne 0 ] && [ "${{ matrix.market }}" = "other" ]; then echo "leg other: no targets (allowed)"; exit 0; fi
          exit $rc
      - name: Upload leg state
        uses: actions/upload-artifact@v4
        with:
          name: backtest-leg-${{ matrix.market }}
          path: data/backtest-legs/
          retention-days: 3
          if-no-files-found: ignore

  # ── THE RECORD (every night) ──────────────────────────────────────────────
  # Weekdays: incremental append (rehydrates the sidecar state, scores only
  # never-attempted targets inside the trailing 120-day window or first seen
  # since the prior run). Sunday: merge the legs into the canonical state +
  # backtest.json. BLOCKING now: a night that cannot produce a record fails the
  # run — that is the point. Not on the deploy critical path (deploy needs
  # assemble, not this), so a red backtest never withholds a fresh site.
  backtest:
    needs: [plan, assemble, backtest-leg]
    # runs after the legs on Sunday (legs skipped on weekdays still satisfy
    # `needs` via always()); requires a successful assemble either way
    if: always() && needs.assemble.result == 'success' && (needs.plan.outputs.full != 'true' || needs.backtest-leg.result == 'success')
    runs-on: ubuntu-latest
    continue-on-error: false
    # incremental measured ~3 min (prep) + scoring at ~460/s; merge is seconds.
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - name: Fetch served payload (same-run artifact)
        uses: actions/download-artifact@v4
        continue-on-error: true
        with:
          name: served-payload
          path: public/data/ray
      - name: Fetch corpus (same-run artifact)
        uses: actions/download-artifact@v4
        continue-on-error: true
        with:
          name: corpus-payload
          path: data/corpus
      - name: Pull corpus + served from R2 (fallback if artifacts absent)
        run: |
          if [ -f public/data/ray/meta.json ] && [ -f data/corpus/lots.json.gz ]; then
            echo "payloads delivered by same-run artifacts — skipping R2 pull"
          else
            bash scripts/data-store.sh pull
          fi
      - name: Fetch leg states (Sunday)
        if: needs.plan.outputs.full == 'true'
        uses: actions/download-artifact@v4
        with:
          pattern: backtest-leg-*
          merge-multiple: true
          path: data/backtest-legs/
      - name: Build the record (merge legs on Sunday · incremental append weekdays)
        run: |
          if [ "${{ needs.plan.outputs.full }}" = "true" ]; then
            echo "[backtest] FULL — merging per-market legs"
            NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/build-backtest.ts --merge --leg-dir data/backtest-legs
          else
            echo "[backtest] weekday — INCREMENTAL append"
            NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/build-backtest-incremental.ts
          fi
      # STALE-RECORD CHECK: a record older than 3 days means the append did not
      # happen, whatever the exit code said. Fails the job (and therefore the
      # night's conclusion) so it is seen.
      - name: Refuse a stale record (generatedAt older than 3 days)
        run: |
          node -e '
            const bt = JSON.parse(require("fs").readFileSync("public/data/ray/backtest.json", "utf8"));
            const age = (Date.now() - Date.parse(bt.generatedAt)) / 864e5;
            console.log(`[backtest] generatedAt ${bt.generatedAt} (${age.toFixed(1)}d old) · engine ${bt.engineVersion} · rows on version ${bt.rowsOnVersionPct}% · n ${bt.calibration.n}`);
            if (!(age <= 3)) { console.error("::error title=stale backtest::backtest.json generatedAt is older than 3 days"); process.exit(1); }
            const dead = Object.entries(bt.byMarket || {}).filter(([, v]) => (v.flagged.n + v.unflagged.n) === 0).map(([k]) => k);
            if (dead.length) { console.error(`::error title=empty byMarket::${dead.join(",")} carry n=0`); process.exit(1); }
          '
      - name: Push refreshed backtest.json (+ accumulator state)
        run: bash scripts/data-store.sh push-backtest
```

## 4 · Header comment

Replace the paragraph above the old `backtest:` job (the one beginning
`# The point-in-time backtest.`) with:

```yaml
  # The point-in-time backtest (Sep 2 2026): weekdays run the incremental append
  # (build-backtest-incremental.ts — rehydrates the sidecar state, scores only
  # never-attempted targets); Sunday runs the FULL replay as per-market legs
  # (backtest-leg matrix → build-backtest.ts --market) merged by the backtest
  # job (--merge). Every path applies the PRIOR quarter's calibration at score
  # time, so the record measures the engine production actually ran. BLOCKING:
  # a night that cannot produce a fresh record (script exit ≠ 0, or generatedAt
  # older than 3 days) fails the run. deploy does not depend on this job.
```

## 5 · Nothing else changes

`deploy` and `sync` keep `needs: assemble`. `scripts/data-store.sh push-backtest`
/ `pull-backtest` are unchanged (the state file keeps its name and location;
`triedIds`, `engineVersion`, and the per-row `id/sd/ev` fields are additive).
`close-board.yml` is unaffected (close-board.ts now imports the floor from
`app/lib/lanes`, no new inputs).

## 6 · First night after applying

1. Dispatch with `backtest_mode: full` once (any weekday) so every market's rows
   are re-scored on engine `2026.09.02-pit-cal`; until then `rowsOnVersionPct`
   in backtest.json reports the share still on the legacy labeler.
2. Confirm `byMarket.*.flagged.n > 0` for art/watches/design/science/culture/
   sports in the published record (the stale-record step also asserts this).
3. `meta.json.sentinel.signatures` lists every ≥15× repeat price with its
   honesty verdict — review the first night's list once.
