/**
 * gate-replay.ts — replay the engine gate (validate-engine G1–G4) over the
 * archived nightly reports under CURRENT and PROPOSED thresholds, and print
 * which nights would flip. The evidence every threshold change must carry
 * (docs/RUNBOOK.md "Engine-gate policy").
 *
 * Sources (any mix; deduped by the report's generatedAt):
 *   --dir <dir>   every *.json validate-engine report under <dir>
 *   --r2          `data-store.sh pull-gate-reports` (R2 qa/validate-engine/,
 *                 archived nightly since Oct 3 2026) → data/qa/gate-reports
 *   --gh          the `validate-engine` artifacts of the last nightly runs
 *                 (`gh run download`; GitHub keeps them 14 days)
 * Proposal: --set g1.spreadMin=8 --set g2.dipBlocks=false … (dot paths into
 *   scripts/ci/gate-thresholds.ts CURRENT_GATE). --nights 30 (default).
 *   --fail-on-flip exits 1 when any night flips (for CI).
 *
 * Replayable: G1 global spread/dips, G2 per-market spread/dips, G3 tier
 * honesty, G4 coverage — all recomputed from the report's raw bucket counts.
 * G5 (live forward check) is NOT in the report's raw data: its recorded
 * failures carry through unchanged and are labelled so.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { CURRENT_GATE, type GateThresholds } from './gate-thresholds';

type Buckets = Record<string, { beat: number; n: number }>;
export interface ValidateReport {
  generatedAt: string;
  coveragePct: number;
  signal?: string;
  global: { buckets: Buckets };
  byMarket: Record<string, { signal: Buckets; tiers: Record<string, { n: number; medErr: number | null }> }>;
  failures: string[];
  warnings: string[];
}

const BUCKETS = ['<0.6', '0.6-0.9', '0.9-1.3', '1.3-2', '>2'];

function monotonic(sig: Buckets, t: GateThresholds) {
  const seen: { b: string; rate: number; n: number }[] = [];
  const dips: string[] = [];
  for (const b of BUCKETS) {
    const s = sig?.[b];
    if (!s || s.n < t.minN) continue;
    const rate = s.beat / s.n * 100;
    for (const prev of seen) {
      const p1 = prev.rate / 100, p2 = rate / 100;
      const se = 100 * Math.sqrt(Math.max(1e-6, p1 * (1 - p1) / prev.n + p2 * (1 - p2) / s.n));
      const tol = Math.max(t.dipFloorPt, t.dipSe * se);
      if (rate + tol < prev.rate) dips.push(`${prev.b} ${prev.rate.toFixed(0)}% → ${b} ${rate.toFixed(0)}%`);
    }
    seen.push({ b, rate, n: s.n });
  }
  return { ok: dips.length === 0, dips, spread: seen.length >= 2 ? seen[seen.length - 1].rate - seen[0].rate : null, measured: seen.length };
}

/** Re-evaluate one report. Returns the blocking failures (G1–G4 recomputed,
 *  G5 carried from the record) and warnings. */
export function replayReport(r: ValidateReport, t: GateThresholds): { failures: string[]; warnings: string[]; signal: string } {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const [m, d] of Object.entries(r.byMarket || {})) {
    const hi = d.tiers?.high?.n >= t.minN ? d.tiers.high.medErr : null;
    const lo = d.tiers?.low?.n >= t.minN ? d.tiers.low.medErr : null;
    if (hi != null) {
      if (hi >= t.g3.highMaxMedErr) failures.push(`G3 ${m}: high medErr ${hi.toFixed(2)}×`);
      if (t.g3.highMustBeatLow && lo != null && hi > lo) failures.push(`G3 ${m}: tiers inverted`);
    }
    const mono = monotonic(d.signal, t);
    if (mono.measured >= 2) {
      if (!mono.ok) (t.g2.dipBlocks ? failures : warnings).push(`G2 ${m}: dip ${mono.dips.join('; ')}`);
      if (mono.spread != null && mono.spread < t.g2.spreadMin) failures.push(`G2 ${m}: spread ${mono.spread.toFixed(0)}pt`);
    }
  }
  const g = monotonic(r.global?.buckets, t);
  if (!g.ok) (t.g1.dipBlocks ? failures : warnings).push(`G1 global: dip ${g.dips.join('; ')}`);
  if (g.spread != null && g.spread < t.g1.spreadMin) failures.push(`G1 global: spread ${g.spread.toFixed(0)}pt`);
  if ((r.coveragePct ?? 100) < t.g4.minCoveragePct) failures.push(`G4 coverage ${r.coveragePct}%`);
  for (const f of r.failures || []) if (f.startsWith('G5')) failures.push(`${f} [G5 carried from record]`);
  const signal = g.spread != null && g.spread >= t.g1.spreadMin ? (g.ok ? 'validated' : 'degraded') : 'failed';
  return { failures, warnings, signal };
}

