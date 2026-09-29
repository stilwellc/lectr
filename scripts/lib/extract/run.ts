/**
 * extract/run.ts — the nightly LLM extraction runner (advisory layer).
 *
 *   npx tsx scripts/lib/extract/run.ts            # nightly: reads data/corpus/segments/
 *   npx tsx scripts/lib/extract/run.ts --corpus [dir]  # reads <dir|data/corpus>/{lots,sold-archive}.json.gz
 *   npx tsx scripts/lib/extract/run.ts --dry-run  # select + estimate only, no API calls
 *
 * Order of work (each step persists the cache, so a killed step loses nothing
 * already paid for):
 *   1. collect every batch a previous night left pending (results live 29d);
 *   2. select new/changed target lots (cache miss by id + text hash), cap
 *      RAY_EXTRACT_MAX (default 20000), log the estimated cost, submit as
 *      Message Batches (Haiku 4.5, 50% price, cached system prefix);
 *   3. submit the same-object pairs build-market queued (cap RAY_EXTRACT_PAIRS_MAX);
 *   4. wait up to RAY_EXTRACT_WAIT_MIN for tonight's batches, collect what ended.
 *
 * NEVER FAILS THE NIGHTLY: without ANTHROPIC_API_KEY it prints one line and
 * exits 0; any API error is a ::warning and exit 0 (the regex path is whole).
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { readAllSegments, readGzRows, CORPUS_DIR } from '../../corpus-io';
import { ExtractCache, type Text } from './cache';
import { collect, estimateCost, submitExtractions, submitPairs, type BatchesApi, type CollectStats } from './batch';
import { cachePath, extractCallEnabled, extractModel, logExtractionOff, maxLots, maxPairs, sameModel, waitMinutes, BATCH_CHUNK } from './config';
import { extractUserTurn, sameUserTurn } from './prompt';
import { selectCandidates } from './select';

export interface RunOpts {
  lots?: Record<string, unknown>[];
  api?: BatchesApi;
  dryRun?: boolean;
  now?: Date;
  /** poll interval (ms) — tests pass 0 */
  pollMs?: number;
  waitMin?: number;
}
export interface RunReport {
  enabled: boolean; collectedPrior?: CollectStats; submitted: number; pairsSubmitted: number;
  estUsd: number; collectedTonight?: CollectStats; pendingLeft: number;
}

const fmtStats = (s: CollectStats) =>
  `batches=${s.batches} ok=${s.succeeded} rejected=${s.rejected} errored=${s.errored} grounded-nulls=${s.groundedNulls} still-running=${s.stillRunning} ` +
  `tokens in=${s.usage.in} cache-read=${s.usage.cacheRead} cache-write=${s.usage.cacheWrite} out=${s.usage.out} cost=$${s.usd.toFixed(2)}` +
  (Object.keys(s.reasons).length ? ` reasons=${JSON.stringify(s.reasons)}` : '');

