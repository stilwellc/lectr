/**
 * Signal alerts — the engine talking to the user's OWN desk, nightly:
 *
 *   1. WATCHLIST SIGNALS — a lot the user watches (saved_lots) now carries a
 *      below-market signal it did NOT carry when they saved it.
 *   2. YOUR MARKETS — a fresh below-market flag landed in a market the user
 *      demonstrably watches (derived from their saved lots' artists).
 *   3. HAMMER DAY — a watched lot closes within 24h.
 *
 * Rides the EXISTING alerts plumbing with zero schema changes: alerts.search_id
 * is NOT NULL with a UNIQUE(search_id, lot_id) — so each kind lives under a
 * per-user SYNTHETIC saved_search (marker in query._signal). The inbox renders
 * alerts grouped under their search's name, so these appear as standing
 * sections ("Watchlist signals", "Below market in your markets", "Hammer day")
 * with zero client changes required; dedupe (one alert per search×lot, ever)
 * comes free from the same unique index.
 *
 * Honesty: an alert states a measured signal (label + the engine's read),
 * never advice. The vertical feed is capped so a big crawl night can't bury
 * the inbox.
 *
 * INPUT (Sep 2 2026): the eager served payload public/data/ray/upcoming.json
 * (every live lot, with value.signal / firstSeen / saleDateTime / artist —
 * all the fields read here). Every signal kind fires on LIVE lots only, so
 * the live book is sufficient; the full corpus is loaded lazily ONLY to
 * recover the market of a watched lot that has already sold and predates
 * the saved_artist snapshot (legacy rows, pre-Aug 27 2026), and never at all
 * once those age out. Every PostgREST call retries with bounded backoff; an
 * exhausted retry THROWS so the workflow step goes red.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY (skips silently without them).
 * Runs after sync-lots-db + match-alerts in the nightly sync job.
 */
import fs from 'fs';
import path from 'path';
import { readCorpus, SERVED_DIR } from './corpus-io';
import { marketOf } from '../app/constants';

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY || '';

const FRESH_MS = (Number(process.env.FRESH_HOURS) || 40) * 3600 * 1000;
/** a crawl night can land hundreds of flags in a hot market — cap the feed */
const MAX_VERTICAL_PER_USER = 5;

const WATCH_NAME = 'Watchlist signals';
const VERT_NAME = 'Below market in your markets';
const HAMMER_NAME = 'Hammer day';

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
      const msg = `[signal-alerts] ${init.method || 'GET'} ${p.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) throw new Fatal(msg);
      last = new Error(msg);
    } catch (e) {
      if (e instanceof Fatal) throw e;
      last = e;
    }
    console.warn(`[signal-alerts] attempt ${attempt + 1}/${RETRIES} failed: ${(last as Error)?.message || last}`);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function restAll(p: string): Promise<any[]> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await (await rest(`${p}&limit=${PAGE}&offset=${offset}`)).json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** the live book: upcoming.json's lots (eager, slim), else the corpus filtered
 *  (duplicated from match-alerts.ts on purpose — standalone entry points) */
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

const altId = (id: string) => (id.endsWith('~') ? id.slice(0, -1) : `${id}~`);

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

  const live = readLiveLots('[signal-alerts]');
  const byId = new Map<string, any>();
  for (const l of live) byId.set(String(l.id), l);
  const resolve = (id: string) => byId.get(id) ?? byId.get(altId(id));

  const now = Date.now();
  const isBelow = (l: any) => String(l?.value?.signal?.label || '').startsWith('below');
  const isLive = (l: any) => l && l.status === 'upcoming' && !l.resultsPending;

  const byUser = new Map<string, any[]>();
  for (const r of saved) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  }

  // ── 1 · WATCHLIST SIGNALS — watched lots newly reading below market.
  // "Newly": the save's baseline (signed convention: positive = below at
  // save) did NOT already claim below. A legacy unsigned baseline (saved
  // pre-2026-08-27) can't prove direction, so a positive legacy value is
  // treated as possibly-already-below and does NOT alert (never cry wolf).
  let watchWritten = 0;
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
  const freshBelow = live.filter(l =>
    isLive(l) && isBelow(l) && l.firstSeen &&
    now - Date.parse(String(l.firstSeen)) < FRESH_MS);
  let vertWritten = 0;
  if (freshBelow.length) {
    // A watched lot that is no longer live is not in upcoming.json. Its market
    // comes from the saved_artist snapshot; ONLY legacy rows without one need
    // the corpus, loaded once and lazily — and only for those ids.
    let settledArtist: Map<string, string> | null = null;
    const needCorpus = new Set<string>();
    for (const rows of Array.from(byUser.values())) {
      for (const r of rows) if (!resolve(String(r.lot_id)) && !r.saved_artist) needCorpus.add(String(r.lot_id));
    }
    if (needCorpus.size) {
      console.log(`[signal-alerts] ${needCorpus.size} watched lots are settled with no saved_artist snapshot — reading the corpus once for their makers`);
      settledArtist = new Map();
      for (const l of readCorpus() as any[]) {
        const id = String(l.id);
        if (l.artist && (needCorpus.has(id) || needCorpus.has(altId(id)))) settledArtist.set(id, String(l.artist));
      }
    }
    for (const [userId, rows] of Array.from(byUser.entries())) {
      // the user's markets, from their watched lots' artists (live book first,
      // saved_artist snapshot next, corpus for legacy settled rows)
      const markets = new Set<string>();
      for (const r of rows) {
        const id = String(r.lot_id);
        const lot = resolve(id);
        const artist = lot?.artist ?? r.saved_artist ?? settledArtist?.get(id) ?? settledArtist?.get(altId(id));
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

  // ── 3 · HAMMER DAY — watched lots that close within the next 24h land in
  // the inbox the morning of. The alerts UNIQUE(search_id, lot_id) makes
  // this once-per-lot by construction; saleDateTime when the house
  // publishes a close time, saleDate day-window otherwise.
  const closesWithin24h = (l: any): boolean => {
    const sdt = l?.saleDateTime;
    if (sdt) {
      const t = Date.parse(String(sdt));
      return Number.isFinite(t) && t > now && t - now < 24 * 3600 * 1000;
    }
    const day = String(l?.saleDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const dayEnd = Date.parse(`${day}T23:59:59Z`);
    return Number.isFinite(dayEnd) && dayEnd > now && dayEnd - now < 36 * 3600 * 1000;
  };
  let hammerWritten = 0;
  for (const [userId, rows] of Array.from(byUser.entries())) {
    const hits: string[] = [];
    for (const r of rows) {
      const lot = resolve(String(r.lot_id));
      if (!isLive(lot) || !closesWithin24h(lot)) continue;
      hits.push(String(lot.id));
    }
    if (!hits.length) continue;
    const searchId = await ensureSyntheticSearch(synthetic, userId, 'closing', HAMMER_NAME);
    await insertAlerts(hits.map(lot_id => ({ user_id: userId, search_id: searchId, lot_id })));
    hammerWritten += hits.length;
  }

  console.log(`[signal-alerts] watchlist=${watchWritten} markets=${vertWritten} hammer=${hammerWritten} across ${byUser.size} users (${freshBelow.length} fresh below-market lots)`);
}

main().catch(e => { console.error(e); process.exit(1); });
