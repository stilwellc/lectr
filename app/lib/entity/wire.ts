/**
 * entity/wire.ts — THE ENTITIES FILE ON THE WIRE (makers overhaul P1 slim,
 * Oct 10 2026). One module encodes (scripts/emit-entities) and decodes
 * (app/hooks/useEntities), so the two can never drift.
 *
 * Why: the first prod night shipped entities-sports.json at 5.3MB raw /
 * 751KB brotli — every summary carried its record's full title + image + lot
 * id, a face URL, and a dozen fields the client can derive from the id.
 *
 * THE WIRE (v2) is columnar and slim:
 *   - derived, never shipped: kind · market · subKind · page (parseEntityId /
 *     entityPageOf), caps (spark / slug / sold ≥ MIN_SOLD), thin (sold12m <
 *     THIN_SOLD12M), medScope (the medLens label), a maker's or a sub's label
 *     (ARTIST_LABEL / subEntityLabel) when it equals the derived one
 *   - interned: discipline + medLens → small per-file dictionaries
 *   - record → [price, day] only (title / house / id / image live in the
 *     detail bucket: entity-<bb>.json `top`, whose first row is the record)
 *   - face → makers only, plus a live entity whose live lots carry no photo
 *     (every other row's hero is its live lot's photo — buildRow; a sold-only
 *     entity's face is its record's image, in the detail bucket)
 *
 * THE TIERS: entities-<market>.json (main) holds every maker, every entity
 * with ≥1 live lot, and the top MAIN_SOLD_ONLY sold-only entities by sold n;
 * the rest go to entities-<market>-tail.json, which the client asks for only
 * when it needs an id the main file lacks.
 */
import { ARTIST_LABEL } from '../../constants';
import { subLabel, CAT_LABEL, type CatKey } from '../taxonomy';
import { parseEntityId, entityPageOf, subEntityLabel } from './key';
import { THIN_SOLD12M, type Labels } from './stats';
import type { EntitySummary, EntitiesFile, EntityYoy } from './model';

/** sold-only entities need this much history to get a summary at all */
export const MIN_SOLD = 10;
/** sold-only entities in the main file, per file (by sold n) */
export const MAIN_SOLD_ONLY = 400;
/** the budgets (brotli bytes, prod scale) — scripts/emit-entities warns over them */
export const BUDGET_MARKET_BR = 150_000;
export const BUDGET_ALL_BR = 250_000;

export const WIRE_V = 2;

/** one market's categories read without their category prefix */
const SOLO_CAT_MARKET = new Set<CatKey>(['tcg', 'space-science', 'fine-art', 'design', 'watches']);
/** THE lens labels (a `cat:sub` key → its printed scope) — the build's
 *  medScope / cats / lensSplit labels and the client's decoded medScope */
export const LENS_LABELS: Labels = {
  lens: k => {
    const i = k.indexOf(':');
    const cat = k.slice(0, i) as CatKey, sub = k.slice(i + 1);
    const s = subLabel(cat, sub);
    return SOLO_CAT_MARKET.has(cat) ? s : `${CAT_LABEL[cat] || cat} · ${s}`;
  },
  coarse: k => (k.includes(':') ? LENS_LABELS.lens(k) : CAT_LABEL[k as CatKey] || k),
};

/** the label an id implies (makers, subs) — null: the label must ship */
export function derivedLabelOf(id: string): string | null {
  const p = parseEntityId(id);
  if (!p) return null;
  if (p.kind === 'maker') return ARTIST_LABEL[p.slug!] || p.slug!;
  if (p.kind === 'sub') return subEntityLabel(p.cat!, p.sub!);
  return null;
}