export async function runExtraction(opts: RunOpts = {}): Promise<RunReport> {
  if (!extractCallEnabled() && !opts.api && !opts.dryRun) { logExtractionOff('runner'); return { enabled: false, submitted: 0, pairsSubmitted: 0, estUsd: 0, pendingLeft: 0 }; }
  const now = opts.now ?? new Date();
  const file = cachePath();
  // data-store.sh leaves this marker when R2 HAS a cache it could not read:
  // spending tonight would build results that are then (rightly) not pushed
  if (fs.existsSync(path.join(path.dirname(file), '.extract-cache-unreadable')) && !opts.api) {
    console.log('::warning title=llm extraction::cache present in R2 but unreadable — skipping tonight (nothing spent)');
    return { enabled: true, submitted: 0, pairsSubmitted: 0, estUsd: 0, pendingLeft: 0 };
  }
  const cache = ExtractCache.load(file);
  // dry-run never builds a client (it runs without a key to price a night)
  const api = (opts.api ?? (opts.dryRun ? null : new Anthropic().messages.batches)) as BatchesApi;
  const lots = opts.lots ?? readAllSegments();
  const byId = new Map<string, Text>();
  for (const l of lots) byId.set(String(l.id), { title: String(l.title ?? ''), description: String(l.description ?? '') });
  const textOf = (id: string) => byId.get(id) ?? null;
  const rep: RunReport = { enabled: true, submitted: 0, pairsSubmitted: 0, estUsd: 0, pendingLeft: 0 };
  console.log(`[extract] on · model ${extractModel()} (pairs ${sameModel()}) · cache ${cache.x.size} lots, ${cache.p.size} pair verdicts, ${cache.q.size} queued pairs, ${cache.pending.length} pending batches · corpus ${lots.length} lots`);

  // 1 · prior nights' pending batches
  if (cache.pending.length && !opts.dryRun) {
    rep.collectedPrior = await collect(api, cache, textOf);
    cache.save(file);
    console.log(`[extract] collected prior batches: ${fmtStats(rep.collectedPrior)}`);
  }

  // 2 · field extraction for new / changed lots
  const cap = maxLots();
  const sel = selectCandidates(lots, cache, cap);
  const xModel = extractModel();
  const est = estimateCost(xModel, 'x', sel.candidates.map(c => extractUserTurn(c.text.title, c.text.description).length));
  console.log(`[extract] select: eligible=${sel.eligible} cache-hits=${sel.cacheHits} in-flight=${sel.pendingSkips} → sending ${sel.candidates.length} (cap ${cap}, ${sel.capped} deferred to later nights) ${JSON.stringify(sel.byKind)}`);
  console.log(`[extract] estimated cost tonight (extraction): $${est.usd.toFixed(2)} for ${est.requests} lots (~${(est.inTok / 1e6).toFixed(1)}M in / ${(est.outTok / 1e6).toFixed(2)}M out tokens, batch 50%, cached system prefix)`);

  // 3 · queued same-object pairs
  const inFlightPairs = cache.pendingKeys('p');
  const pairs = Array.from(cache.q.entries()).filter(([k]) => !inFlightPairs.has(k)).map(([, q]) => q).slice(0, maxPairs());
  const pModel = sameModel();
  const pEst = estimateCost(pModel, 'p', pairs.map(q => sameUserTurn(q.ta, q.tb).length));
  if (pairs.length) console.log(`[extract] estimated cost tonight (same-object): $${pEst.usd.toFixed(2)} for ${pairs.length} pairs`);
  rep.estUsd = Math.round((est.usd + pEst.usd) * 100) / 100;
  if (opts.dryRun) { console.log('[extract] --dry-run: nothing submitted'); return rep; }

  const tonight = new Set<string>();
  if (sel.candidates.length) {
    const pb = await submitExtractions(api, cache, xModel, sel.candidates, now);
    pb.forEach(b => tonight.add(b.id)); rep.submitted = sel.candidates.length;
    cache.save(file);
    console.log(`[extract] submitted ${pb.length} extraction batch(es) of ≤${BATCH_CHUNK}: ${pb.map(b => b.id).join(', ')}`);
  }
  if (pairs.length) {
    const pb = await submitPairs(api, cache, pModel, pairs, now);
    pb.forEach(b => tonight.add(b.id)); rep.pairsSubmitted = pairs.length;
    cache.save(file);
    console.log(`[extract] submitted ${pb.length} same-object batch(es)`);
  }

  // 4 · wait for tonight's batches (bounded), collect what ended
  if (tonight.size) {
    const deadline = Date.now() + (opts.waitMin ?? waitMinutes()) * 60_000;
    const pollMs = opts.pollMs ?? 60_000;
    for (;;) {
      let open = 0;
      for (const id of Array.from(tonight)) { const b = await api.retrieve(id); if (b.processing_status !== 'ended') open++; }
      if (!open || Date.now() >= deadline) break;
      await new Promise(r => setTimeout(r, pollMs));
    }
    rep.collectedTonight = await collect(api, cache, textOf, tonight);
    console.log(`[extract] collected tonight: ${fmtStats(rep.collectedTonight)}`);
    // Haiku 4.5 caches only a ≥4096-token prefix — a silent miss doubles the bill
    if (rep.collectedTonight.succeeded >= 50 && rep.collectedTonight.usage.cacheRead === 0)
      console.log('::warning title=llm extraction::system prompt was never served from cache (cache_read_input_tokens=0) — check the prefix length / model minimum');
  }
  rep.pendingLeft = cache.pending.length;
  if (rep.pendingLeft) console.log(`[extract] ${rep.pendingLeft} batch(es) still processing — collected by the next run`);
  cache.save(file);
  return rep;
}

if (require.main === module && process.env.RAY_SKIP_MAIN !== '1') {
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--corpus');
  const dir = ci >= 0 && argv[ci + 1] && !argv[ci + 1].startsWith('--') ? argv[ci + 1] : CORPUS_DIR;
  const lots = ci >= 0
    ? [...readGzRows(path.join(dir, 'lots.json.gz')), ...readGzRows(path.join(dir, 'sold-archive.json.gz'))]
    : undefined;
  runExtraction({ lots, dryRun: argv.includes('--dry-run') })
    .then(r => { if (r.enabled) console.log(`[extract] done · submitted ${r.submitted} lots + ${r.pairsSubmitted} pairs · est $${r.estUsd.toFixed(2)}`); })
    .catch(e => {
      // advisory layer: never fail the nightly — the regex path is complete without it
      console.log(`::warning title=llm extraction::${(e as Error).message}`);
      process.exit(0);
    });
}
