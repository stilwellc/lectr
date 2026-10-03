#!/usr/bin/env node
// ops-issues.mjs — the nightly's two kinds of GitHub issue, so a red run and
// a sick house are never the same signal:
//
//   publish   ONE issue titled "lectr: publish missed". Opened (or commented
//             on, if already open) when a SCHEDULED night — the GitHub cron or
//             the Cloudflare cron-trigger Worker — fails to publish. Closed
//             automatically by the next successful publish (any trigger).
//   houses    ONE rolling issue PER HOUSE titled "lectr: house <house> unhealthy".
//             Opened when the house is not ok, its body rewritten each night
//             with the current state (no comment spam), closed with a comment
//             the first night it is ok again.
//
//   node scripts/ci/ops-issues.mjs publish --published true|false --scheduled true|false
//   node scripts/ci/ops-issues.mjs houses  --ledger data/qa/house-ledger.json [--houses a,b]
//
// Env: GITHUB_TOKEN (issues: write — granted ONLY to the nightly's verdict
// job), GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL. OPS_ISSUES_DRY=1
// prints the plan without calling the API.
import fs from 'node:fs';

export const PUBLISH_TITLE = 'lectr: publish missed';
export const houseTitle = h => `lectr: house ${h} unhealthy`;

/** What to do with the publish issue. */
export function planPublish({ published, scheduled, open }) {
  if (published) return open ? 'close' : 'none';
  if (!scheduled) return 'none';              // a manual/recovery run never pages
  return open ? 'comment' : 'open';
}

/** What to do with one house's issue. */
export function planHouse({ ok, open }) {
  if (ok) return open ? 'close' : 'none';
  return open ? 'update' : 'open';
}

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };

function api() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const dry = process.env.OPS_ISSUES_DRY === '1' || !token || !repo;
  if (dry && !process.env.OPS_ISSUES_DRY) console.log('::warning title=ops-issues::no GITHUB_TOKEN/GITHUB_REPOSITORY — dry run');
  const call = async (method, path, body) => {
    if (dry && method !== 'GET') { console.log(`[ops-issues] DRY ${method} ${path} ${body ? JSON.stringify(body).slice(0, 160) : ''}`); return {}; }
    if (dry) return [];
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? {} : r.json();
  };
  return { call, dry };
}

async function openIssuesByTitle(call) {
  const out = new Map();
  for (let page = 1; page <= 10; page++) {
    const xs = await call('GET', `/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(xs) || !xs.length) break;
    for (const i of xs) if (!i.pull_request && i.title.startsWith('lectr: ')) out.set(i.title, i.number);
    if (xs.length < 100) break;
  }
  return out;
}

const runUrl = () => `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID || ''}`;

async function publish() {
  const published = arg('published') === 'true';
  const scheduled = arg('scheduled') === 'true';
  const { call } = api();
  const open = (await openIssuesByTitle(call)).get(PUBLISH_TITLE);
  const plan = planPublish({ published, scheduled, open: open != null });
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  console.log(`[ops-issues] publish: published=${published} scheduled=${scheduled} open=#${open ?? '-'} → ${plan}`);
  const body = `The scheduled nightly did **not** publish (${when}).\n\nRun: ${runUrl()}\n\nThe site is still serving the last good publish. Recovery: docs/RUNBOOK.md → "Publish missed".\n\n_This issue closes itself on the next successful publish._`;
  if (plan === 'open') await call('POST', '/issues', { title: PUBLISH_TITLE, body });
  else if (plan === 'comment') await call('POST', `/issues/${open}/comments`, { body: `Missed again — ${when}. Run: ${runUrl()}` });
  else if (plan === 'close') {
    await call('POST', `/issues/${open}/comments`, { body: `Published — ${when}. Run: ${runUrl()}. Closing.` });
    await call('PATCH', `/issues/${open}`, { state: 'closed', state_reason: 'completed' });
  }
}

async function houses() {
  const ledgerFile = arg('ledger', 'data/qa/house-ledger.json');
  if (!fs.existsSync(ledgerFile)) { console.log(`[ops-issues] no ledger at ${ledgerFile} — house issues untouched tonight`); return; }
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  const only = arg('houses').split(',').map(s => s.trim()).filter(Boolean);
  const names = only.length ? only : Object.keys(ledger.houses || {});
  const { call } = api();
  const open = await openIssuesByTitle(call);
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  for (const h of names) {
    const e = ledger.houses?.[h];
    if (!e) continue;
    const title = houseTitle(h);
    const num = open.get(title);
    const plan = planHouse({ ok: !!e.ok, open: num != null });
    if (plan === 'none') continue;
    console.log(`[ops-issues] ${h}: ok=${e.ok} open=#${num ?? '-'} → ${plan}`);
    const body = [
      `**${h}** has not crawled cleanly. The site keeps serving its last-good segment; after 48h without a successful crawl its live lots are hidden (status.json \`staleHidden\`).`,
      '',
      `| | |`, `| --- | --- |`,
      `| last checked | ${when} ([run](${runUrl()})) |`,
      `| reason | ${String(e.reason || 'not ok').replace(/\|/g, '\\|')} |`,
      `| failing nights in a row | ${e.failStreak ?? '?'} |`,
      `| last successful crawl | ${e.lastOkAt || 'never recorded'} |`,
      `| segment tonight | ${e.source} |`,
      '',
      'Recovery: docs/RUNBOOK.md → "A house is down". _This issue updates nightly and closes itself when the house crawls OK._',
    ].join('\n');
    if (plan === 'open') await call('POST', '/issues', { title, body });
    else if (plan === 'update') await call('PATCH', `/issues/${num}`, { body });
    else if (plan === 'close') {
      await call('POST', `/issues/${num}/comments`, { body: `${h} crawled OK — ${when} ([run](${runUrl()})). Closing.` });
      await call('PATCH', `/issues/${num}`, { state: 'closed', state_reason: 'completed' });
    }
  }
}

if (process.env.RAY_SKIP_MAIN !== '1') {
  const cmd = process.argv[2];
  const run = cmd === 'publish' ? publish() : cmd === 'houses' ? houses() : Promise.reject(new Error('usage: ops-issues.mjs publish|houses'));
  // never redden the night over issue bookkeeping — warn instead
  run.catch(e => { console.log(`::warning title=ops-issues failed::${e.message}`); });
}
