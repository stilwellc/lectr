/**
 * Alert matcher — the nightly half of saved searches. Runs at the end of the
 * crawl (after sync-lots-db): takes every saved search, matches it against
 * the lots that ARRIVED this crawl (firstSeen inside the freshness window),
 * and writes alert rows. Duplicate (search, lot) pairs are ignored, so a lot
 * alerts once per search, ever.
 *
 * INPUT (Sep 2 2026): the eager served payload public/data/ray/upcoming.json
 * — every live lot with the fields matched here (artist / playerSlug / sport
 * / category / title / value.signal / firstSeen / resultsPending all survive
 * slimForClient). Loading the full 1.1M-lot corpus just to filter it down to
 * the live book cost a 10GB heap for nothing. The corpus is the fallback only
 * when upcoming.json is absent (an older served payload).
 *
 * Every PostgREST call retries with bounded backoff; an exhausted retry
 * THROWS so the workflow step goes red instead of masking the failure.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (skips silently without them).
 */
import fs from 'fs';
import path from 'path';
import { readCorpus, SERVED_DIR } from './corpus-io';
import { marketOf } from '../app/constants';

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY || '';

// covers a missed night without replaying the whole book; FRESH_HOURS widens
// it for a one-off backfill (e.g. seeding a brand-new search with the week)
const FRESH_MS = (Number(process.env.FRESH_HOURS) || 40) * 3600 * 1000;
const MAX_PER_SEARCH = 50;

interface Query {
  market?: string | null;
  maker?: string | null;
  sport?: string | null;
  category?: string | null;
  text?: string | null;
  belowOnly?: boolean;
  player?: string | null;
}

function matches(q: Query, lot: any): boolean {
  // a FOLLOW: sports lots carry a build-stamped playerSlug; art/watch makers
  // are the artist slug itself — a follow matches either, so "follow Jordan"
  // and "follow KAWS" both work off the one field.
  if (q.player && lot.playerSlug !== q.player && lot.artist !== q.player) return false;
  if (q.maker && lot.artist !== q.maker) return false;
  if (q.market && q.market !== 'all' && marketOf(String(lot.artist || '')) !== q.market) return false;
  if (q.sport && (lot.sport || '') !== q.sport) return false;
  if (q.category && lot.category !== q.category) return false;
  if (q.belowOnly && !String(lot.value?.signal?.label || '').startsWith('below')) return false;
  if (q.text) {
    const hay = String(lot.title || '').toLowerCase();
    for (const w of String(q.text).toLowerCase().split(/\s+/)) {
      if (w && !hay.includes(w)) return false;
    }
  }
  return true;
}

/** the live book: upcoming.json's lots (eager, slim), else the corpus filtered.
 *  (Duplicated in match-signal-alerts.ts on purpose — each script stays a
 *  standalone entry point with no cross-import that would run the other's
 *  main().) */
function readLiveLots(tag: string): any[] {
  const p = path.join(SERVED_DIR, 'upcoming.json');
  if (fs.existsSync(p)) {
    try {
      const up = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(up?.lots)) {
        console.log(`${tag} live book from upcoming.json: ${up.lots.length} lots (generated ${up.generatedAt || '?'})`);
        return up.lots;
      }
    } catch (e) {
      console.warn(`${tag} upcoming.json unreadable (${(e as Error).message}) — falling back to the corpus`);
    }
  } else {
    console.warn(`${tag} upcoming.json absent — falling back to the full corpus`);
  }
  return (readCorpus() as any[]).filter(l => l.status === 'upcoming');
}

// ── PostgREST with bounded retry (4 tries, 2s → 4s → 8s) ────────────────────
class Fatal extends Error {}
const RETRIES = 4;
async function rest(p: string, init: RequestInit = {}): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(`${url}/rest/v1/${p}`, {
        ...init,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return res;
      const msg = `[match-alerts] ${init.method || 'GET'} ${p.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) throw new Fatal(msg);
      last = new Error(msg);
    } catch (e) {
      if (e instanceof Fatal) throw e;
      last = e;
    }
    console.warn(`[match-alerts] attempt ${attempt + 1}/${RETRIES} failed: ${(last as Error)?.message || last}`);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** page a read past PostgREST's 1000-row default cap (order=id keeps the
 *  offset windows stable while paging) */
async function restAll(p: string): Promise<any[]> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await (await rest(`${p}&order=id&limit=${PAGE}&offset=${offset}`)).json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

async function main() {
  if (!url || !key) { console.log('[match-alerts] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping'); return; }

  const searches = await restAll('saved_searches?select=id,user_id,query');
  if (!searches.length) { console.log('[match-alerts] no saved searches'); return; }

  const now = Date.now();
  const fresh = readLiveLots('[match-alerts]').filter(l =>
    l.status === 'upcoming' && !l.resultsPending && l.firstSeen &&
    now - Date.parse(String(l.firstSeen)) < FRESH_MS);
  console.log(`[match-alerts] ${searches.length} searches vs ${fresh.length} fresh lots`);

  let written = 0;
  for (const s of searches) {
    if (s.query?._signal) continue; // synthetic signal searches belong to match-signal-alerts
    const hits = fresh.filter(l => matches(s.query || {}, l)).slice(0, MAX_PER_SEARCH);
    if (!hits.length) continue;
    const rows = hits.map(l => ({ user_id: s.user_id, search_id: s.id, lot_id: String(l.id) }));
    await rest('alerts?on_conflict=search_id,lot_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    await rest(`saved_searches?id=eq.${s.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_matched: new Date().toISOString() }),
    });
    written += rows.length;
  }
  console.log(`[match-alerts] wrote ${written} alerts across ${searches.length} searches`);
}

main().catch(e => { console.error(e); process.exit(1); });
