'use client';
/**
 * useEntities / useEntity — the entity summaries every /makers row reads
 * (makers overhaul P1, Oct 10 2026).
 *
 * SOURCE ORDER, per id:
 *   1. pages/entities-<market>.json (the nightly's one-stats-function
 *      summaries — scripts/emit-entities, data agent), on the slim v2 wire
 *      (app/lib/entity/wire decodes it; a v1 file still reads as-is). The
 *      main file holds makers + every live entity + the top sold-only; the
 *      rest sit in entities-<market>-tail.json, fetched only when a row
 *      needs an id the main file lacks (or a caller asks: opts.tail);
 *   2. FAIL-SOFT ADAPTERS over today's files, so the site never breaks on a
 *      data build that predates the entities files:
 *        mk:  stats.json (+ market.json verified movers, page-stats faces)
 *        cs:  cat-stats.json (per-sport rows under a sport pick)
 *        pl: / sj: / st:  the live book's own groups + players.json for
 *             athletes (what the ledger printed before the overhaul)
 *
 * Every bundle object is memoized against its inputs, so a row whose summary
 * did not change keeps its identity across filter re-cuts.
 */
import { useEffect, useMemo, useState } from 'react';
import { ARTISTS, ARTIST_LABEL, type Market } from '../constants';
import type { MarketStats } from '../types';
import type { CatStat } from '../../scripts/cat-stats';
import { useRayData } from './useRayData';
import { loadPageStats, bucketOf, type PageStats } from '../lib/page-data';
import { verifiedMovers, type VerifiedMover } from '../preview/terminal/verified';
import { taxonOf, SUBS, CAT_LABEL, SPORTS, subLabel, type CatKey } from '../lib/taxonomy';
import { subjectFeedHref } from '../lib/maker-subjects';
import {
  makerId, subId, kindOfId, subjectPartsOf,
  type EntitySummary, type EntityDetail, type EntitiesFile, type EntityRecord,
} from '../lib/entity/model';
import {
  DISCIPLINE, COLLECTION_CATS, PLAYER_CAT, REST_TAG, FR_DOMAIN, pageHrefOf, followKeyOf, KIND,
} from '../lib/entity/kinds';
import type { NameEntry } from '../lib/entity/live';
import { decodeEntities, isEntitiesWire } from '../lib/entity/wire';

/** a summary + its detail when the source already holds it (the adapters do) */
export interface EntityBundle {
  s: EntitySummary;
  detail: EntityDetail | null;
  /** an entities-file summary: the complete quarters its spark covers */
  sparkQ?: string[] | null;
  /** a By-name subject: its best live photo (the unfiltered live group's first) */
  liveFace?: string | null;
}

/** a players.json dossier — the sold history an athlete row can honestly carry */
export interface PlayerRec {
  slug: string; name?: string; n: number; sport: string | null;
  cats: Record<string, { n: number; medUsd: number | null; ttmMedUsd: number | null }>;
  yearly?: { y: number; med: number; n: number }[];
  objects: { id: string; d: string; p: number; t: string; cat: string }[];
}

