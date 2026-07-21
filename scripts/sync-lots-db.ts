/**
 * Phase-2 DB sync — mirror the corpus into the Supabase `lots` table so a
 * permalink can resolve ONE lot with one indexed fetch instead of streaming
 * the 25MB shards. Runs at the end of the nightly crawl.
 *
 * The table is a QUERY LAYER, not the source of truth — the R2 corpus is.
 * Rows are upserted, never deleted: lots that roll off the tape keep their
 * row, so old permalinks outlive the crawl window (the `data` column holds
 * the full slim client lot; `updated_at` shows how stale it is).
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (skips silently without them —
 * the site works fine off the shards alone).
 */
import { readCorpus, slimForClient } from './corpus-io';
import { marketOf } from '../app/constants';

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY || '';

async function main() {
  if (!url || !key) { console.log('[sync-lots] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping DB sync'); return; }
  const lots = readCorpus() as any[];
  const now = new Date().toISOString();
  // UPCOMING ONLY. Supabase is the search + permalink-resolve layer, and we
  // only want the live book searchable — not the sold archive. Keeping it
  // upcoming-only also keeps the table tiny (~5k rows) forever, however large
  // the R2 sold corpus grows (affordability). The engine/analytics never read
  // Supabase — they read the R2 corpus — so this changes nothing computed.
  const rows = lots.filter(l => l.id && l.status === 'upcoming').map(l => {
    const v = l.value ?? null;
    return {
      id: String(l.id),
      artist: l.artist ?? null,
      market: l.artist ? marketOf(String(l.artist)) : null,
      status: l.status ?? null,
      sale_date: typeof l.saleDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(l.saleDate) ? l.saleDate.slice(0, 10) : null,
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

  const CHUNK = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(`${url}/rest/v1/lots?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`[sync-lots] upsert failed at row ${i}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    done += chunk.length;
    if (done % 5000 < CHUNK) console.log(`[sync-lots] ${done}/${rows.length}`);
  }
  console.log(`[sync-lots] upserted ${done} upcoming lots into public.lots`);

  // SWEEP: delete every row not refreshed this run — i.e. lots that are no
  // longer upcoming (they sold / were withdrawn). This keeps `lots` == the
  // current live book. Done AFTER a clean upsert so a partial failure never
  // deletes valid rows; anything wrongly removed is re-added next run. On the
  // first run this also evicts the ~120k historical sold rows in one statement.
  const del = await fetch(`${url}/rest/v1/lots?updated_at=lt.${encodeURIComponent(now)}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
  });
  if (!del.ok) console.error(`[sync-lots] sweep failed (non-fatal): ${del.status} ${(await del.text()).slice(0, 200)}`);
  else console.log('[sync-lots] swept non-upcoming rows (table now mirrors the live book)');
}

main().catch(e => { console.error(e); process.exit(1); });
