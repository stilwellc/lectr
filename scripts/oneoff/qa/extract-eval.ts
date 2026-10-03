/**
 * extract-eval.ts — offline evaluation of the LLM extraction layer against the
 * regex parsers, and its engine impact, on a stratified corpus sample.
 *
 *   # live (needs ANTHROPIC_API_KEY; ~300 Haiku calls ≈ $0.40 at list price):
 *   npx tsx scripts/oneoff/qa/extract-eval.ts --n 300 --record data/qa/extract-eval-responses.json
 *   # replay a recorded run (no key, no network):
 *   npx tsx scripts/oneoff/qa/extract-eval.ts --fixtures data/qa/extract-eval-responses.json
 *   # options: --corpus <dir with lots.json.gz + sold-archive.json.gz> (default data/corpus)
 *   #          --json <out> (default data/qa/extract-eval.json) · --seed <int> · --concurrency <int>
 *
 * Sample: n/3 sports/graded cards, n/3 Pokémon, n/3 tracked-maker watches;
 * within each, half the regex could NOT key (fill rate) and half it did
 * (agreement rate), sold lots only (so there is a realized price to score).
 *
 * Reports:
 *   · per field: regex-only / llm-only / both-agree / both-disagree (+ examples);
 *   · validation: schema rejections, grounding nulls;
 *   · ENGINE IMPACT (regex vs regex+llm, the advisory merge the build uses):
 *       cards   — exact-tier coverage (a same-key sale in the prior year) and
 *                 the exact-tier ±30% hit rate of that pool's median vs realized;
 *       pokémon — keyed % and exact-pool coverage;
 *       watches — reference % and same-reference pool coverage (the
 *                 'no-candidates' abstention class).
 * The pools are the REGEX-keyed corpus (the sample's own merged key is looked
 * up in it) — a lower bound: tonight's pools also grow by every llm-keyed sale.
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { readGzRows } from '../../corpus-io';
import { parseCard, cardKey } from '../../../app/lib/cards';
import { pokemonKey } from '../../sub-markets';
import type { AuctionLot } from '../../../app/types';
import { extractParams, messageJson } from '../../lib/extract/batch';
import { validateExtraction, type Extraction } from '../../lib/extract/schema';
import { hashText } from '../../lib/extract/cache';
import { extractModel, env } from '../../lib/extract/config';
import { mergeCardExtract, pokemonKeyFromExtract, toLotExtract, WATCH_SLUGS_X } from '../../lib/extract/apply';
import { targetKind, regexKeyed, type TargetKind } from '../../lib/extract/select';

type Lot = AuctionLot & Record<string, unknown>;
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function sample<T>(a: T[], k: number, r: () => number): T[] {
  const c = a.slice();
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
  return c.slice(0, k);
}
const median = (v: number[]) => { const s = v.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const YEAR_MS = 31_557_600_000;

async function main() {
  const corpusDir = arg('--corpus', path.join(process.cwd(), 'data', 'corpus'))!;
  const n = parseInt(arg('--n', '300')!, 10);
  const seed = parseInt(arg('--seed', '1')!, 10);
  const conc = parseInt(arg('--concurrency', '8')!, 10);
  const fixturesPath = arg('--fixtures');
  const recordPath = arg('--record');
  const outPath = arg('--json', path.join(process.cwd(), 'data', 'qa', 'extract-eval.json'))!;
  const live = !fixturesPath && env('ANTHROPIC_API_KEY') !== '';
  if (!fixturesPath && !live) {
    console.log('[extract-eval] LLM extraction off (no ANTHROPIC_API_KEY and no --fixtures) — nothing to evaluate');
    return;
  }
  process.env.RAY_EXTRACT_APPLY = '1'; // the advisory merges read the same gate the build does
  const fixtures: Record<string, unknown> = fixturesPath ? JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) : {};
  const fx = (fixtures as { extract?: Record<string, unknown> }).extract ?? fixtures;

  console.log(`[extract-eval] reading corpus ${corpusDir}…`);
  const all = [...readGzRows(path.join(corpusDir, 'lots.json.gz')), ...readGzRows(path.join(corpusDir, 'sold-archive.json.gz'))] as Lot[];
  const sold = all.filter(l => l.status === 'sold' && Number(l.realizedUsd ?? l.priceUsd) > 0 && l.saleDate);

  // ── stratified sample ──
  const r = rng(seed);
  const strata: Record<TargetKind, { keyed: Lot[]; unkeyed: Lot[] }> = { card: { keyed: [], unkeyed: [] }, pokemon: { keyed: [], unkeyed: [] }, watch: { keyed: [], unkeyed: [] } };
  for (const l of sold) {
    const k = targetKind(l);
    if (!k || (fixturesPath && fx[String(l.title)] === undefined)) continue;
    (regexKeyed(l, k) ? strata[k].keyed : strata[k].unkeyed).push(l);
  }
  const per = Math.floor(n / 3);
  const picked: { l: Lot; kind: TargetKind }[] = [];
  for (const k of ['card', 'pokemon', 'watch'] as TargetKind[]) {
    const u = sample(strata[k].unkeyed, Math.ceil(per / 2), r), kk = sample(strata[k].keyed, per - Math.min(u.length, Math.ceil(per / 2)), r);
    for (const l of [...u, ...kk]) picked.push({ l, kind: k });
  }
  console.log(`[extract-eval] sample ${picked.length} (${live ? `LIVE ${extractModel()}` : `replay ${fixturesPath}`})`);

  // ── extract ──
  const client = live ? new Anthropic() : null;
  const recorded: Record<string, unknown> = {};
  const res = new Map<Lot, { f: Extraction | null; reason?: string; nulled: string[] }>();
  let usageIn = 0, usageOut = 0, usageCache = 0;
  const queue = picked.slice();
  await Promise.all(Array.from({ length: Math.max(1, conc) }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const { l } = p;
      const text = { title: String(l.title ?? ''), description: String(l.description ?? '') };
      let raw: unknown;
      if (client) {
        const msg = await client.messages.create(extractParams(extractModel(), text));
        usageIn += msg.usage.input_tokens; usageOut += msg.usage.output_tokens; usageCache += msg.usage.cache_read_input_tokens || 0;
        const j = messageJson(msg);
        if (!j.ok) { res.set(l, { f: null, reason: j.reason, nulled: [] }); continue; }
        raw = j.json; recorded[text.title] = raw;
      } else raw = fx[text.title];
      const v = validateExtraction(raw, `${text.title}\n${text.description}`);
      res.set(l, v.ok ? { f: v.value, nulled: v.grounded } : { f: null, reason: v.reason, nulled: [] });
      if (v.ok) (l as Lot & { llm?: unknown }).llm = toLotExtract(v.value, hashText(text.title, text.description));
    }
  }));
  if (recordPath && live) {
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, JSON.stringify({ _comment: `recorded ${new Date().toISOString()} ${extractModel()}`, extract: recorded }, null, 1));
    console.log(`[extract-eval] recorded ${Object.keys(recorded).length} responses → ${recordPath}`);
  }

  // ── pools (regex-keyed corpus) ──
  const priceOf = (l: Lot) => Number(l.realizedUsd ?? l.priceUsd);
  const msOf = (l: Lot) => new Date(String(l.saleDate)).getTime();
  const cardPool = new Map<string, Lot[]>(), pkPool = new Map<string, Lot[]>(), refPool = new Map<string, Lot[]>();
  const push = (m: Map<string, Lot[]>, k: string | null, l: Lot) => { if (k) (m.get(k) || m.set(k, []).get(k)!).push(l); };
  for (const l of sold) {
    const k = targetKind(l);
    if (k === 'card') push(cardPool, cardKey(parseCard(String(l.title ?? ''))), l);
    else if (k === 'pokemon') push(pkPool, pokemonKey(l), l);
    else if (k === 'watch' && l.reference && /\d/.test(String(l.reference))) push(refPool, `${l.artist}|${String(l.reference).toLowerCase().replace(/\s+/g, '')}`, l);
  }
  const priorPool = (m: Map<string, Lot[]>, k: string | null, self: Lot) => {
    if (!k) return [];
    const t = msOf(self);
    return (m.get(k) || []).filter(x => x !== self && x.id !== self.id && msOf(x) < t && t - msOf(x) <= YEAR_MS);
  };
  const within30 = (pool: Lot[], self: Lot) => {
    if (!pool.length) return false;
    const med = median(pool.map(priceOf));
    return Math.abs(priceOf(self) / med - 1) <= 0.3;
  };

  // ── fields ──
  type FieldTally = { regexOnly: number; llmOnly: number; agree: number; disagree: number; neither: number; examples: string[] };
  const fields: Record<string, FieldTally> = {};
  const tally = (name: string, rv: unknown, lv: unknown, title: string) => {
    const t = fields[name] ||= { regexOnly: 0, llmOnly: 0, agree: 0, disagree: 0, neither: 0, examples: [] };
    const has = (v: unknown) => v !== null && v !== undefined && v !== '';
    const norm = (v: unknown) => String(v).toLowerCase().replace(/[^a-z0-9.]+/g, '');
    if (has(rv) && has(lv)) {
      if (norm(rv) === norm(lv)) t.agree++;
      else { t.disagree++; if (t.examples.length < 8) t.examples.push(`${title.slice(0, 90)} :: regex=${rv} llm=${lv}`); }
    } else if (has(rv)) t.regexOnly++; else if (has(lv)) t.llmOnly++; else t.neither++;
  };

  const impact = {
    card: { n: 0, keyedRegex: 0, keyedMerged: 0, poolRegex: 0, poolMerged: 0, hitRegex: 0, hitMerged: 0 },
    pokemon: { n: 0, keyedRegex: 0, keyedMerged: 0, poolRegex: 0, poolMerged: 0, hitRegex: 0, hitMerged: 0 },
    watch: { n: 0, keyedRegex: 0, keyedMerged: 0, poolRegex: 0, poolMerged: 0, hitRegex: 0, hitMerged: 0 },
  };
  let rejected = 0; const rejectReasons: Record<string, number> = {}; const nulledTally: Record<string, number> = {};
  for (const { l, kind } of picked) {
    const x = res.get(l);
    if (!x?.f) { rejected++; rejectReasons[x?.reason || 'no-result'] = (rejectReasons[x?.reason || 'no-result'] || 0) + 1; }
    for (const g of x?.nulled || []) nulledTally[g] = (nulledTally[g] || 0) + 1;
    const f = x?.f;
    const title = String(l.title ?? '');
    const im = impact[kind]; im.n++;
    if (kind === 'card') {
      const rc = parseCard(title);
      tally('card.year', rc.year, f?.year ? f.year.slice(0, 4) === (rc.year || '').slice(0, 4) ? rc.year : f.year : null, title);
      tally('card.cardNo', rc.cardNo, f?.card_number?.toUpperCase(), title);
      tally('card.player', rc.playerSlug, f?.subject ? f.subject.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null, title);
      tally('card.gradeCo', rc.gradeCo, f?.grading_company, title);
      tally('card.grade', rc.gradeNum ?? rc.gradeTag, f?.grade, title);
      tally('card.serialOf', rc.serialOf, f?.serial_run, title);
      tally('card.autoGrade', rc.autoGrade, f?.autograph_grade, title);
      const kr = cardKey(rc), km = cardKey(mergeCardExtract(rc, l));
      if (kr) im.keyedRegex++; if (km) im.keyedMerged++;
      const pr = priorPool(cardPool, kr, l), pm = priorPool(cardPool, km, l);
      if (pr.length) im.poolRegex++; if (pm.length) im.poolMerged++;
      if (within30(pr, l)) im.hitRegex++; if (within30(pm, l)) im.hitMerged++;
    } else if (kind === 'pokemon') {
      const kr = pokemonKey(l); const km = kr ?? pokemonKeyFromExtract(l);
      const parts = kr ? kr.split('|') : [];
      tally('pokemon.year', parts[0], f?.year?.slice(0, 4), title);
      tally('pokemon.cardNo', parts[2], f?.card_number, title);
      tally('pokemon.grade', parts[4], f?.grading_company && f.grade ? `${f.grading_company}${f.grade}` : null, title);
      tally('pokemon.edition', parts[3] === 'unl' ? null : parts[3], f?.edition === 'unlimited' ? null : f?.edition, title);
      if (kr) im.keyedRegex++; if (km) im.keyedMerged++;
      const pr = priorPool(pkPool, kr, l), pm = priorPool(pkPool, km, l);
      if (pr.length) im.poolRegex++; if (pm.length) im.poolMerged++;
      if (within30(pr, l)) im.hitRegex++; if (within30(pm, l)) im.hitMerged++;
    } else {
      const rr = l.reference ? String(l.reference) : null;
      tally('watch.reference', rr, f?.reference, title);
      tally('watch.brand', WATCH_SLUGS_X.has(l.artist) ? l.artist : null, f?.brand ? f.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null, title);
      const mr = rr ?? (f?.reference && (!f.brand || f.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-') === l.artist) ? f.reference : null);
      const key = (v: string | null) => (v && /\d/.test(v) ? `${l.artist}|${v.toLowerCase().replace(/\s+/g, '')}` : null);
      if (key(rr)) im.keyedRegex++; if (key(mr)) im.keyedMerged++;
      const pr = priorPool(refPool, key(rr), l), pm = priorPool(refPool, key(mr), l);
      if (pr.length) im.poolRegex++; if (pm.length) im.poolMerged++;
      if (within30(pr, l)) im.hitRegex++; if (within30(pm, l)) im.hitMerged++;
    }
  }

  // ── report ──
  console.log(`\n[extract-eval] validation: ${picked.length - rejected}/${picked.length} accepted · rejected ${JSON.stringify(rejectReasons)} · grounding nulls ${JSON.stringify(nulledTally)}`);
  console.log('\nfield                regex-only  llm-only  agree  disagree  agree-rate');
  for (const [k, t] of Object.entries(fields)) {
    console.log(`${k.padEnd(20)} ${String(t.regexOnly).padStart(10)} ${String(t.llmOnly).padStart(9)} ${String(t.agree).padStart(6)} ${String(t.disagree).padStart(9)}  ${pct(t.agree, t.agree + t.disagree).padStart(9)}`);
  }
  for (const [k, t] of Object.entries(fields)) for (const e of t.examples.slice(0, 3)) console.log(`  ✗ ${k}: ${e}`);
  console.log('\nengine impact     n   keyed regex→merged     prior-yr pool regex→merged    ±30% hit (of n) regex→merged');
  for (const [k, im] of Object.entries(impact)) {
    console.log(`${k.padEnd(10)} ${String(im.n).padStart(6)}   ${pct(im.keyedRegex, im.n).padStart(7)} → ${pct(im.keyedMerged, im.n).padEnd(7)}      ${pct(im.poolRegex, im.n).padStart(7)} → ${pct(im.poolMerged, im.n).padEnd(7)}          ${pct(im.hitRegex, im.n).padStart(7)} → ${pct(im.hitMerged, im.n)}`);
  }
  if (live) console.log(`\n[extract-eval] usage: ${usageIn} in (+${usageCache} cache-read) / ${usageOut} out tokens`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), mode: live ? 'live' : 'replay', model: extractModel(), n: picked.length, rejected, rejectReasons, nulledTally, fields, impact, usage: live ? { in: usageIn, out: usageOut, cacheRead: usageCache } : null }, null, 1));
  console.log(`[extract-eval] wrote ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