/* ── module caches (one fetch per session; remounts never refetch) ── */
const BASE = '/data/ray';
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    // a host that answers a missing file with an HTML page fails the parse → null
    return (await r.json()) as T;
  } catch { return null; }
}
const verOf = (v?: string) => (v ? `?v=${encodeURIComponent(v)}` : '');
/** a decoded entities file (main or tail) */
export type LoadedEntities = EntitiesFile & { tier?: 'main' | 'tail'; tailN?: number };
/** the v2 wire decoded; a v1 file (summaries inline) as-is; else null */
export function readEntitiesFile(j: unknown): LoadedEntities | null {
  if (isEntitiesWire(j)) return decodeEntities(j);
  return j && Array.isArray((j as EntitiesFile).entities) ? (j as EntitiesFile) : null;
}
const entitiesP = new Map<string, Promise<LoadedEntities | null>>();
/** a data build without entities files carries no entity-<bb> buckets either */
let entitiesMissing = false;
export function loadEntities(market: Market, ver?: string): Promise<LoadedEntities | null> {
  let p = entitiesP.get(market);
  if (!p) {
    p = getJson<unknown>(`${BASE}/pages/entities-${market}.json${verOf(ver)}`)
      .then(j => {
        const ok = readEntitiesFile(j);
        if (!ok) entitiesMissing = true;
        return ok;
      });
    entitiesP.set(market, p);
  }
  return p;
}
const tailP = new Map<string, Promise<LoadedEntities | null>>();
/** the sold-only long tail (lazy: a row needs an id the main file lacks) */
export function loadEntitiesTail(market: Market, ver?: string): Promise<LoadedEntities | null> {
  let p = tailP.get(market);
  if (!p) {
    p = getJson<unknown>(`${BASE}/pages/entities-${market}-tail.json${verOf(ver)}`).then(readEntitiesFile);
    tailP.set(market, p);
  }
  return p;
}
let catP: Promise<Record<string, CatStat> | null> | null = null;
export function loadCatStats(): Promise<Record<string, CatStat> | null> {
  if (!catP) catP = getJson<{ rows?: Record<string, CatStat> }>(`${BASE}/cat-stats.json`).then(j => j?.rows ?? null);
  return catP;
}
let playersP: Promise<Map<string, PlayerRec> | null> | null = null;
export function loadPlayers(): Promise<Map<string, PlayerRec> | null> {
  if (!playersP) playersP = getJson<{ players?: PlayerRec[] }>(`${BASE}/players.json`)
    .then(j => (j?.players ? new Map(j.players.map(p => [p.slug, p])) : null));
  return playersP;
}
const detailP = new Map<string, Promise<Record<string, EntityDetail> | null>>();
export function loadEntityDetail(id: string, ver?: string): Promise<EntityDetail | null> {
  const b = bucketOf(id);
  let p = detailP.get(b);
  if (!p) { p = getJson<Record<string, EntityDetail>>(`${BASE}/pages/entity-${b}.json${verOf(ver)}`); detailP.set(b, p); }
  return p.then(m => (m && m[id]) || null);
}
/** test seam: forget every cached fetch */
export function _resetEntityCaches() { entitiesP.clear(); tailP.clear(); catP = null; playersP = null; detailP.clear(); entitiesMissing = false; }

/** a promise's value as state (undefined = pending, null = absent).
 *  `keep`: while a NEW loader is pending, return the last one's value (a
 *  market switch keeps the ledger up instead of falling back to loading) */
function useLoad<T>(load: (() => Promise<T | null>) | null, keep = false): T | null | undefined {
  const [v, setV] = useState<{ f: unknown; v: T | null } | null>(null);
  useEffect(() => {
    if (!load) return;
    let on = true;
    load().then(x => { if (on) setV({ f: load, v: x }); });
    return () => { on = false; };
  }, [load]);
  if (!load || !v) return undefined;
  return v.f === load || keep ? v.v : undefined;
}

/* ── the quarter rule — the current quarter is a handful of early sales,
   never a print to draw (Rolex read −95% off one $851 lot) ── */
