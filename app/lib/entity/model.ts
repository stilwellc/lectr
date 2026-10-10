/**
 * model.ts — the ONE entity model every /makers row, dossier and entity page
 * reads (makers overhaul, Oct 10 2026). Shape per mk-overhaul/CONTRACT.md.
 *
 * (data branch copy: the client-core branch owns this file — the merge keeps
 * theirs and must stay structurally identical to what the emitter writes.)
 */
import type { Market } from '../../constants';

export type EntityKind = 'maker' | 'player' | 'subject' | 'set' | 'sub';
// subject = pokemon | person | film | franchise | mission | team | band | brand (subKind)

export interface EntityRef { id: string; kind: EntityKind; market: Market }
// id grammar: 'mk:<artistSlug>' | 'pl:<playerSlug>' | 'sj:<market>|<subjectKey>' | 'st:<market>|<setKey>' | 'cs:<cat>:<sub>'

export interface EntityRecord { p: number; d: string; t: string; h: string; id?: string; img?: string | null }

export interface EntitySummary extends EntityRef {
  label: string;
  subKind?: string | null;
  discipline: string | null;
  face: string | null;
  page: string | null;
  sold: number | null;
  sold12m: number | null;
  med12m: number | null; med12mN: number | null; medScope: string | null;
  record: EntityRecord | null;
  spark: (number | null)[] | null;
  sparkN: number[] | null;
  yoy: { pct: number; n: number; basis: 'median' | 'index' } | null;
  verified: unknown | null;
  thin: boolean;
  caps: { compare: boolean; follow: string | null; dossier: boolean };
  /** (data) the clean `cat:sub` lens med12m / spark / yoy read — medScope is its label */
  medLens?: string | null;
}

export interface EntitiesFile {
  generatedAt: string;
  lastCrawl: string;
  /** (data) the complete quarters every summary's spark covers, oldest first */
  sparkQ?: string[];
  entities: EntitySummary[];
}

export interface EntityResultRow { id: string; img: string | null; p: number; d: string; t: string; h: string; cat: string }

export interface EntityDetail {
  quarters: { q: string; med: number | null; n: number; high: number }[];
  /** every year with a sale; the current year is marked partial */
  yearly: { y: number; med: number | null; n: number; partial?: true }[];
  houses: { h: string; n: number }[];
  cats: { key: string; label: string; n: number; med12m: number | null; med12mN: number }[];
  top: EntityResultRow[];
  recent: EntityResultRow[];
  /** (>1 coarse lens only) unique vs editions, cards vs memorabilia — n all-time, n12 / med the trailing year */
  lensSplit?: { key: string; label: string; n: number; n12: number; med: number | null; yearly: { y: number; med: number | null; n: number; partial?: true }[]; top: EntityResultRow[] }[];
}
