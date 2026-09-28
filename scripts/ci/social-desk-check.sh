#!/usr/bin/env bash
# The social desk runs DRY (prints the copy, posts nothing) when its
# credentials are absent — which used to be silent: the desk sat dry for
# weeks (Sep 2026) with every run green. Now a missing set is a ::warning::
# plus a job-summary line. Never fails: a dry desk must not redden a deploy.
# Reads X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET and
# IG_USER_ID / IG_ACCESS_TOKEN from the environment (never prints values).
set -u
missing_x=() missing_ig=()
for v in X_API_KEY X_API_SECRET X_ACCESS_TOKEN X_ACCESS_SECRET; do [ -n "${!v:-}" ] || missing_x+=("$v"); done
for v in IG_USER_ID IG_ACCESS_TOKEN; do [ -n "${!v:-}" ] || missing_ig+=("$v"); done
say() {
  echo "::warning title=social desk dry::$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- ⚠️ $1" >> "$GITHUB_STEP_SUMMARY"; fi
}
[ "${#missing_x[@]}" -eq 0 ] || say "X is DRY — no post will be made (missing repo secrets: ${missing_x[*]})"
[ "${#missing_ig[@]}" -eq 0 ] || say "Instagram is DRY — no post will be made (missing repo secrets: ${missing_ig[*]})"
exit 0
