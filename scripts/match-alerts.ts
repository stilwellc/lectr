/**
 * Alert matcher — the nightly half of saved searches. Runs at the end of the
 * crawl (after sync-lots-db): takes every saved search, matches it against
 * the lots that ARRIVED this crawl (firstSeen inside the freshness window),
 * and writes alert rows. Duplicate (search, lot) pairs are ignored, so a lot
 * alerts once per search, ever.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (skips silently without them).
 */
import { readCorpus } from './corpus-io';
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

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`[match-alerts] ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function main() {
  if (!url || !key) { console.log('[match-alerts] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping'); return; }

  const searches = await (await rest('saved_searches?select=id,user_id,query')).json();
  if (!searches.length) { console.log('[match-alerts] no saved searches'); return; }

  const now = Date.now();
  const fresh = (readCorpus() as any[]).filter(l =>
    l.status === 'upcoming' && !l.resultsPending && l.firstSeen &&
    now - Date.parse(String(l.firstSeen)) < FRESH_MS);
  console.log(`[match-alerts] ${searches.length} searches vs ${fresh.length} fresh lots`);

  let written = 0;
  for (const s of searches) {
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
