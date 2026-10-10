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
import { taxonOf, subMatches } from '../app/lib/taxonomy';
import { priorityOf } from '../app/lib/priority';
import { matchesSavedQuery, unmatchableReason } from '../app/lib/saved-query';
import type { SavedQuery } from '../app/lib/alerts';

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY || '';

// covers a missed night without replaying the whole book; FRESH_HOURS widens
// it for a one-off backfill (e.g. seeding a brand-new search with the week)
const FRESH_MS = (Number(process.env.FRESH_HOURS) || 40) * 3600 * 1000;
const MAX_PER_SEARCH = 50;

/** a stored query — the one shape the client writes (app/lib/alerts SavedQuery) */
type Query = SavedQuery;

/** Category / house follows (Oct 8) cover hundreds of new lots a day, so they
 *  alert ONLY on lots that clear the anonymous shortlist bar (≥$2.5K anchor
 *  with evidence), best-first by the priority score, at most FOLLOW_CAP a night.
 *  Without this branch `matches` ignores the unknown fields and a category
 *  follow would match EVERY fresh lot. */
const FOLLOW_CAP = 10;
export function followHits(q: Query, fresh: any[], now: number): any[] {
  const scored: { l: any; s: number }[] = [];
  for (const l of fresh) {
    if (q.follow === 'house' && l.auctionHouse !== q.house) continue;
    if (q.follow === 'cat') {
      const t = taxonOf(l);
      if (t.cat !== q.cat || (q.sub && !subMatches(t.cat, q.sub, t.sub))) continue;
    }
    const p = priorityOf(l, now);
    if (!p || p.a < 2500 || (p.ev <= 0 && p.src !== 'est')) continue;
    scored.push({ l, s: p.score });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, FOLLOW_CAP).map(x => x.l);
}

/** Every alert a saved search earns tonight. Follows take the capped
 *  shortlist branch; plain searches go through the shared matcher
 *  (app/lib/saved-query — the same definition "Save this search" writes
 *  with), and a query the matcher can't fully honor (an unknown field, a
 *  malformed value, no criterion) earns NOTHING rather than everything. */
export function hitsFor(q: Query, fresh: any[], now: number, log: (m: string) => void = () => {}): any[] {
  if (q.follow) return q.follow === 'cat' || q.follow === 'house' ? followHits(q, fresh, now) : [];
  const why = unmatchableReason(q as Record<string, unknown>);
  if (why) { log(why); return []; }
  const today = new Date(now).toISOString().slice(0, 10);
  return fresh.filter(l => matchesSavedQuery(q as SavedQuery, l, today)).slice(0, MAX_PER_SEARCH);
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
    const q: Query = s.query || {};
    const hits = hitsFor(q, fresh, now, why => console.warn(`[match-alerts] search ${s.id} skipped — ${why}`));
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

// RAY_SKIP_MAIN lets a test import hitsFor without touching the network
if (process.env.RAY_SKIP_MAIN !== '1') main().catch(e => { console.error(e); process.exit(1); });