/** pages/entities-<market>[-tail].json, v2. Column i of every array is entity i. */
export interface EntitiesWire {
  v: 2;
  tier: 'main' | 'tail';
  generatedAt: string;
  lastCrawl: string;
  /** the complete quarters every spark covers, oldest first */
  sparkQ: string[];
  /** main: how many entities the tail file holds */
  tailN: number;
  /** (r7) main: the tail's ledger names (players / subjects / sets) per
   *  market — the ledger counts every name it tracks from first paint, not
   *  only the main tier's (QA2 Q5/Q6). Absent on older builds. */
  tailBy?: Record<string, number>;
  /** interned strings: disciplines, med lenses */
  ds: string[];
  ml: string[];
  c: {
    id: string[];
    /** label; 0 = derivedLabelOf(id) */
    l: (string | 0)[];
    /** discipline → ds index; -1 = null */
    d: number[];
    /** face; 0 = none on the wire */
    f: (string | 0)[];
    s: number[];
    s12: number[];
    /** med12m; 0 = null (a gated median is never 0) */
    m: number[];
    mn: number[];
    /** medLens → ml index; -1 = null */
    ml: number[];
    /** record [price, day]; 0 = none */
    r: ([number, string] | 0)[];
    sp: ((number | null)[] | 0)[];
    spn: (number[] | 0)[];
    /** yoy [pct, n] (basis median), [pct, n, 1] (basis index) or [pct, n, 2]
     *  (basis matched); since R7 [pct, n, 0|1|2, lo, hi] with its 90% interval;
     *  0 = none */
    y: ([number, number] | [number, number, 0 | 1 | 2] | [number, number, 0 | 1 | 2, number, number] | 0)[];
    /** (r7) spark basis: 1 = matched (same items, chained), 0 = median; absent on older files */
    sb?: (0 | 1)[];
  };
  /** verified movers by id (makers only, sparse) */
  vf: Record<string, unknown>;
}

export interface WireOpts {
  tier: 'main' | 'tail';
  generatedAt: string;
  lastCrawl: string;
  sparkQ: string[];
  tailN: number;
  tailBy?: Record<string, number>;
  /** an entity whose summary face the wire keeps (else the face is dropped) */
  keepFace: (s: EntitySummary) => boolean;
}

const YOY_BASIS: EntityYoy['basis'][] = ['median', 'index', 'matched'];
/** one yoy → its wire cell (the interval rides when the read carries one) */
export function yoyCell(y: EntityYoy): EntitiesWire['c']['y'][number] {
  const b = YOY_BASIS.indexOf(y.basis) as 0 | 1 | 2;
  if (y.lo != null && y.hi != null) return [y.pct, y.n, b, y.lo, y.hi];
  return b ? [y.pct, y.n, b] : [y.pct, y.n];
}
/** a wire cell → the yoy (older cells: no interval) */
export function yoyOfCell(y: Exclude<EntitiesWire['c']['y'][number], 0>): EntityYoy {
  const out: EntityYoy = { pct: y[0], n: y[1], basis: YOY_BASIS[y[2] ?? 0] ?? 'median' };
  if (y.length >= 5) { out.lo = y[3]; out.hi = y[4]; }
  return out;
}

/** summaries → the v2 wire */
export function encodeEntities(list: readonly EntitySummary[], o: WireOpts): EntitiesWire {
  const ds: string[] = [], ml: string[] = [];
  const dsIx = new Map<string, number>(), mlIx = new Map<string, number>();
  const ix = (arr: string[], m: Map<string, number>, v: string | null | undefined): number => {
    if (v == null) return -1;
    let i = m.get(v);
    if (i === undefined) { i = arr.length; arr.push(v); m.set(v, i); }
    return i;
  };
  const c: EntitiesWire['c'] = { id: [], l: [], d: [], f: [], s: [], s12: [], m: [], mn: [], ml: [], r: [], sp: [], spn: [], y: [], sb: [] };
  const vf: Record<string, unknown> = {};
  for (const e of list) {
    c.id.push(e.id);
    c.l.push(e.label === derivedLabelOf(e.id) ? 0 : e.label);
    c.d.push(ix(ds, dsIx, e.discipline));
    c.f.push(e.face && o.keepFace(e) ? e.face : 0);
    c.s.push(e.sold ?? 0);
    c.s12.push(e.sold12m ?? 0);
    c.m.push(e.med12m ? Math.round(e.med12m) : 0);
    c.mn.push(e.med12mN ?? 0);
    c.ml.push(ix(ml, mlIx, e.medLens));
    c.r.push(e.record ? [Math.round(e.record.p), e.record.d] : 0);
    c.sp.push(e.spark ? e.spark.map(v => (v == null ? null : Math.round(v))) : 0);
    c.spn.push(e.sparkN ?? 0);
    c.y.push(e.yoy ? yoyCell(e.yoy) : 0);
    c.sb!.push(e.spark && e.sparkBasis === 'matched' ? 1 : 0);
    if (e.verified != null) vf[e.id] = e.verified;
  }
  if (!c.sb!.some(Boolean)) delete c.sb;
  return { v: WIRE_V, tier: o.tier, generatedAt: o.generatedAt, lastCrawl: o.lastCrawl, sparkQ: o.sparkQ, tailN: o.tailN, ...(o.tailBy ? { tailBy: o.tailBy } : {}), ds, ml, c, vf };
}

