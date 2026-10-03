#!/usr/bin/env node
// run-guard.mjs — the DOUBLE-RUN guard between the two triggers of a
// scheduled workflow: the Cloudflare cron-trigger Worker (on time; dispatches
// with trigger=cron-worker, so the run is titled "… · cron-worker") and the
// GitHub `schedule:` cron kept as a FALLBACK (often hours late).
//
// The fallback run asks: did a Worker-triggered run of this workflow start in
// the last N hours? If yes → skip (go=false); the Worker already covered the
// night. If the Worker never fired (no PAT yet, Worker down), the fallback
// runs as before. A Worker run applies the same check against other Worker
// runs (a retried cron must not double-publish). Manual dispatches never skip.
//
//   node scripts/ci/run-guard.mjs --workflow nightly.yml --hours 20 --event schedule|workflow_dispatch --trigger <inputs.trigger>
//   → writes go=true|false (+ reason) to $GITHUB_OUTPUT
//
// Env: GITHUB_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID.
// Fails OPEN: any API error → go=true (a missed night is worse than a double).
import fs from 'node:fs';

export const WORKER_MARK = 'cron-worker';

/** Pure decision. runs: [{ id, display_title, created_at, conclusion, status }] */
export function shouldSkip({ runs, nowMs, currentId, windowH, event, trigger }) {
  const automated = event === 'schedule' || trigger === WORKER_MARK;
  if (!automated) return { skip: false, reason: 'manual dispatch — never skipped' };
  const cut = nowMs - windowH * 3600e3;
  const prior = runs.find(r =>
    String(r.id) !== String(currentId) &&
    String(r.display_title || '').includes(WORKER_MARK) &&
    Date.parse(r.created_at) >= cut &&
    Date.parse(r.created_at) <= nowMs &&
    r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
  if (prior) return { skip: true, reason: `run ${prior.id} (${prior.display_title}) started ${prior.created_at} — within ${windowH}h` };
  return { skip: false, reason: `no cron-worker run in the last ${windowH}h` };
}

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };

async function main() {
  const wf = arg('workflow');
  const windowH = Number(arg('hours', '20'));
  const event = arg('event', process.env.GITHUB_EVENT_NAME || '');
  const trigger = arg('trigger');
  const out = (go, reason) => {
    console.log(`[run-guard] ${wf}: go=${go} — ${reason}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `go=${go}\n`);
    if (process.env.GITHUB_STEP_SUMMARY && !go) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Skipped (double-run guard):** ${reason}\n`);
  };
  if (event !== 'schedule' && trigger !== WORKER_MARK) return out(true, 'manual dispatch — never skipped');
  try {
    const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/${wf}/runs?per_page=30`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!r.ok) throw new Error(`runs API ${r.status}`);
    const runs = (await r.json()).workflow_runs || [];
    const v = shouldSkip({ runs, nowMs: Date.now(), currentId: process.env.GITHUB_RUN_ID, windowH, event, trigger });
    out(!v.skip, v.reason);
  } catch (e) {
    console.log(`::warning title=run-guard failed open::${e.message} — running`);
    out(true, 'guard unavailable — failing open');
  }
}

if (process.env.RAY_SKIP_MAIN !== '1') main();
