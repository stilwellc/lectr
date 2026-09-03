/**
 * Phase-2 DB sync — mirror the LIVE BOOK into the Supabase `lots` table so a
 * permalink can resolve ONE lot with one indexed fetch instead of streaming
 * the 25MB shards. Runs in the nightly sync job (after assemble).
 *
 * The table is a QUERY LAYER, not the source of truth — the R2 corpus is.
 *
 * RETENTION CONTRACT (Sep 2 2026 — the product-contract fix): the doc said
 * "rows are never deleted" while this script swept every non-upcoming row
 * nightly, so a /lot permalink died the night the lot sold. Now:
 *   1. every UPCOMING lot is upserted with its full queryable columns
 *      (updated_at = now) — the searchable live book;
 *   2. a row that LEFT the live book (it sold / was bought in / withdrawn)
 *      is REFRESHED from the corpus into a SLIM settled row — id, status,
 *      sale_date, price_usd, data — so the permalink keeps resolving with
 *      the outcome. Rows the corpus no longer knows at all are left as they
 *      are (they age out below);
 *   3. the SWEEP deletes only rows whose sale_date (or, lacking one,
 *      updated_at) is older than 24 MONTHS — the saveable window.
 * Same guards as before: a hollow run (0 upcoming, or < 50% of the table's
 * live rows) upserts but refuses to sweep. Every PostgREST call retries with
 * bounded backoff; an exhausted retry THROWS (the workflow step goes red).
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (skips silently without them —
 * the site works fine off the shards alone).
 */
import { readCorpus, slimForClient } from './corpus-io';
import { marketOf } from '../app/constants';

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY || '';
const RETAIN_MONTHS = 24;
const CHUNK = 500;