export function currentQuarter(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
export function completeQuarters<T extends { date: string | number }>(hist: readonly T[], now = Date.now()): T[] {
  const cur = currentQuarter(now);
  return hist.filter(p => String(p.date) !== cur);
}

const EMPTY_DETAIL: EntityDetail = { quarters: [], yearly: [], houses: [], cats: [], top: [], recent: [] };

/* ═════════ FAIL-SOFT ADAPTERS (pure) ═════════ */

/** a roster maker from stats.json — the exact figures the ledger printed */
export function makerBundle(slug: string, market: Market, st: MarketStats | null, verified: VerifiedMover | null, face: string | null, now = Date.now()): EntityBundle {
  const hist = completeQuarters(st?.priceHistory || [], now);
  const sparkVals = hist.slice(-12).map(p => p.medianPrice || p.avgPrice).filter(v => v > 0);
  const sold = st?.totalSoldTracked ?? null;
  const st12 = st as (MarketStats & { sold12m?: number; sold12mWindow?: { days: number } }) | null;
  // "12mo sold" only from compute-stats' calendar-365 field; else the last
  // four complete quarters, printed with the year they start in
  const velocityTrue = !!st12 && typeof st12.sold12m === 'number' && st12.sold12mWindow?.days === 365;
  const tail = hist.slice(-4);
  const tailCount = tail.reduce((s, p) => s + (p.totalSales || 0), 0);
  const record: EntityRecord | null = st?.recordPrice
    ? { p: st.recordPrice, d: String(st.recordDate || ''), t: st.recordTitle || '', h: st.recordHouse || '' }
    : null;
  const id = makerId(slug);
  const s: EntitySummary = {
    id, kind: 'maker', market,
    label: ARTIST_LABEL[slug] || slug,
    discipline: DISCIPLINE[slug] || null,
    face,
    page: pageHrefOf(id),
    sold,
    sold12m: velocityTrue ? st12!.sold12m! : tailCount,
    sold12mSince: velocityTrue ? null : (tail.length ? String(tail[0].date).slice(0, 4) : null),
    med12m: st?.medianPriceLast12Months || null,
    med12mN: null,
    medScope: null,
    record,
    spark: sparkVals.length >= 4 ? sparkVals : null,
    sparkN: null,
    yoy: null,
    verified,
    // the ledger's existing "thin history" tag rule (all-time n < 50)
    thin: sold != null && sold > 0 && sold < 50,
    caps: { compare: KIND.maker.compare, follow: followKeyOf(id), dossier: true },
    revenue: st?.totalAuctionRevenue || 0,
  };
  const detail: EntityDetail | null = st ? {
    ...EMPTY_DETAIL,
    quarters: (st.priceHistory || []).map(p => ({ q: String(p.date), med: p.medianPrice || p.avgPrice, n: p.totalSales || 0, high: p.highPrice || 0 })),
    houses: (st.houseDistribution || []).map(h => ({ h: String(h.house), n: h.count })),
  } : null;
  return { s, detail };
}

/** a clean sub-category from cat-stats.json (per sport under a sport pick) */
export function subBundle(cat: CatKey, sub: string, label: string, market: Market, st: CatStat | null, sport: string | null, now = Date.now()): EntityBundle {
  const id = subId(cat, sub);
  const quarters = (st?.q || []).map(([q, med, n]) => ({ q, med, n, high: 0 }));
  const meds = completeQuarters(quarters.map(x => ({ date: x.q, med: x.med })), now).map(h => h.med).filter(v => v > 0);
  const sportsCat = cat === 'sports-cards' || cat === 'sports-memorabilia';
  const s: EntitySummary = {
    id, kind: 'sub', market, label,
    discipline: sportsCat && sport ? (SPORTS.find(x => x.key === sport)?.label ?? null) : CAT_LABEL[cat],
    face: null,
    page: pageHrefOf(id),
    sold: st?.sold ?? null,
    sold12m: st?.sold12m ?? 0,
    med12m: st?.median12m || null,
    med12mN: null, medScope: null,
    record: st?.record ? { p: st.record.price, d: st.record.date, t: st.record.title, h: st.record.house } : null,
    spark: meds.length >= 4 ? meds : null,
    sparkN: null, yoy: null, verified: null,
    thin: !!st && st.sold < 50,
    caps: { compare: KIND.sub.compare, follow: followKeyOf(id), dossier: true },
    revenue: st?.revenue ?? 0,
  };
  return { s, detail: st ? { ...EMPTY_DETAIL, quarters } : null };
}

function topKey(m: Map<string, number>): string | null {
  let best: string | null = null, n = 0;
  m.forEach((c, k) => { if (c > n) { n = c; best = k; } });
  return best;
}

/** a collection-market subject (player / Pokémon / person / film / set …)
 *  from its live group — sold history only where it is really that
 *  subject's: an athlete's players.json dossier. No quarterly series exists
 *  per subject, so no curve — never a borrowed line. */
export function nameBundle(id: string, g: NameEntry, players: Map<string, PlayerRec> | null, dossiers: ReadonlySet<string>): EntityBundle {
  const rest = id.startsWith('~:');
  const s0 = g.subject;
  const artN = new Map<string, number>(), subN = new Map<string, number>(), sportN = new Map<string, number>();
  for (const l of g.lots) {
    artN.set(l.artist, (artN.get(l.artist) || 0) + 1);
    const t = taxonOf(l);
    const sk = `${t.cat}:${t.sub}`; subN.set(sk, (subN.get(sk) || 0) + 1);
    if (t.sport) sportN.set(t.sport, (sportN.get(t.sport) || 0) + 1);
  }
  const domArt = topKey(artN), domSub = topKey(subN), domSport = topKey(sportN);
  const subTag = domSub ? subLabel(domSub.split(':')[0] as CatKey, domSub.split(':')[1]).replace(/ \(.*\)$/, '') : null;
  const isPlayer = s0?.kind === 'player' && !!s0.playerSlug;
  const pr = isPlayer ? players?.get(s0!.playerSlug!) : undefined;
  const catKey = domArt ? (PLAYER_CAT[domArt] ?? domArt) : null;
  const catRow = pr && catKey ? pr.cats[catKey] : undefined;
  const rec = pr?.objects?.[0];
  let discipline: string | null;
  if (!s0) discipline = REST_TAG[g.market] ?? 'no subject named';
  else if (s0.kind === 'player') discipline = (domSport && SPORTS.find(x => x.key === domSport)?.label) || pr?.sport || subTag;
  else if (s0.kind === 'film') discipline = 'Film & TV';
  else if (s0.kind === 'franchise') discipline = FR_DOMAIN[s0.key.slice(3)] ?? 'Film & TV';
  else discipline = subTag;
  const dossier = isPlayer && dossiers.has(s0!.playerSlug!);
  const kind = kindOfId(id) ?? 'subject';
  const page = rest ? subjectFeedHref(g.market, '~')
    : dossier ? `/player?id=${encodeURIComponent(s0!.playerSlug!)}`
    : (() => { const p = subjectPartsOf(id); return p ? subjectFeedHref(p.market, p.key) : pageHrefOf(id); })();
  const med = catRow?.ttmMedUsd || null;
  const s: EntitySummary = {
    id, kind: rest ? 'subject' : kind, market: g.market,
    label: s0 ? g.name : 'Other lots',
    subKind: s0?.kind ?? null,
    discipline,
    face: g.lots.find(l => l.imageUrl)?.imageUrl || null,
    page,
    sold: pr ? pr.n : null,
    sold12m: null,
    med12m: med,
    med12mN: null,
    // the row's median is one category's (the one most of their live lots
    // sit in) while Sold is every category — the scope rides the cell's note
    medScope: med && catKey ? (ARTIST_LABEL[catKey] || catKey).toLowerCase() : null,
    record: rec ? { p: rec.p, d: rec.d, t: rec.t, h: '', id: rec.id } : null,
    spark: null, sparkN: null, yoy: null, verified: null,
    thin: !!pr && pr.n < 50,
    caps: { compare: false, follow: dossier ? s0!.playerSlug! : null, dossier },
    revenue: 0,
  };
  return { s, detail: pr ? EMPTY_DETAIL : null };
}

/* ═════════ THE HOOKS ═════════ */

export interface Entities {
  /** where the summaries came from: the nightly's entities file, or the
   *  fail-soft adapters over today's files */
  source: 'entities' | 'adapter' | 'pending';
  /** roster makers (mk:), every market */
  makers: Map<string, EntityBundle>;
  /** By-category rows (cs: ids, cat-stats figures) — empty until cat-stats lands (subsReady) */
  subs: Map<string, EntityBundle>;
  /** By-name subjects (pl: / sj: / st: + each market's remainder row) */
  names: Map<string, EntityBundle>;
  subsReady: boolean;
  /** athletes' sold history has arrived (or isn't needed) */
  playersReady: boolean;
  /** the athletes with a /player dossier (page-stats playerIndex) */
  dossiers: ReadonlySet<string>;
  /** every summary the entities file holds for this market (main, + the
   *  tail once asked for) — the ledger's sold-only names; null on the
   *  adapter path (no file) */
  file: Map<string, EntityBundle> | null;
  /** the sold-only tail has arrived (or the file has none / wasn't asked) */
  tailReady: boolean;
}

const NO_SET: ReadonlySet<string> = new Set();

export interface UseEntitiesOpts {
  /** the unfiltered By-name live groups (entity/live namesAll) — a subject
   *  exists on the ledger while something of it is live */
  namesAll?: Map<string, NameEntry>;
  /** By-category rows wanted (loads cat-stats on the adapter path) */
  subs?: boolean;
  /** athlete rows wanted (loads players.json on the adapter path, after first paint) */
  players?: boolean;
  /** the sports sport pick (cat-stats per-sport rows) */
  sport?: string | null;
  /** fetch the sold-only tail now (a reader searching / paging past the
   *  main list for sold-only entities). A row whose id the main file lacks
   *  fetches it regardless. */
  tail?: boolean;
}

/**
 * useEntities(market) — every entity summary the /makers ledger can show for
 * `market`, keyed by entity id.
 */
export function useEntities(market: Market, opts: UseEntitiesOpts = {}): Entities {
  const { namesAll, subs: wantSubs = false, players: wantPlayers = false, sport = null, tail: wantTail = false } = opts;
  const { statsByArtist, market: marketData, lastCrawl } = useRayData();

  // 1. the nightly's file (absent on an older data build → the adapters).
  // Asked for at mount, in parallel with the eager book: pages/* revalidate
  // (public/_headers), so no ?v= is needed, and the ledger waits for the
  // answer (source 'pending') rather than paint adapter figures that the
  // file's would then replace
  const loadFile = useMemo(() => () => loadEntities(market), [market]);
  const file = useLoad(loadFile, true);
  const mainMap = useMemo(() => {
    if (!file) return null;
    if (file.lastCrawl && lastCrawl && file.lastCrawl !== lastCrawl) {
      // the coherence stamp: one crawl's summaries over another crawl's book
      console.warn(`[entities] entities-${market}.json is crawl ${file.lastCrawl}, the book is ${lastCrawl}`);
    }
    const m = new Map<string, EntityBundle>();
    const sparkQ = file.sparkQ ?? null;
    for (const s of file.entities) m.set(s.id, { s, detail: null, sparkQ });
    return m;
  }, [file, lastCrawl, market]);
  // the tail: only when asked, or when a live group's id is not in the main
  // file (the build's book and the reader's can differ by a crawl)
  const tailNeeded = useMemo(() => {
    if (!file || !file.tailN || !mainMap) return false;
    if (wantTail) return true;
    let miss = false;
    // only this market's live names (namesAll spans every market — a TCG
    // name is never in the sports file, and must not pull its tail)
    namesAll?.forEach((g, id) => { if (!miss && (market === 'all' || g.market === market) && !mainMap.has(id) && !id.startsWith('~:')) miss = true; });
    return miss;
  }, [file, mainMap, wantTail, namesAll, market]);
  const loadTail = useMemo(() => (tailNeeded ? () => loadEntitiesTail(market) : null), [tailNeeded, market]);
  const tailFile = useLoad(loadTail);
  const fileMap = useMemo(() => {
    if (!mainMap || !tailFile || !tailNeeded) return mainMap;
    const m = new Map(mainMap);
    const sparkQ = tailFile.sparkQ ?? file?.sparkQ ?? null;
    for (const s of tailFile.entities) if (!m.has(s.id)) m.set(s.id, { s, detail: null, sparkQ });
    return m;
  }, [mainMap, tailFile, tailNeeded, file]);
  const source: Entities['source'] = file === undefined ? 'pending' : file ? 'entities' : 'adapter';

  // page-stats: maker faces + the athletes with a dossier
  const pageStats = useLoad(loadPageStatsFn) as PageStats | null | undefined;
  const dossiers = useMemo(() => (pageStats?.playerIndex ? new Set(pageStats.playerIndex.map(p => p.slug)) : NO_SET), [pageStats]);

  // 2a. makers — stats.json is phase-1 eager, so this path is always ready
  const verifiedBySlug = useMemo(() => {
    const m = new Map<string, VerifiedMover>();
    if (marketData) for (const v of verifiedMovers(marketData)) m.set(v.slug, v);
    return m;
  }, [marketData]);
  const makers = useMemo(() => {
    const m = new Map<string, EntityBundle>();
    for (const a of ARTISTS) {
      const id = makerId(a.slug);
      const fromFile = fileMap?.get(id);
      const ad = makerBundle(a.slug, a.market as Market, statsByArtist[a.slug] || null,
        verifiedBySlug.get(a.slug) || null, pageStats?.makerFaces?.[a.slug]?.url || null);
      // the file's summary, with what it doesn't carry yet ("Settled $", a
      // face where the build found none) from the same files as before
      m.set(id, fromFile ? { ...fromFile, s: { ...fromFile.s, revenue: fromFile.s.revenue ?? ad.s.revenue, face: fromFile.s.face ?? ad.s.face } } : ad);
    }
    return m;
  }, [statsByArtist, verifiedBySlug, pageStats, fileMap]);

  // 2b. subs — By category is the CATEGORY's figures (cat-stats: every lot
  // in the sub, named or not). The entities file's cs: summaries are the
  // unnamed remainder only (a named lot keys to its subject), so they never
  // stand in for a category row.
  const catStats = useLoad(wantSubs ? loadCatStats : null);
  const subs = useMemo(() => {
    const m = new Map<string, EntityBundle>();
    if (!wantSubs || !catStats) return m;
    for (const c of COLLECTION_CATS) {
      for (const sub of SUBS[c.cat]) {
        const id = subId(c.cat, sub.key);
        const key = `${c.cat}:${sub.key}`;
        const sportsCat = c.cat === 'sports-cards' || c.cat === 'sports-memorabilia';
        const st = catStats[sportsCat && sport ? `${key}:${sport}` : key] || null;
        const label = c.prefix && !(c.cat === 'tcg' && sub.key === 'other-tcg') ? `${c.prefix} · ${sub.label}` : sub.label;
        m.set(id, subBundle(c.cat, sub.key, label, c.market, st, sport));
      }
    }
    return m;
  }, [wantSubs, catStats, sport]);
  const subsReady = !wantSubs || catStats !== undefined;

  // 2c. names — athletes' sold history after first paint (players.json ~3MB)
  const [playersLoad, setPlayersLoad] = useState<(() => Promise<Map<string, PlayerRec> | null>) | null>(null);
  const needPlayers = wantPlayers && source === 'adapter';
  useEffect(() => {
    if (!needPlayers || playersLoad) return;
    const t = window.setTimeout(() => setPlayersLoad(() => loadPlayers), 300);
    return () => window.clearTimeout(t);
  }, [needPlayers, playersLoad]);
  const players = useLoad(needPlayers ? playersLoad : null);
  const names = useMemo(() => {
    const m = new Map<string, EntityBundle>();
    if (!namesAll) return m;
    namesAll.forEach((g, id) => {
      const fromFile = fileMap?.get(id);
      const liveFace = g.lots.find(l => l.imageUrl)?.imageUrl || null;
      m.set(id, fromFile ? { ...fromFile, liveFace } : { ...nameBundle(id, g, players ?? null, dossiers), liveFace });
    });
    return m;
  }, [namesAll, players, dossiers, fileMap]);
  const playersReady = !needPlayers || players !== undefined;

  const tailReady = !tailNeeded || tailFile !== undefined;
  return { source, makers, subs, names, subsReady, playersReady, dossiers, file: fileMap, tailReady };
}
const loadPageStatsFn = () => loadPageStats();

/** prefetch By-category's figures ahead of the toggle (hover / focus) */
export function prefetchSubs(): void { void loadCatStats(); }

/**
 * useEntity(id) — one entity's summary + detail, when `enabled` (a dossier
 * opening). The detail comes from pages/entity-<bb>.json; on a data build
 * without those buckets, from the same old files the adapters read:
 * stats.json for a maker, cat-stats for a sub, players.json for an athlete.
 * `known` short-circuits with a bundle the caller already holds.
 */
export function useEntity(id: string | null, enabled = true, known?: EntityBundle | null): { summary: EntitySummary | null; detail: EntityDetail | null; loading: boolean } {
  const { statsByArtist, lastCrawl, loading: booting } = useRayData();
  const have = !!known?.detail;
  const load = useMemo(() => {
    if (!id || !enabled || have || booting) return null;
    return async (): Promise<EntityDetail | null> => {
      const d = entitiesMissing ? null : await loadEntityDetail(id, lastCrawl);
      if (d) return d;
      // fail soft
      const k = kindOfId(id);
      if (k === 'maker') {
        const st = statsByArtist[id.slice(3)];
        return st ? makerBundle(id.slice(3), 'all', st, null, null).detail : null;
      }
      if (k === 'sub') {
        const rows = await loadCatStats();
        const body = id.slice(3);
        const st = rows?.[body] || null;
        return st ? { ...EMPTY_DETAIL, quarters: st.q.map(([q, med, n]) => ({ q, med, n, high: 0 })) } : null;
      }
      if (k === 'player') {
        const pl = await loadPlayers();
        const pr = pl?.get(id.slice(3));
        if (!pr) return null;
        return {
          ...EMPTY_DETAIL,
          yearly: pr.yearly || [],
          cats: Object.entries(pr.cats).map(([key, c]) => ({ key, label: ARTIST_LABEL[key] || key, n: c.n, med12m: c.ttmMedUsd, med12mN: 0 })),
          top: pr.objects.map(o => ({ id: o.id, img: null, p: o.p, d: o.d, t: o.t, h: '', cat: o.cat })),
        };
      }
      return null;
    };
  }, [id, enabled, have, booting, lastCrawl, statsByArtist]);
  const loaded = useLoad(load);
  if (have) return { summary: known!.s, detail: known!.detail, loading: false };
  return { summary: known?.s ?? null, detail: loaded ?? null, loading: !!load && loaded === undefined };
}
