/**
 * lectr-cron-trigger — an ON-TIME clock for lectr's scheduled workflows.
 *
 * GitHub's `schedule:` trigger runs late, unpredictably (the nightly's old
 * 06:00 cron started 11:20–11:50 UTC through Sep 2026). Cloudflare Cron
 * Triggers fire on the minute, so this Worker owns the clock and calls the
 * GitHub workflow_dispatch API at the intended times, with
 * `trigger: cron-worker` (each workflow titles its run with it).
 *
 * The workflows keep their GitHub cron as a FALLBACK, a little after the
 * Worker's minute; scripts/ci/run-guard.mjs makes the fallback skip itself
 * when a cron-worker run already started (no double publish).
 *
 * Secrets (wrangler secret put …, or the cron-trigger-deploy workflow):
 *   GITHUB_DISPATCH_TOKEN  fine-grained PAT, repository stilwellc/lectr only,
 *                          permission "Actions: Read and write" (nothing else)
 * Vars (wrangler.toml [vars]): GITHUB_REPO, GITHUB_REF.
 *
 * GET /  → the schedule (no secrets) — a liveness check.
 */

export interface Env {
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_REF?: string;
}

export interface Dispatch {
  workflow: string;
  inputs: Record<string, string>;
}

/** cron expression (exactly as in wrangler.toml) → the workflows to dispatch. */
export const SCHEDULE: Record<string, Dispatch[]> = {
  // the nightly: crawl → assemble → publish (~2–3h). 04:17 UTC = ~00:17 ET.
  '17 4 * * *': [{ workflow: 'nightly.yml', inputs: { trigger: 'cron-worker' } }],
  // the intraday close-day board, every 4h, clear of the nightly's start
  '43 2,6,10,14,18,22 * * *': [{ workflow: 'close-board.yml', inputs: { trigger: 'cron-worker' } }],
};

export function plan(cron: string): Dispatch[] {
  return SCHEDULE[cron] || [];
}

export async function dispatch(env: Env, d: Dispatch, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; status: number; body: string }> {
  const repo = env.GITHUB_REPO || 'stilwellc/lectr';
  if (!env.GITHUB_DISPATCH_TOKEN) return { ok: false, status: 0, body: 'GITHUB_DISPATCH_TOKEN secret is not set' };
  const r = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${d.workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lectr-cron-trigger',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: env.GITHUB_REF || 'main', inputs: d.inputs }),
  });
  // 204 No Content = queued
  return { ok: r.status === 204, status: r.status, body: r.status === 204 ? '' : (await r.text()).slice(0, 300) };
}

interface ScheduledController { cron: string; scheduledTime: number }
interface ExecutionContext { waitUntil(p: Promise<unknown>): void }

const worker = {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const work = (async () => {
      const ds = plan(controller.cron);
      if (!ds.length) { console.log(`[cron-trigger] no dispatch mapped for cron '${controller.cron}'`); return; }
      for (const d of ds) {
        // one retry on a 5xx / network blip; a 4xx (bad token, bad input) is final
        let res = await dispatch(env, d).catch(e => ({ ok: false, status: -1, body: String(e) }));
        if (!res.ok && (res.status >= 500 || res.status === -1)) {
          await new Promise(r => setTimeout(r, 15000));
          res = await dispatch(env, d).catch(e => ({ ok: false, status: -1, body: String(e) }));
        }
        // a failed dispatch throws → the invocation shows as an error in the
        // Worker's Cron Events log; the GitHub cron fallback still covers the night
        if (!res.ok) throw new Error(`[cron-trigger] dispatch ${d.workflow} failed: ${res.status} ${res.body}`);
        console.log(`[cron-trigger] dispatched ${d.workflow} (${JSON.stringify(d.inputs)}) for cron '${controller.cron}'`);
      }
    })();
    ctx.waitUntil(work);
    await work;
  },
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ worker: 'lectr-cron-trigger', schedule: SCHEDULE }, null, 2), { headers: { 'content-type': 'application/json' } });
  },
};

export default worker;
