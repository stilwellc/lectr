// Parallel per-maker hedonic indices over worker_threads.
//
// PROFILE (Aug 25 nightly, the last healthy run): the sequential maker loop in
// build-market cost ~1,700s — 54 makers, ~28 min, 40% of assemble — and every
// maker is an independent buildMakerIndex(lots) call (IRLS over one maker's
// lots; no shared state, no ordering). The GitHub runner has 4 vCPUs, so a
// pool of N-1 workers takes the wall clock to roughly 1/3 with the SAME
// results: buildMakerIndex is deterministic in its inputs, and the parent
// assembles makerIndex[slug] in the same shape the sequential loop did.
//
// What crosses the thread boundary is the structured-clone cost, so each lot
// is stripped of the heavy text/vector fields the index never reads
// (fullText, titleTokens, _v, bidHistory, description, images…). Everything
// else is kept — a whitelist would be a correctness trap if hedonic-index ever
// reads one more field; a blacklist of known-heavy fields cannot be.
//
// RAY_MAKER_WORKERS=0 forces the sequential path (debugging / single-core).
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import type { AuctionLot } from '../../app/types';
import { buildMakerIndex, type MakerIndexResult } from '../hedonic-index';

const HEAVY = new Set(['fullText', 'titleTokens', '_v', 'bidHistory', 'description', 'images', 'imageUrls', 'html', 'raw', 'cardComps', 'value', 'comps']);
function slim(l: AuctionLot): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(l)) if (!HEAVY.has(k)) o[k] = (l as unknown as Record<string, unknown>)[k];
  return o;
}

export function makerWorkerCount(): number {
  const env = process.env.RAY_MAKER_WORKERS;
  if (env !== undefined && env !== '') return Math.max(0, Number(env) || 0);
  return Math.max(1, Math.min(6, os.cpus().length - 1));
}

/** Build every maker's index; returns makerIndex keyed by slug, identical to the sequential loop. */
export async function buildMakerIndicesParallel(
  makerLotsBySlug: Map<string, AuctionLot[]>,
  now: Date = new Date(),
): Promise<{ makerIndex: Record<string, MakerIndexResult>; workers: number; seconds: string }> {
  const t0 = Date.now();
  const slugs = Array.from(makerLotsBySlug.keys());
  const makerIndex: Record<string, MakerIndexResult> = {};
  const n = makerWorkerCount();
  if (n === 0 || slugs.length <= 1) {
    for (const slug of slugs) makerIndex[slug] = buildMakerIndex(makerLotsBySlug.get(slug)!, now);
    return { makerIndex, workers: 0, seconds: ((Date.now() - t0) / 1000).toFixed(0) };
  }
  // biggest makers first so the tail of the schedule is short jobs, not Patek
  slugs.sort((a, b) => (makerLotsBySlug.get(b)!.length) - (makerLotsBySlug.get(a)!.length));
  const queue = slugs.slice();
  const entry = path.join(__dirname, 'maker-worker.cjs');
  const workers = Array.from({ length: Math.min(n, slugs.length) }, () => new Worker(entry));
  await new Promise<void>((resolve, reject) => {
    let inFlight = 0, failed = false;
    const feed = (w: Worker) => {
      const slug = queue.shift();
      if (slug === undefined) { if (inFlight === 0) resolve(); return; }
      inFlight++;
      w.postMessage({ slug, lots: makerLotsBySlug.get(slug)!.map(slim), now: now.toISOString() });
    };
    for (const w of workers) {
      w.on('message', (msg: { slug: string; result?: MakerIndexResult; error?: string }) => {
        inFlight--;
        if (msg.error) { failed = true; reject(new Error(`[maker-pool] ${msg.slug}: ${msg.error}`)); return; }
        makerIndex[msg.slug] = msg.result!;
        if (!failed) feed(w);
      });
      w.on('error', e => { failed = true; reject(e); });
      w.on('exit', code => { if (code !== 0 && !failed) { failed = true; reject(new Error(`[maker-pool] worker exited ${code}`)); } });
      feed(w);
    }
  }).finally(() => { for (const w of workers) void w.terminate(); });
  // preserve the roster's original key order in the output object
  const ordered: Record<string, MakerIndexResult> = {};
  for (const slug of Array.from(makerLotsBySlug.keys())) ordered[slug] = makerIndex[slug];
  return { makerIndex: ordered, workers: workers.length, seconds: ((Date.now() - t0) / 1000).toFixed(0) };
}
