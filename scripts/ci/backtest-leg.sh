#!/usr/bin/env bash
# One FULL-replay backtest leg (nightly.yml backtest-leg matrix, Sundays).
#
#   bash scripts/ci/backtest-leg.sh <market> [leg-dir=data/backtest-legs]
#
# A market with NO TARGETS is legitimately empty — for ANY market, not just
# `other` (Sep 2026: tcg has 0 targets because Pokémon lots carry no house
# estimate, and the old "only other may be empty" rule failed the leg, so the
# Sunday merge never ran on Sep 13/20/27). Both engine behaviours count:
#   * old: build-backtest.ts throws "no targets" and exits 1
#   * new: it writes an explicit empty record and exits 0 (its summary has
#     n = 0, or `empty: true`, or it logs "no targets")
# Either way the leg exits 0 and drops an EMPTY.<market> marker in the leg
# dir, which the merge job uses to (a) know the leg finished on purpose and
# (b) exempt that market from the "byMarket n=0" freshness check. Any OTHER
# failure keeps its exit code — a broken leg must still block the merge.
set -uo pipefail
m="${1:?market}"
dir="${2:-data/backtest-legs}"
mkdir -p "$dir"
log=$(mktemp)
NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/build-backtest.ts --market "$m" --leg-dir "$dir" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}

empty=0
if grep -qi "no targets" "$log"; then
  empty=1
elif [ "$rc" -eq 0 ] && [ -f "$dir/backtest.$m.json" ]; then
  if node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const n = s?.calibration?.n ?? s?.n;
    process.exit(s?.empty === true || n === 0 ? 0 : 1);
  ' "$dir/backtest.$m.json"; then empty=1; fi
fi

if [ "$empty" -eq 1 ]; then
  echo "$m" > "$dir/EMPTY.$m"
  echo "::notice title=backtest leg ${m} empty::market ${m} has no replay targets — recorded as legitimately empty (engine rc ${rc})"
  exit 0
fi
if [ "$rc" -ne 0 ]; then
  echo "::error title=backtest leg ${m} failed::build-backtest.ts exited ${rc}"
  exit "$rc"
fi
[ -f "$dir/backtest-state.$m.json.gz" ] || { echo "::error title=backtest leg ${m}::exit 0 but no backtest-state.${m}.json.gz written"; exit 1; }
echo "[backtest-leg] ${m} ok"
