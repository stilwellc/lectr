/**
 * Signal alerts — the engine talking to the user's OWN desk, nightly:
 *
 *   1. WATCHLIST SIGNALS — a lot the user watches (saved_lots) now carries a
 *      below-market signal it did NOT carry when they saved it.
 *   2. YOUR MARKETS — a fresh below-market flag landed in a market the user
 *      demonstrably watches (derived from their saved lots' artists).
 *
 * Rides the EXISTING alerts plumbing with zero schema changes: alerts.search_id
 * is NOT NULL with a UNIQUE(search_id, lot_id) — so each kind lives under a
 * per-user SYNTHETIC saved_search (marker in query._signal). The inbox and the
 * digest already render alerts grouped under their search's name, so these
 * appear as standing sections ("Watchlist signals", "Below market in your
 * markets") with zero client changes required; dedupe (one alert per
 * search×lot, ever) comes free from the same unique index.
 *
 * Honesty: an alert states a measured signal (label + the engine's read),
 * never advice. The vertical feed is capped so a big crawl night can't bury
 * the inbox.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (skips silently without them).
 * Runs after sync-lots-db + match-alerts in the nightly sync job.
 */
import { readCorpus } from './corpus-io';
import { marketOf } from '../app/constants';

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY || '';

const FRESH_MS = (Number(process.env.FRESH_HOURS) || 40) * 3600 * 1000;
/** a crawl night can land hundreds of flags in a hot market — cap the feed */
const MAX_VERTICAL_PER_USER = 5;

const WATCH_NAME = 'Watchlist signals';
const VERT_NAME = 'Below market in your markets';

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
  if (!res.ok) throw new Error(`[signal-alerts] ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function restAll(path: string): Promise<any[]> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await (await rest(`${path}&limit=${PAGE}&offset=${offset}`)).json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** find-or-create the per-user synthetic search a signal kind hangs under */
async function ensureSyntheticSearch(
  existing: Map<string, Map<string, string>>, // userId → (_signal → searchId)
  userId: string,
  signalKind: string,
  name: string,
): Promise<string> {
  const mine = existing.get(userId);
  const hit = mine?.get(signalKind);
  if (hit) return hit;
  const res = await rest('saved_searches', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, name, query: { _signal: signalKind } }),
  });
  const row = (await res.json())[0];
  if (!existing.has(userId)) existing.set(userId, new Map());
  existing.get(userId)!.set(signalKind, row.id);
  return row.id;
}

async function insertAlerts(rows: { user_id: string; search_id: string; lot_id: string }[]) {
  if (!rows.length) return;
  await rest('alerts?on_conflict=search_id,lot_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
}

async function main() {
  if (!url || !key) { console.log('[signal-alerts] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping'); return; }

  // every user's watched lots (service key bypasses RLS — server-side only)
  const saved = await restAll('saved_lots?select=user_id,lot_id,signal_pct,saved_artist&order=lot_id');
  if (!saved.length) { console.log('[signal-alerts] no saved lots anywhere — nothing to do'); return; }

  // existing synthetic searches (marker query._signal), keyed per user
  const searches = await restAll('saved_searches?select=id,user_id,query&order=id');
  const synthetic = new Map<string, Map<string, string>>();
  for (const s of searches) {
    const kind = s.query?._signal;
    if (!kind) continue;
    if (!synthetic.has(s.user_id)) synthetic.set(s.user_id, new Map());
    synthetic.get(s.user_id)!.set(kind, s.id);
  }

  const corpus = readCorpus() as any[];
  const byId = new Map<string, any>();
  for (const l of corpus) byId.set(String(l.id), l);
  const resolve = (id: string) =>
    byId.get(id) ?? byId.get(id.endsWith('~') ? id.slice(0, -1) : `${id}~`);

  const now = Date.now();
  const isBelow = (l: any) => String(l?.value?.signal?.label || '').startsWith('below');
  const isLive = (l: any) => l && l.status === 'upcoming' && !l.resultsPending;

  // ── 1 · WATCHLIST SIGNALS — watched lots newly reading below market.
  // "Newly": the save's baseline (signed convention: positive = below at
  // save) did NOT already claim below. A legacy unsigned baseline (saved
  // pre-2026-08-27) can't prove direction, so a positive legacy value is
  // treated as possibly-already-below and does NOT alert (never cry wolf).
  let watchWritten = 0;
  const byUser = new Map<string, any[]>();
  for (const r of saved) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  }
  for (const [userId, rows] of Array.from(byUser.entries())) {
    const hits: string[] = [];
    for (const r of rows) {
      const lot = resolve(String(r.lot_id));
      if (!isLive(lot) || !isBelow(lot)) continue;
      const baseline = typeof r.signal_pct === 'number' ? r.signal_pct : null;
      if (baseline != null && baseline > 0) continue; // was (or may have been) below at save
      hits.push(String(lot.id));
    }
    if (!hits.length) continue;
    const searchId = await ensureSyntheticSearch(synthetic, userId, 'watch', WATCH_NAME);
    await insertAlerts(hits.map(lot_id => ({ user_id: userId, search_id: searchId, lot_id })));
    watchWritten += hits.length;
  }

  // ── 2 · YOUR MARKETS — fresh below-market flags in markets the user watches
  const freshBelow = corpus.filter(l =>
    isLive(l) && isBelow(l) && l.firstSeen &&
    now - Date.parse(String(l.firstSeen)) < FRESH_MS);
  let vertWritten = 0;
  if (freshBelow.length) {
    for (const [userId, rows] of Array.from(byUser.entries())) {
      // the user's markets, from their watched lots' artists (corpus first,
      // saved_artist snapshot as the fallback for rolled-off lots)
      const markets = new Set<string>();
      for (const r of rows) {
        const lot = resolve(String(r.lot_id));
        const artist = lot?.artist ?? r.saved_artist;
        if (artist) { const m = marketOf(String(artist)); if (m) markets.add(m); }
      }
      if (!markets.size) continue;
      const watchedIds = new Set(rows.map(r => String(r.lot_id)));
      const hits = freshBelow
        .filter(l => markets.has(marketOf(String(l.artist || ''))) && !watchedIds.has(String(l.id)))
        .sort((a, b) => (b.value?.signal?.beatRatePct ?? 0) - (a.value?.signal?.beatRatePct ?? 0))
        .slice(0, MAX_VERTICAL_PER_USER);
      if (!hits.length) continue;
      const searchId = await ensureSyntheticSearch(synthetic, userId, 'vertical', VERT_NAME);
      await insertAlerts(hits.map(l => ({ user_id: userId, search_id: searchId, lot_id: String(l.id) })));
      vertWritten += hits.length;
    }
  }

  console.log(`[signal-alerts] watchlist=${watchWritten} markets=${vertWritten} across ${byUser.size} users (${freshBelow.length} fresh below-market lots)`);
}

main().catch(e => { console.error(e); process.exit(1); });