// ── PostgREST with bounded retry ────────────────────────────────────────────
// 4 tries, 2s → 4s → 8s backoff, on network errors / 5xx / 408 / 429. A 4xx
// contract error (bad column, RLS) is not retried — it would fail identically.
class Fatal extends Error {}
const RETRIES = 4;
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) return res;
      const msg = `[sync-lots] ${init.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) throw new Fatal(msg);
      last = new Error(msg);
    } catch (e) {
      if (e instanceof Fatal) throw e;
      last = e;
    }
    console.warn(`[sync-lots] attempt ${attempt + 1}/${RETRIES} failed: ${(last as Error)?.message || last}`);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** page a read past PostgREST's 1000-row default cap */
async function restAll(path: string): Promise<any[]> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await (await rest(`${path}&order=id&limit=${PAGE}&offset=${offset}`)).json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

async function upsert(rows: Record<string, unknown>[], label: string) {
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await rest('lots?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    done += chunk.length;
    if (done % 5000 < CHUNK) console.log(`[sync-lots] ${label} ${done}/${rows.length}`);
  }
  console.log(`[sync-lots] upserted ${done} ${label} rows into public.lots`);
}

const dayOf = (l: any): string | null =>
  typeof l.saleDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(l.saleDate) ? l.saleDate.slice(0, 10) : null;

async function main() {
  if (!url || !key) { console.log('[sync-lots] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping DB sync'); return; }
  const lots = readCorpus() as any[];
  const now = new Date().toISOString();

  // ── 1. the live book: every upcoming lot, full queryable columns ──────────
  const rows = lots.filter(l => l.id && l.status === 'upcoming').map(l => {
    const v = l.value ?? null;
    return {
      id: String(l.id),
      artist: l.artist ?? null,
      market: l.artist ? marketOf(String(l.artist)) : null,
      status: l.status ?? null,
      sale_date: dayOf(l),
      price_usd: l.priceUsd ?? null,
      est_low_usd: l.estLowUsd ?? l.estimateLow ?? null,
      est_high_usd: l.estHighUsd ?? l.estimateHigh ?? null,
      title: l.title ?? null,
      image_url: l.imageUrl ?? null,
      house: l.auctionHouse ?? null,
      sport: l.sport ?? null,
      signal_label: v?.signal?.label ?? null,
      signal_pct: v?.signal?.beatRatePct ?? null,
      value: v,
      url: l.url ?? null,
      results_pending: !!l.resultsPending,
      data: slimForClient(l),
      updated_at: now,
    };
  });
  await upsert(rows, 'upcoming');

  // ── 2. settle the rows that left the live book ───────────────────────────
  // Everything not refreshed above was upcoming last night and is not now.
  // Refresh each from the corpus into a SLIM settled row so its permalink
  // resolves with the outcome (the data column IS what LotPage renders).
  const stale = await restAll(`lots?select=id&updated_at=lt.${encodeURIComponent(now)}&status=eq.upcoming`);
  if (stale.length) {
    const byId = new Map<string, any>();
    for (const l of lots) if (l.id && l.status !== 'upcoming') byId.set(String(l.id), l);
    const settled: Record<string, unknown>[] = [];
    let unknown = 0;
    for (const r of stale) {
      const l = byId.get(String(r.id)) ?? byId.get(String(r.id).endsWith('~') ? String(r.id).slice(0, -1) : `${r.id}~`);
      if (!l) { unknown++; continue; }
      settled.push({
        id: String(r.id),
        status: l.status ?? null,
        sale_date: dayOf(l),
        price_usd: l.priceUsd ?? null,
        results_pending: !!l.resultsPending,
        signal_label: null,          // a settled lot carries no live flag
        signal_pct: null,
        value: null,
        data: slimForClient(l),
        updated_at: now,
      });
    }
    console.log(`[sync-lots] ${stale.length} rows left the live book: ${settled.length} settled from the corpus, ${unknown} unknown to the corpus (left for the age sweep)`);
    if (settled.length) await upsert(settled, 'settled');
  } else {
    console.log('[sync-lots] no rows left the live book since the last sync');
  }

  // ── 3. SWEEP GUARD + the 24-month age sweep ──────────────────────────────
  // A hollow run — zero upcoming, or a live book that halved overnight — is a
  // crawler/corpus failure, not a market fact. Compare against the table's
  // current LIVE row count and skip only the sweep; the upserts stand.
  if (rows.length === 0) {
    console.error('[sync-lots] SWEEP REFUSED: 0 upcoming rows this run — refusing to touch public.lots beyond the upserts');
    return;
  }
  const head = await rest('lots?select=id&status=eq.upcoming', {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' },
  });
  const liveCount = Number((head.headers.get('content-range') || '').split('/')[1]);
  if (!Number.isFinite(liveCount)) {
    console.error(`[sync-lots] SWEEP REFUSED: could not count live rows — skipping the sweep; upserts stand`);
    return;
  }
  if (rows.length < liveCount * 0.5) {
    console.error(`[sync-lots] SWEEP REFUSED: ${rows.length} live rows this run vs ${liveCount} in the table (<50%) — skipping the sweep; upserts stand`);
    return;
  }
  // Rows older than the saveable window: by sale_date where known, else by
  // updated_at (a row that never settled and never refreshed for 24 months).
  const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - RETAIN_MONTHS);
  const cutDay = cutoff.toISOString().slice(0, 10);
  const cutIso = cutoff.toISOString();
  const swept1 = await rest(`lots?sale_date=lt.${cutDay}`, { method: 'DELETE', headers: { Prefer: 'return=minimal,count=exact' } });
  const swept2 = await rest(`lots?sale_date=is.null&updated_at=lt.${encodeURIComponent(cutIso)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal,count=exact' } });
  const n = (r: Response) => (r.headers.get('content-range') || '').split('/')[1] || '?';
  console.log(`[sync-lots] swept rows older than ${RETAIN_MONTHS} months: ${n(swept1)} by sale_date < ${cutDay}, ${n(swept2)} dateless by updated_at`);
}

main().catch(e => { console.error(e); process.exit(1); });
