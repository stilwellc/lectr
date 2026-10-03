#!/usr/bin/env node
// Aggregate the nightly crawl legs' leg-health.json files into the job summary
// and ANNOTATE every leg that reported ok=false. Since Oct 3 2026 this is
// WARN-ONLY by default (exit 0): a sick house no longer reddens the run — the
// run's red means "did not publish"; house health rides the per-house ledger,
// its rolling issue and status.json (docs/RUNBOOK.md). --strict restores the
// old exit 1 on any ok=false.
//
//   node scripts/ci/leg-health-summary.mjs <dir> [expected houses, comma-sep] [--strict]
//
// Several records for one house are MERGED (ok = AND, reasons joined): the
// crawl leg writes leg-health.json, and the per-house shrink gate in
// data-store.sh push-segment writes data/qa/leg-health-gate.json.
//
// <dir> holds the downloaded `health-<house>` artifacts (any depth; every
// *.json with a `house` field counts). Record shape (written by each leg):
//   { house, ok, fetched, parsed, settled, reason }
// A house in the expected list with no record is reported as "no record"
// (a crashed leg, or a crawler that does not emit one yet) — a warning, not
// a failure: the crawl job itself is already red when a leg crashes.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'health';
const strict = process.argv.includes('--strict');
const expected = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '').split(',').map(s => s.trim()).filter(Boolean);

function walk(d, out) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const recs = new Map();
for (const f of walk(dir, [])) {
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const r of Array.isArray(j) ? j : [j]) {
      if (!r || typeof r.house !== 'string') continue;
      const prev = recs.get(r.house);
      if (!prev) { recs.set(r.house, r); continue; }
      const reasons = [...new Set([prev.reason, r.reason].filter(Boolean))];
      recs.set(r.house, { ...prev, ok: prev.ok === true && r.ok === true, reason: reasons.join(' | ') || null });
    }
  } catch (e) {
    console.log(`::warning title=leg-health unreadable::${f}: ${e.message}`);
  }
}

const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const num = v => (typeof v === 'number' ? v.toLocaleString('en-US') : '—');
const houses = [...new Set([...expected, ...recs.keys()])].sort();
const bad = [];
const missing = [];
const rows = houses.map(h => {
  const r = recs.get(h);
  if (!r) { missing.push(h); return `| ${h} | ⚪ no record | — | — | — | |`; }
  const ok = r.ok === true;
  if (!ok) bad.push(h);
  return `| ${h} | ${ok ? '🟢 ok' : '🔴 FAIL'} | ${num(r.fetched)} | ${num(r.parsed)} | ${num(r.settled)} | ${esc(r.reason)} |`;
});

const md = [
  '## Crawl leg health',
  '',
  bad.length ? `**${bad.length} leg(s) not ok:** ${bad.join(', ')}` : recs.size ? 'All reporting legs ok.' : '_No leg-health records were produced._',
  '',
  '| house | status | fetched | parsed | settled | reason |',
  '| --- | --- | ---: | ---: | ---: | --- |',
  ...rows,
  '',
].join('\n');

console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
if (missing.length) console.log(`::warning title=leg-health missing::no leg-health.json from ${missing.join(', ')}`);
for (const h of bad) {
  const r = recs.get(h);
  console.log(`::${strict ? 'error' : 'warning'} title=crawl leg ${h} not ok::${esc(r.reason) || 'ok=false'} (fetched ${num(r.fetched)}, parsed ${num(r.parsed)}, settled ${num(r.settled)})`);
}
process.exit(strict && bad.length ? 1 : 0);
