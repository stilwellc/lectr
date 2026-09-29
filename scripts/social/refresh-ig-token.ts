/**
 * Refresh the Instagram long-lived access token (docs/SOCIAL.md → Instagram).
 *
 * An App-Dashboard IG token lives 60 days. Instagram's refresh endpoint trades
 * a still-valid token (≥ 24 h old) for a fresh 60-day one:
 *   GET https://graph.instagram.com/refresh_access_token
 *       ?grant_type=ig_refresh_token&access_token=<current>
 * Run it weekly and the token never lapses.
 *
 *   IG_ACCESS_TOKEN=… npx tsx scripts/social/refresh-ig-token.ts            # refresh, write secret
 *   IG_ACCESS_TOKEN=… npx tsx scripts/social/refresh-ig-token.ts --dry-run  # refresh check only, no write
 *
 * Where the new token goes (first that applies):
 *   1. GH_TOKEN set  → `gh secret set IG_ACCESS_TOKEN --repo $GITHUB_REPOSITORY`
 *      (token piped on stdin, never argv). GITHUB_TOKEN CANNOT write secrets —
 *      the job needs a fine-grained PAT with "Secrets: read and write" on
 *      stilwellc/lectr, stored as a secret (e.g. IG_SECRET_WRITER_PAT) and
 *      passed as GH_TOKEN to this step only.
 *   2. --out=<file>  → written with mode 0600 (local runs).
 *   3. neither       → exits 1 without printing the token.
 *
 * The token is never printed. Under GitHub Actions both the old and the new
 * token are registered with ::add-mask:: before anything else runs, so even
 * an accidental echo is scrubbed from the log.
 *
 * Exit codes: 0 refreshed (or dry-run OK) · 1 misconfigured · 2 Instagram
 * refused (token expired/revoked — mint a new one in the App Dashboard).
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run') || process.env.DRY_RUN === '1';
const outArg = args.find(a => a.startsWith('--out='))?.slice('--out='.length);
const repo = process.env.GITHUB_REPOSITORY || 'stilwellc/lectr';
const old = (process.env.IG_ACCESS_TOKEN || '').trim();
const inActions = process.env.GITHUB_ACTIONS === 'true';

const mask = (v: string) => { if (inActions && v) console.log(`::add-mask::${v}`); };
const scrub = (s: string) => (old ? s.split(old).join('[redacted]') : s).replace(/access_token=[^&\s"']+/g, 'access_token=[redacted]');

async function main() {
  if (!old) { console.error('[ig-refresh] IG_ACCESS_TOKEN is not set'); process.exit(1); }
  mask(old);

  const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: old });
  let r: Response;
  try {
    r = await fetch(`https://graph.instagram.com/refresh_access_token?${q}`);
  } catch (e) {
    console.error('[ig-refresh] network error:', scrub((e as Error).message));
    process.exit(2);
  }
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string; code?: number } };
  if (!r.ok || !j.access_token) {
    console.error(`[ig-refresh] Instagram refused the refresh (${r.status}): ${scrub(j.error?.message || 'no token in response')}`);
    console.error('[ig-refresh] if the token already expired, mint a new one in the App Dashboard (docs/SOCIAL.md) and set IG_ACCESS_TOKEN by hand.');
    process.exit(2);
  }
  const fresh = j.access_token;
  mask(fresh);
  const days = j.expires_in ? Math.round(j.expires_in / 86400) : null;
  console.log(`[ig-refresh] refreshed — new token valid ~${days ?? '?'} days${fresh === old ? ' (Instagram returned the same token string)' : ''}`);

  if (DRY) { console.log('[ig-refresh] dry run — new token NOT stored'); return; }

  if (process.env.GH_TOKEN) {
    const res = spawnSync('gh', ['secret', 'set', 'IG_ACCESS_TOKEN', '--repo', repo], { input: fresh, encoding: 'utf8' });
    if (res.status !== 0) {
      console.error(`[ig-refresh] gh secret set failed: ${scrub(String(res.stderr || res.error || '')).split(fresh).join('[redacted]')}`);
      console.error('[ig-refresh] the refreshed token is NOT stored; the old one stays valid until its own expiry — fix GH_TOKEN and re-run.');
      process.exit(1);
    }
    console.log(`[ig-refresh] IG_ACCESS_TOKEN updated on ${repo}`);
    return;
  }
  if (outArg) {
    fs.writeFileSync(outArg, fresh + '\n', { mode: 0o600 });
    console.log(`[ig-refresh] new token written to ${outArg} (0600) — paste it into the IG_ACCESS_TOKEN secret, then delete the file`);
    return;
  }
  console.error('[ig-refresh] refreshed but nowhere to store it: set GH_TOKEN (PAT with secrets:write) or pass --out=<file>');
  process.exit(1);
}

main().catch(e => { console.error('[ig-refresh]', scrub(String((e as Error)?.message || e))); process.exit(1); });
