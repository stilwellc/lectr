/**
 * seed-server.ts — an entity page's header, read at BUILD time (perf wave
 * W30, Oct 11 2026). SERVER-ONLY (node:fs): the static routes (/p/<slug>,
 * /e/<slug>, /makers/<slug>) hand entitySeed() to EntityPage as its `seed`,
 * and scripts/emit-first-screen.ts ships headerSeeds() inside each entity
 * first-screen slice (ent-<bb>.json `hdr`) for the query routes
 * (/player?id=, /entity?id=), whose shared shell cannot carry one.
 *
 * Every field is what the page itself reads once its data lands, from the
 * same served files the deploy ships beside the HTML:
 *
 *   s       the summary — pages/entities-<market>.json (then its tail), the
 *           exact lookup useEntities loadEntitySummary does in the browser
 *   rec     the record as the header prints it: recordOf(s.record, detail)
 *           over pages/entity-<bb>.json — the title / house / photo the
 *           summary's slim wire leaves to the detail bucket
 *   houses  the detail's house split (the kicker's "N houses")
 *
 * None of it moves with the clock — the live count and the live book do,
 * and they stay the page's own (or the gated first paint's, W27).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EntitySummary, EntityDetail, EntityRecord } from '../../lib/entity/model';
import { recordOf } from '../../lib/entity/model';
import { decodeEntities, isEntitiesWire } from '../../lib/entity/wire';
import { parseEntityId } from '../../lib/entity/key';
import { bucketOf } from '../../lib/page-data';
import { MARKETS } from '../../constants';

export interface EntitySeed {
  id: string;
  s: EntitySummary;
  rec: EntityRecord | null;
  houses: { h: string; n: number }[];
}

const DEFAULT_SERVED = () => path.join(process.cwd(), 'public', 'data', 'ray');

function readJson(abs: string): unknown {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; }
}
const summaries = new Map<string, Map<string, EntitySummary>>();
/** one entities file's summaries by id (useEntities readEntitiesFile, which
 *  a server module cannot import from its client module) */
function summariesOf(abs: string): Map<string, EntitySummary> {
  let m = summaries.get(abs);
  if (!m) {
    m = new Map();
    const j = readJson(abs);
    const f = (isEntitiesWire(j) ? decodeEntities(j) : j) as { entities?: EntitySummary[] } | null;
    for (const e of Array.isArray(f?.entities) ? f!.entities : []) m.set(e.id, e);
    summaries.set(abs, m);
  }
  return m;
}
/** the summary the browser reads for `id`: its market's file, then the tail */
function summaryOf(id: string, served: string): EntitySummary | null {
  const p = parseEntityId(id);
  if (!p) return null;
  return summariesOf(path.join(served, 'pages', `entities-${p.market}.json`)).get(id)
    ?? summariesOf(path.join(served, 'pages', `entities-${p.market}-tail.json`)).get(id)
    ?? null;
}
const seedOf = (id: string, s: EntitySummary, detail: EntityDetail | null): EntitySeed =>
  ({ id, s, rec: recordOf(s.record ?? null, detail), houses: detail?.houses ?? [] });

/** the build-time header of entity `id`, or null (no entities files, or the
 *  id has no summary — the page then loads exactly as before) */
export function entitySeed(id: string, served = DEFAULT_SERVED()): EntitySeed | null {
  const s = summaryOf(id, served);
  if (!s) return null;
  // 256 buckets, ~56MB: read per page, never held
  const bucket = readJson(path.join(served, 'pages', `entity-${bucketOf(id)}.json`)) as Record<string, EntityDetail> | null;
  return seedOf(id, s, bucket?.[id] ?? null);
}

/** every entity's header by bucket (bucketOf(id) — the same bucket as its
 *  first-screen slice and its detail file), keyed by id: what the query
 *  routes paint their header from beside the live book. Empty when the
 *  served data has no entities files. */
export function headerSeeds(served = DEFAULT_SERVED()): Map<string, Record<string, Omit<EntitySeed, 'id'>>> {
  const ids = new Set<string>();
  for (const m of MARKETS) {
    for (const f of [`entities-${m.key}.json`, `entities-${m.key}-tail.json`]) {
      summariesOf(path.join(served, 'pages', f)).forEach((_s, id) => ids.add(id));
    }
  }
  const byBucket = new Map<string, string[]>();
  ids.forEach(id => { const b = bucketOf(id); const l = byBucket.get(b); if (l) l.push(id); else byBucket.set(b, [id]); });
  const out = new Map<string, Record<string, Omit<EntitySeed, 'id'>>>();
  byBucket.forEach((list, b) => {
    const bucket = readJson(path.join(served, 'pages', `entity-${b}.json`)) as Record<string, EntityDetail> | null;
    const hdr: Record<string, Omit<EntitySeed, 'id'>> = {};
    for (const id of list.sort()) {
      // the summary the browser reads for this id: its OWN market's file
      const s = summaryOf(id, served);
      if (!s) continue;
      const { s: sum, rec, houses } = seedOf(id, s, bucket?.[id] ?? null);
      hdr[id] = { s: sum, rec, houses };
    }
    out.set(b, hdr);
  });
  return out;
}
