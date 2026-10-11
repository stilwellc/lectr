/**
 * quickstart.ts — "What do you collect?" (Oct 11 2026), the pure half.
 *
 * A brand-new or signed-out reader has nothing for the recommender to read,
 * so "Lots you may like" and home's For you are empty. The quick start asks
 * three things and stores the answers as what the app already understands:
 *   1. markets          (remembered in app/lib/interests, never a follow)
 *   2. names + categories → FOLLOWS (app/lib/follows: makers, players,
 *      Pokémon / films / sets / teams by entity id, sub-categories)
 *   3. a price range    (optional; app/lib/interests)
 * The names offered are the market's TOP LIVE entities — the ones with the
 * most lots on the block right now (the /makers live join, app/lib/entity/
 * live) labeled from entities-<market>.json — so every tap leads straight to
 * real picks. Nothing here invents a pick: the recommender still needs a real
 * tie between a followed name and a live lot.
 */
import { ARTIST_LABEL, MARKETS, marketOf, type Market } from '../constants';
import type { AuctionLot } from '../types';
import { catFollow, entityFollow, makerFollow, sameFollow, type Follow } from './follows';
import { groupByCat, groupByMaker, groupByName, type LiveEntry } from './entity/live';
import { SCIENCE_COLLECTIONS, subEntityLabel } from './entity/key';
import { subPartsOf } from './entity/model';
import { SUBS, type CatKey } from './taxonomy';
import { bestLotImage } from './img-host';

/** the markets the picker offers (every live vertical; 'all' is not a taste) */
export const QS_MARKETS = MARKETS.filter(m => m.key !== 'all' && m.live);
export const isMakerMarket = (m: Market) => m === 'art' || m === 'design' || m === 'watches';

/** an entity id as the follow that matches its lots (null: nothing to follow —
 *  a remainder row, a malformed id, a sub the taxonomy no longer has) */
export function followOfEntity(id: string, label: string): Follow | null {
  if (id.startsWith('mk:') || id.startsWith('pl:')) {
    const slug = id.slice(3);
    return slug ? makerFollow(slug, label) : null;
  }
  if (id.startsWith('sj:') || id.startsWith('st:')) return id.includes('|') ? entityFollow(id, label) : null;
  const sp = subPartsOf(id);
  if (sp) {
    // a science collection (Meteorites, Fossils) is keyed on the lot's own
    // artist slug, not a taxonomy sub — follow it as that slug
    if (sp.cat === 'space-science' && SCIENCE_COLLECTIONS.has(sp.sub)) return makerFollow(sp.sub, label);
    const subs = SUBS[sp.cat as CatKey];
    if (!subs || !subs.some(s => s.key === sp.sub)) return null;
    return catFollow(sp.cat as CatKey, sp.sub);
  }
  return null;
}

export interface QsOption {
  /** the entity id (mk:/pl:/sj:/st:/cs:) */
  id: string;
  label: string;
  /** a face: the summary's image, else the best photo among its live lots */
  face: string | null;
  /** lots on the block now */
  live: number;
  follow: Follow;
}

/** a summary the entities file holds for an id (label + face) */
export type SummaryOf = (id: string) => { label: string; face: string | null } | null | undefined;

const byLive = (a: QsOption, b: QsOption) => b.live - a.live || a.label.localeCompare(b.label);

/** live lots of one market (the caller passes the on-block pool) */
export function marketLots(pool: readonly AuctionLot[], market: Market): AuctionLot[] {
  return pool.filter(l => marketOf(l.artist) === market);
}

/** the market's top live NAMES: makers on a maker market; players, Pokémon,
 *  films, sets, teams on a collection market — most lots on the block first */
export function topNames(lots: readonly AuctionLot[], market: Market, summaryOf: SummaryOf, n = 16): QsOption[] {
  const out: QsOption[] = [];
  const push = (id: string, e: LiveEntry, fallback: string) => {
    const s = summaryOf(id);
    const label = s?.label || fallback;
    if (!label) return;
    const follow = followOfEntity(id, label);
    if (!follow) return;
    out.push({ id, label, face: s?.face || bestLotImage(e.lots), live: e.lots.length, follow });
  };
  if (isMakerMarket(market)) {
    groupByMaker(lots).forEach((e, id) => push(id, e, ARTIST_LABEL[id.slice(3)] || ''));
  } else {
    groupByName(lots).forEach((e, id) => {
      if (id.startsWith('~:') || id.startsWith('mk:')) return;
      // a summary's label is the canon; an id the file lacks reads its lots' spelling
      push(id, e, summaryOf(id)?.label ? '' : e.name);
    });
  }
  return out.sort(byLive).slice(0, n);
}

/** the market's popular sub-categories (followed as categories) */
export function topCats(lots: readonly AuctionLot[], n = 6): QsOption[] {
  const out: QsOption[] = [];
  groupByCat(lots).forEach((e, id) => {
    const sp = subPartsOf(id);
    if (!sp || sp.sub === 'other' || sp.sub.startsWith('other-')) return;
    const label = subEntityLabel(sp.cat as CatKey, sp.sub);
    const follow = followOfEntity(id, label);
    if (follow) out.push({ id, label, face: null, live: e.lots.length, follow });
  });
  return out.sort(byLive).slice(0, n);
}

