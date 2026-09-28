#!/usr/bin/env bash
# Sunday merge of the per-market backtest legs (nightly.yml `backtest` job).
#
#   bash scripts/ci/backtest-merge.sh <leg-dir> <market,market,…>
#
# Every expected market must have EITHER a leg state
# (backtest-state.<m>.json.gz) OR an EMPTY.<m> marker (scripts/ci/backtest-leg.sh
# found no targets). Anything else means a leg's output went missing — refuse,
# a partial record is never published. The merge is then told exactly which
# markets carry state (--markets), so an empty market can neither fail the
# engine's "missing leg" guard nor be required to exist.
# Writes the empty-market list to $GITHUB_OUTPUT as `empty=<csv>` for the
# freshness check that follows.
set -euo pipefail
dir="${1:?leg dir}"
expected="${2:?markets csv}"

# The leg matrix is a literal list in nightly.yml; the engine's roster is the
# truth. Passing --markets bypasses the engine's own "every market has a leg"
# guard, so re-assert it here: a roster market with no matrix leg would
# otherwise drop out of the record silently.
roster=$(npx tsx -e 'import { backtestMarkets } from "./scripts/build-backtest"; console.log(backtestMarkets().join(" "))')
for r in $roster; do
  case ",${expected}," in
    *",$r,"*) ;;
    *) echo "::error title=backtest merge::roster market '$r' has no leg in nightly.yml's backtest-leg matrix — add it"; exit 1 ;;
  esac
done

with_state="" empty="" lost=""
for m in ${expected//,/ }; do
  # an engine that writes an explicit EMPTY record leaves both a state and the
  # marker: merge the state, and still exempt the market from the n=0 check
  [ -f "$dir/EMPTY.$m" ] && empty="${empty:+$empty,}$m"
  if [ -f "$dir/backtest-state.$m.json.gz" ]; then with_state="${with_state:+$with_state,}$m"
  elif [ ! -f "$dir/EMPTY.$m" ]; then lost="${lost:+$lost,}$m"; fi
done
if [ -n "$lost" ]; then
  echo "::error title=backtest merge::no leg output for ${lost} — refusing to publish a partial record"
  exit 1
fi
[ -n "$with_state" ] || { echo "::error title=backtest merge::every leg is empty — nothing to merge"; exit 1; }
echo "[backtest] FULL — merging legs: ${with_state}${empty:+ · empty: $empty}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "empty=${empty}" >> "$GITHUB_OUTPUT"; fi
NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/build-backtest.ts --merge --leg-dir "$dir" --markets "$with_state"
