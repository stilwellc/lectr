/**
 * entity/model.ts — THE ONE ENTITY MODEL (makers overhaul P1, Oct 10 2026).
 *
 * Every row on /makers — a maker, a player, a Pokémon / film / mission /
 * franchise (a "subject"), a sealed set, a clean sub-category — is one
 * EntitySummary. The build (scripts/emit-entities, data agent) writes them to
 * pages/entities-<market>.json; until a data build carries those files the
 * client builds the same shape from today's stats.json / players.json /
 * cat-stats.json (app/hooks/useEntities fail-soft adapters).
 *
 * LIVE COUNTS ARE NOT IN THE SUMMARY. The client joins live lots to entities
 * by the lot's entity key (`ek`, stamped at build) — app/lib/entity/live.ts.
 *
 * ID GRAMMAR (one string, prefix = kind — app/lib/entity/key.ts entityKeyOf
 * files every lot, parseEntityId reads an id):
 *   mk:<artistSlug>              a roster maker (art / design / watches)
 *   pl:<playerSlug>              an athlete (sports)
 *   sj:<market>|<subjectKey>     a Pokémon / person / film / franchise /
 *                                mission / team / brand (maker-subjects keys)
 *   st:<market>|<setKey>         a sealed set / product line ("s:<set>" keys)
 *   cs:<cat>:<sub>               a clean sub-category (taxonomy), the
 *                                "unnamed" home of every lot no reader names
 */
import type { Market } from '../../constants';

export type EntityKind = 'maker' | 'player' | 'subject' | 'set' | 'sub';

export interface EntityRef { id: string; kind: EntityKind; market: Market }

export interface EntityRecord {
  /** price (USD) */
  p: number;
  /** ISO day */
  d: string;
  /** title — absent on the slim wire (the detail bucket's top[0] carries it: recordOf) */
  t?: string;
  /** house — absent on the slim wire, as the title */
  h?: string;
  id?: string;
  img?: string | null;
}

export interface EntitySummary extends EntityRef {
  label: string;
  /** 'pokemon' | 'film' | 'mission' | 'person' | 'team' | 'band' | 'franchise' | 'brand' | … */
  subKind?: string | null;
  /** the row's existing tag text ('Watchmaker', 'Baseball', 'Vintage (1996–2003)') */
  discipline: string | null;
  /** image url from the entity's best lot */
  face: string | null;
  /** canonical page href ('/makers/rolex' | '/player?id=x' | a scoped feed) */
  page: string | null;
  /** all-time sold n — the SAME scope as med12m/record unless medScope says otherwise */
  sold: number | null;
  sold12m: number | null;
  med12m: number | null;
  med12mN: number | null;
  /** what the median is over: 'all' | 'cards' | 'unique works' | … */
  medScope: string | null;
  record: EntityRecord | null;
  /** complete quarters only (never the partial current quarter); null = thin quarter (n<3) */
  spark: (number | null)[] | null;
  sparkN: number[] | null;
  /** like for like (app/lib/entity/stats yoyOf): 'matched' = the median of
   *  per-identity ratios, n = identities sold in both years; 'median' = pooled
   *  medians, only on a stable intake, n = the smaller year */
  yoy: { pct: number; n: number; basis: 'matched' | 'median' | 'index' } | null;
  /** market.json verified mover, passed through */
  verified: unknown | null;
  /** sold12m < 5 → sorts below well-supported rows */
  thin: boolean;
  caps: { compare: boolean; follow: string | null; dossier: boolean };
  /* ── optional, additive (client-core): fields today's ledger prints that
     the contract summary doesn't name yet. The emitter may fill them; the
     fail-soft adapters always do. ── */
  /** total hammer tracked, all time (USD) — "Settled $" */
  revenue?: number | null;
  /** when sold12m is NOT a true 365-day count: the start year of the span it covers */
  sold12mSince?: string | null;
  /** (data) the clean `cat:sub` lens med12m / spark / yoy read — medScope is its label */
  medLens?: string | null;
}