/** is this payload the v2 wire? */
export const isEntitiesWire = (j: unknown): j is EntitiesWire =>
  !!j && typeof j === 'object' && (j as { v?: unknown }).v === WIRE_V && !!(j as { c?: { id?: unknown } }).c && Array.isArray((j as EntitiesWire).c.id);

/** the v2 wire → EntitySummary rows (the shape every consumer reads) */
export function decodeEntities(w: EntitiesWire): EntitiesFile & { tier: 'main' | 'tail'; tailN: number; tailBy?: Record<string, number> } {
  const { c } = w;
  const scope = w.ml.map(k => LENS_LABELS.lens(k));
  const entities: EntitySummary[] = [];
  for (let i = 0; i < c.id.length; i++) {
    const id = c.id[i];
    const p = parseEntityId(id);
    if (!p) continue;
    const sold = c.s[i];
    const spark = c.sp[i] || null;
    const r = c.r[i], y = c.y[i];
    const mlI = c.ml[i], dI = c.d[i];
    entities.push({
      id, kind: p.kind, market: p.market,
      label: c.l[i] || derivedLabelOf(id) || id,
      subKind: p.subKind,
      discipline: dI >= 0 ? w.ds[dI] : null,
      face: c.f[i] || null,
      page: entityPageOf(id),
      sold,
      sold12m: c.s12[i],
      med12m: c.m[i] || null,
      med12mN: c.mn[i],
      medScope: mlI >= 0 ? scope[mlI] : null,
      record: r ? { p: r[0], d: r[1] } : null,
      spark,
      sparkN: c.spn[i] || null,
      sparkBasis: spark ? (c.sb?.[i] ? 'matched' : 'median') : null,
      yoy: y ? yoyOfCell(y) : null,
      verified: w.vf[id] ?? null,
      thin: c.s12[i] < THIN_SOLD12M,
      caps: { compare: !!spark, follow: p.kind === 'maker' || p.kind === 'player' ? p.slug : p.kind === 'subject' || p.kind === 'set' ? id : null, dossier: sold >= MIN_SOLD },
      medLens: mlI >= 0 ? w.ml[mlI] : null,
    });
  }
  return { generatedAt: w.generatedAt, lastCrawl: w.lastCrawl, sparkQ: w.sparkQ, entities, tier: w.tier, tailN: w.tailN, ...(w.tailBy ? { tailBy: w.tailBy } : {}) };
}

/** the ledger's name kinds (a /makers By-name row) */
export const LEDGER_NAME_KINDS: ReadonlySet<string> = new Set(['player', 'subject', 'set']);
/** (r7) per market: how many ledger names a summary list holds */
export function ledgerNamesBy(list: readonly { id: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of list) {
    const p = parseEntityId(e.id);
    if (!p || !LEDGER_NAME_KINDS.has(p.kind)) continue;
    out[p.market] = (out[p.market] || 0) + 1;
  }
  return out;
}

/** split one file's summaries (already in sold order) into main + tail.
 *  `live(id)` = the entity's live lot count at build. */
export function tierEntities<T extends { id: string; sold: number | null; label: string }>(list: readonly T[], live: (id: string) => number, soldOnly = MAIN_SOLD_ONLY): { main: T[]; tail: T[] } {
  const rank = list.filter(e => !e.id.startsWith('mk:') && !(live(e.id) > 0))
    .sort((a, b) => (b.sold || 0) - (a.sold || 0) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const tailSet = new Set(rank.slice(soldOnly).map(e => e.id));
  const main: T[] = [], tail: T[] = [];
  for (const e of list) (tailSet.has(e.id) ? tail : main).push(e);
  return { main, tail };
}