/** a name search over the market's entities file (labels), live ones first */
export function searchNames(
  q: string,
  entries: readonly { id: string; label: string; face: string | null }[],
  liveOf: (id: string) => number,
  n = 8,
): QsOption[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: (QsOption & { rank: number })[] = [];
  for (const e of entries) {
    const lab = e.label.toLowerCase();
    const at = lab.indexOf(needle);
    if (at < 0) continue;
    const follow = followOfEntity(e.id, e.label);
    if (!follow) continue;
    // a word start beats a mid-word hit ("char" → Charizard before Richard)
    const rank = at === 0 ? 0 : /[\s\-·&(]/.test(lab[at - 1]) ? 1 : 2;
    hits.push({ id: e.id, label: e.label, face: e.face, live: liveOf(e.id), follow, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || (b.live > 0 ? 1 : 0) - (a.live > 0 ? 1 : 0) || b.live - a.live || a.label.localeCompare(b.label));
  return hits.slice(0, n).map(({ rank: _r, ...o }) => o);
}

/* ── the picker's state ─────────────────────────────────────────────────── */

export type QsStep = 'markets' | 'names' | 'price';
export const QS_STEPS: QsStep[] = ['markets', 'names', 'price'];

export interface QsState {
  step: QsStep;
  markets: Market[];
  picked: Follow[];
  minUsd: number | null;
  maxUsd: number | null;
}

export type QsAction =
  | { t: 'market'; m: Market }
  | { t: 'pick'; f: Follow }
  | { t: 'min'; usd: number | null }
  | { t: 'max'; usd: number | null }
  | { t: 'next' }
  | { t: 'back' }
  | { t: 'go'; step: QsStep }
  | { t: 'reset'; s: QsState };

/** open the picker on what the reader already has: their follows picked, their
 *  markets (stored, else read off the follows) chosen — editing starts on the
 *  names when there are markets to show */
export function initQs(
  follows: readonly Follow[],
  stored: { markets: Market[]; minUsd: number | null; maxUsd: number | null },
  marketOfFollow: (f: Follow) => Market | null = defaultMarketOfFollow,
): QsState {
  const markets = new Set<Market>(stored.markets);
  if (!markets.size) for (const f of follows) { const m = marketOfFollow(f); if (m) markets.add(m); }
  const ms = QS_MARKETS.map(m => m.key).filter(k => markets.has(k));
  return {
    step: ms.length && follows.length ? 'names' : 'markets',
    markets: ms,
    picked: follows.filter(f => f.kind !== 'house'),
    minUsd: stored.minUsd,
    maxUsd: stored.maxUsd,
  };
}

/** the market a follow belongs to, when the follow says (houses span markets) */
export function defaultMarketOfFollow(f: Follow): Market | null {
  if (f.kind === 'maker') { const m = marketOf(f.key); return m === 'all' ? null : m; }
  if (f.kind === 'entity') { const m = f.key.slice(3, f.key.indexOf('|')) as Market; return QS_MARKETS.some(x => x.key === m) ? m : null; }
  if (f.kind === 'cat') {
    const cat = f.key.split(':')[0];
    const hit = Object.entries(CAT_MARKETS).find(([, cats]) => cats.includes(cat));
    return (hit?.[0] as Market) ?? null;
  }
  return null;
}
const CAT_MARKETS: Partial<Record<Market, string[]>> = {
  art: ['fine-art'], design: ['design'], watches: ['watches'],
  sports: ['sports-cards', 'sports-memorabilia'], tcg: ['tcg'],
  science: ['space-science'], culture: ['entertainment', 'historical'],
};

/** can the reader move on from this step? */
export function canAdvance(s: QsState): boolean {
  if (s.step === 'markets') return s.markets.length > 0;
  if (s.step === 'names') return s.picked.length > 0;
  return true;
}

export function qsReduce(s: QsState, a: QsAction): QsState {
  switch (a.t) {
    case 'market': {
      const on = s.markets.includes(a.m);
      const markets = on ? s.markets.filter(m => m !== a.m) : QS_MARKETS.map(m => m.key).filter(k => k === a.m || s.markets.includes(k));
      return { ...s, markets };
    }
    case 'pick': {
      const on = s.picked.some(p => sameFollow(p, a.f));
      return { ...s, picked: on ? s.picked.filter(p => !sameFollow(p, a.f)) : [...s.picked, a.f] };
    }
    case 'min': {
      const minUsd = a.usd && a.usd > 0 ? a.usd : null;
      // a floor at or above the ceiling drops the ceiling (never an empty range)
      return { ...s, minUsd, maxUsd: minUsd != null && s.maxUsd != null && s.maxUsd <= minUsd ? null : s.maxUsd };
    }
    case 'max': {
      const maxUsd = a.usd && a.usd > 0 ? a.usd : null;
      return { ...s, maxUsd, minUsd: maxUsd != null && s.minUsd != null && s.minUsd >= maxUsd ? null : s.minUsd };
    }
    case 'next': {
      if (!canAdvance(s)) return s;
      const i = QS_STEPS.indexOf(s.step);
      return i < QS_STEPS.length - 1 ? { ...s, step: QS_STEPS[i + 1] } : s;
    }
    case 'back': {
      const i = QS_STEPS.indexOf(s.step);
      return i > 0 ? { ...s, step: QS_STEPS[i - 1] } : s;
    }
    case 'reset': return a.s;
    case 'go': {
      // forward only through steps that are satisfied
      const to = QS_STEPS.indexOf(a.step), from = QS_STEPS.indexOf(s.step);
      if (to <= from) return { ...s, step: a.step };
      let cur = s;
      while (QS_STEPS.indexOf(cur.step) < to) { const nx = qsReduce(cur, { t: 'next' }); if (nx === cur) return cur; cur = nx; }
      return cur;
    }
  }
}