/** the record with its title / house / image: the summary's [price, day]
 *  matched to the detail's top results (the record is top[0] on a sale tie
 *  broken by the newest day — matched on price + day, never assumed) */
export function recordOf(rec: EntityRecord | null, detail: { top?: EntityResultRow[] } | null): EntityRecord | null {
  if (!rec || (rec.t && rec.h)) return rec;
  const hit = detail?.top?.find(r => Math.round(r.p) === Math.round(rec.p) && r.d === rec.d);
  return hit ? { ...rec, t: rec.t || hit.t, h: rec.h || hit.h, id: rec.id ?? hit.id, img: rec.img ?? hit.img } : rec;
}

/** one result row (top / recent / a lens's top) */
export interface EntityResultRow { id: string; img: string | null; p: number; d: string; t: string; h: string; cat: string }

/** per-entity detail (pages/entity-<bb>.json; fail-soft from the same old files) */
export interface EntityDetail {
  /** every year with a sale; the current year is marked partial */
  yearly: { y: number; med: number | null; n: number; partial?: true }[];
  houses: { h: string; n: number }[];
  cats: { key: string; label: string; n: number; med12m: number | null; med12mN: number }[];
  top: EntityResultRow[];
  recent: EntityResultRow[];
  /** (>1 coarse lens only) unique vs editions, cards vs memorabilia — n all-time, n12 / med the trailing year */
  lensSplit?: { key: string; label: string; n: number; n12: number; med: number | null; yearly: { y: number; med: number | null; n: number; partial?: true }[]; top: EntityResultRow[] }[];
  /** (Pokémon / sets: grade + language; missions: flown / signed) the live
   *  chips' cuts over the sold history — app/lib/entity/facets */
  facets?: { key: 'grade' | 'lang' | 'object'; label: string; scope?: string; rows: { key: string; label: string; n: number; n12: number; med12m: number | null }[] }[];
}

/** a decoded entities file (app/lib/entity/wire decodes the v2 wire into this) */
export interface EntitiesFile {
  generatedAt: string;
  lastCrawl: string;
  /** (data) the complete quarters every summary's spark covers, oldest first */
  sparkQ?: string[];
  entities: EntitySummary[];
}

/* ── id helpers ── */

export const ID_PREFIX: Record<EntityKind, string> = { maker: 'mk:', player: 'pl:', subject: 'sj:', set: 'st:', sub: 'cs:' };

export const makerId = (slug: string) => `mk:${slug}`;
export const playerId = (slug: string) => `pl:${slug}`;
export const subjectId = (market: Market, key: string) => `sj:${market}|${key}`;
export const setId = (market: Market, key: string) => `st:${market}|${key}`;
export const subId = (cat: string, sub: string) => `cs:${cat}:${sub}`;

/** the kind an id names, from its prefix (null: not an entity id) */
export function kindOfId(id: string): EntityKind | null {
  switch (id.slice(0, 3)) {
    case 'mk:': return 'maker';
    case 'pl:': return 'player';
    case 'sj:': return 'subject';
    case 'st:': return 'set';
    case 'cs:': return 'sub';
    default: return null;
  }
}

/** the id's body after its prefix */
export const idBody = (id: string) => id.slice(3);

/** a maker id's artist slug (null for every other kind) */
export const makerSlugOf = (id: string): string | null => (id.startsWith('mk:') ? id.slice(3) : null);

/** a sub id's taxonomy cat + sub */
export function subPartsOf(id: string): { cat: string; sub: string } | null {
  if (!id.startsWith('cs:')) return null;
  const body = id.slice(3);
  const i = body.indexOf(':');
  return i < 0 ? null : { cat: body.slice(0, i), sub: body.slice(i + 1) };
}

/** a subject / set id's market + maker-subjects key ('sj:tcg|k:charizard' → tcg, 'k:charizard') */
export function subjectPartsOf(id: string): { market: Market; key: string } | null {
  if (!id.startsWith('sj:') && !id.startsWith('st:')) return null;
  const body = id.slice(3);
  const i = body.indexOf('|');
  return i < 0 ? null : { market: body.slice(0, i) as Market, key: body.slice(i + 1) };
}