/** Apply `a.b=value` overrides to a deep copy of the thresholds. */
export function applyOverrides(base: GateThresholds, sets: string[]): GateThresholds {
  const t = JSON.parse(JSON.stringify(base));
  for (const s of sets) {
    const m = s.match(/^([\w.]+)=(.+)$/);
    if (!m) throw new Error(`bad --set ${s} (want path=value)`);
    const keys = m[1].split('.');
    let o = t;
    for (const k of keys.slice(0, -1)) { if (!(k in o)) throw new Error(`unknown threshold ${m[1]}`); o = o[k]; }
    const last = keys[keys.length - 1];
    if (!(last in o)) throw new Error(`unknown threshold ${m[1]}`);
    o[last] = m[2] === 'true' ? true : m[2] === 'false' ? false : Number(m[2]);
    if (typeof o[last] === 'number' && !Number.isFinite(o[last])) throw new Error(`bad number in --set ${s}`);
  }
  return t;
}

export function replayAll(reports: ValidateReport[], current: GateThresholds, proposed: GateThresholds) {
  return reports.map(r => {
    const cur = replayReport(r, current);
    const pro = replayReport(r, proposed);
    const recordedNonG5 = (r.failures || []).filter(f => !f.startsWith('G5')).length;
    const replayNonG5 = cur.failures.filter(f => !f.startsWith('G5')).length;
    return {
      night: r.generatedAt,
      recorded: (r.failures || []).length ? 'FAIL' : 'PASS',
      current: cur.failures.length ? 'FAIL' : 'PASS',
      proposed: pro.failures.length ? 'FAIL' : 'PASS',
      flips: (cur.failures.length > 0) !== (pro.failures.length > 0),
      signalFlip: cur.signal !== pro.signal ? `${cur.signal} → ${pro.signal}` : null,
      // the report was written by a different gate version than CURRENT_GATE
      drift: recordedNonG5 !== replayNonG5,
      newFailures: pro.failures.filter(f => !cur.failures.includes(f)),
      cleared: cur.failures.filter(f => !pro.failures.includes(f)),
    };
  });
}

function collect(dir: string, out: ValidateReport[]) {
  let es: fs.Dirent[];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (e.name.endsWith('.json')) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j && j.generatedAt && j.global && j.byMarket) out.push(j);
      } catch { /* not a report */ }
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const sets: string[] = [];
  argv.forEach((a, i) => { if (a === '--set' && argv[i + 1]) sets.push(argv[i + 1]); });
  const nights = Number(val('nights') || 30);
  const reports: ValidateReport[] = [];
  if (argv.includes('--r2')) {
    execFileSync('bash', ['scripts/data-store.sh', 'pull-gate-reports', 'data/qa/gate-reports', String(nights)], { stdio: 'inherit' });
    collect('data/qa/gate-reports', reports);
  }
  if (argv.includes('--gh')) {
    const runs = JSON.parse(execFileSync('gh', ['run', 'list', '--workflow', 'nightly.yml', '--limit', String(nights), '--json', 'databaseId'], { encoding: 'utf8' })) as { databaseId: number }[];
    for (const { databaseId } of runs) {
      const d = path.join('data', 'qa', 'gate-reports', `gh-${databaseId}`);
      if (fs.existsSync(d)) continue;
      try { execFileSync('gh', ['run', 'download', String(databaseId), '-n', 'validate-engine', '-D', d], { stdio: 'ignore' }); } catch { /* run had no report (expired, or assemble died first) */ }
    }
    collect(path.join('data', 'qa', 'gate-reports'), reports);
  }
  const dir = val('dir');
  if (dir) collect(dir, reports);
  const byNight = new Map<string, ValidateReport>();
  for (const r of reports) byNight.set(r.generatedAt, r);
  const sorted = Array.from(byNight.values()).sort((a, b) => (a.generatedAt < b.generatedAt ? -1 : 1)).slice(-nights);
  if (!sorted.length) { console.error('[gate-replay] no reports found (use --dir, --r2 or --gh)'); process.exit(2); }

  const proposed = applyOverrides(CURRENT_GATE, sets);
  const rows = replayAll(sorted, CURRENT_GATE, proposed);
  const flips = rows.filter(r => r.flips);
  const md = [
    `## Engine gate replay — ${rows.length} night(s)`,
    '',
    sets.length ? `Proposed: \`${sets.join(' ')}\`` : '_No --set given: proposed = current (a drift check only)._',
    '',
    '| night | recorded | current | proposed | flip | signal | changed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(r => `| ${r.night.slice(0, 16).replace('T', ' ')} | ${r.recorded} | ${r.current}${r.drift ? ' ⚠drift' : ''} | ${r.proposed} | ${r.flips ? '**FLIPS**' : ''} | ${r.signalFlip || ''} | ${[...r.newFailures.map(f => `+${f}`), ...r.cleared.map(f => `−${f}`)].join('<br>').replace(/\|/g, '\\|')} |`),
    '',
    `**${flips.length} night(s) flip** publish verdict under the proposal.${rows.some(r => r.drift) ? ' ⚠drift = the report was written by a different gate version than CURRENT_GATE (recorded ≠ replayed).' : ''}`,
    '',
  ].join('\n');
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  const out = val('json');
  if (out) fs.writeFileSync(out, JSON.stringify({ proposed: sets, rows }, null, 2));
  if (argv.includes('--fail-on-flip') && flips.length) process.exit(1);
}

if (process.env.RAY_SKIP_MAIN !== '1') main();
