/**
 * emit-entities.ts — the entity payloads every /makers row, dossier and
 * entity page reads (makers overhaul, Oct 10 2026; mk-overhaul/CONTRACT.md).
 *
 *   pages/entities-<market>.json   { generatedAt, lastCrawl, entities: EntitySummary[] }
 *                                  for all · art · design · watches · sports ·
 *                                  tcg · science · culture — every entity with
 *                                  ≥1 live lot OR ≥ MIN_SOLD sold
 *   pages/entity-<bb>.json         256 buckets (app/lib/page-data bucketOf):
 *                                  { _: { lastCrawl }, [id]: EntityDetail }
 *
 * ONE key (app/lib/entity/key entityKeyOf) files every lot, sold and live, and
 * ONE function (app/lib/entity/stats entityFigures) computes every figure —
 * the row, the dossier hero and the page cannot disagree.
 *
 * Population: the nightly hands in the FULL in-memory corpus (scripts/
 * assemble.ts runDownstream — the same rows stats.json and players.json are
 * built from, including the corpus-only sold cards + Pokémon). Standalone, it
 * reads the served book (lots-* + sold-archive-*), which carries only a sample
 * of sold cards / Pokémon — fine for a local check, never what prod ships.
 *
 *   npx tsx scripts/emit-entities.ts            (reads public/data/ray)
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVED_DIR } from './corpus-io';
import { servedLastCrawl } from './lib/served-stamp';
import { MARKETS, MAKER_MARKETS, MAKER_DISCIPLINE, ARTIST_LABEL, marketOf } from '../app/constants';
import { entityKeyOf, parseEntityId, entityPageOf, subEntityLabel } from '../app/lib/entity/key';
import { entityFigures, completeQuarters, SPARK_QUARTERS, THIN_SOLD12M, type SoldPoint, type Labels } from '../app/lib/entity/stats';
import type { EntitySummary, EntityDetail } from '../app/lib/entity/model';
import { lotSubjectOf } from '../app/lib/maker-subjects';
import { taxonOf, subLabel, CAT_LABEL, SPORTS, DOMAINS, type CatKey } from '../app/lib/taxonomy';
import { classifyForm, formsForMarket } from '../app/lib/comps';
import { bucketOf } from '../app/lib/page-data';
import { isLiveUpcoming } from '../app/utils';
import { verifiedMovers } from '../app/preview/terminal/verified';
import type { AuctionLot } from '../app/types';

/** sold-only entities need this much history to get a row */
export const MIN_SOLD = 10;

type Lot = AuctionLot & { description?: string | null; ek?: string | null };

/** THE face rule (was /makers heroBySlug, then emit-page-stats makerFaces):
 *  the entity's highest-value photographed lot — on a maker book only a lot
 *  whose form belongs to the maker's market. null = not a face candidate. */
export function faceValueOf(l: Lot): number | null {
  if (!l.imageUrl) return null;
  const forms = formsForMarket(marketOf(l.artist));
  if (forms) { const f = classifyForm(l); if (f === 'unknown' || !forms.has(f)) return null; }
  return l.priceUsd || l.currentBid || l.estimateHigh || l.estimateLow || 0;
}

/** a lot's two lenses: the fine clean `cat:sub`, and the coarse split
 *  (maker books: the sub; collections: the category) */
export function lensesOf(l: Lot): { lens: string; coarse: string; sport?: string; domain?: string } {
  const t = taxonOf(l);
  const lens = `${t.cat}:${t.sub}`;
  return { lens, coarse: MAKER_MARKETS.has(marketOf(l.artist)) ? lens : t.cat, sport: t.sport, domain: t.domain };
}

/** one market's categories read without their category prefix */
const SOLO_CAT_MARKET = new Set<CatKey>(['tcg', 'space-science', 'fine-art', 'design', 'watches']);
export const LABELS: Labels = {
  lens: k => {
    const i = k.indexOf(':');
    const cat = k.slice(0, i) as CatKey, sub = k.slice(i + 1);
    const s = subLabel(cat, sub);
    return SOLO_CAT_MARKET.has(cat) ? s : `${CAT_LABEL[cat] || cat} · ${s}`;
  },
  coarse: k => (k.includes(':') ? LABELS.lens(k) : CAT_LABEL[k as CatKey] || k),
};

interface Acc {
  id: string;
  pts: SoldPoint[];
  live: number;
  names: Map<string, number>;
  sports: Map<string, number>;
  domains: Map<string, number>;
  subs: Map<string, number>;
  face: { url: string; val: number } | null;
}

/** the fields the entity readers look at, copied off a corpus row */
function readerView(l: Lot): Lot {
  return {
    id: l.id, artist: l.artist, title: l.title, subCat: l.subCat, drill: l.drill,
    playerName: l.playerName, playerSlug: l.playerSlug, description: l.description,
    imageUrl: l.imageUrl, medium: l.medium, category: l.category, status: l.status,
    priceUsd: l.priceUsd, currentBid: l.currentBid, estimateHigh: l.estimateHigh, estimateLow: l.estimateLow,
  } as Lot;
}

const vote = (m: Map<string, number>, k: string | null | undefined) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
const top = (m: Map<string, number>): string | null => {
  let best: string | null = null, n = 0;
  m.forEach((c, k) => { if (c > n || (c === n && best !== null && k < best)) { n = c; best = k; } });
  return best;
};

export interface EntitiesInput {
  /** visits every sold row (any order; deduped by id, first occurrence wins) */
  eachSold: (visit: (l: Lot) => void) => void;
  /** the eager live book (upcoming.json lots) */
  live: readonly Lot[];
  lastCrawl: string;
  /** market.json (the verified movers) — null abstains */
  market: Parameters<typeof verifiedMovers>[0];
  /** the build's calendar day (YYYY-MM-DD) */
  today: string;
  outDir: string;
}

export interface EntitiesReport {
  entities: number;
  perMarket: Record<string, number>;
  files: Record<string, number>;
  bucketsBytes: number;
  soldRows: number;
  unkeyed: number;
}

/** build every summary + detail (pure — no I/O) */
export function buildEntities(input: Omit<EntitiesInput, 'outDir'>): { summaries: EntitySummary[]; details: Map<string, EntityDetail>; soldRows: number; unkeyed: number } {
  const accs = new Map<string, Acc>();
  const acc = (id: string): Acc => {
    let a = accs.get(id);
    if (!a) accs.set(id, a = { id, pts: [], live: 0, names: new Map(), sports: new Map(), domains: new Map(), subs: new Map(), face: null });
    return a;
  };
  const note = (a: Acc, l: Lot, ln: ReturnType<typeof lensesOf>) => {
    vote(a.names, lotSubjectOf(l)?.name);
    vote(a.sports, ln.sport);
    vote(a.domains, ln.domain);
    vote(a.subs, ln.lens);
    const fv = faceValueOf(l);
    if (fv != null && (!a.face || fv > a.face.val)) a.face = { url: l.imageUrl!, val: fv };
  };

  const seen = new Set<string>();
  // lens strings interned: one copy per distinct `cat:sub`, not one per row
  const intern = new Map<string, string>();
  const I = (k: string) => { const h = intern.get(k); if (h) return h; intern.set(k, k); return k; };
  let soldRows = 0, unkeyed = 0;
  input.eachSold(row => {
    if (row.status !== 'sold' || !(row.priceUsd! > 0)) return;
    if (seen.has(row.id)) return;
    seen.add(row.id);
    // the readers memoise per lot OBJECT (WeakMaps): over the resident nightly
    // corpus that would pin ~1M memo entries for the rest of the run — they
    // read a throwaway view instead, which takes its memo entries with it
    const l = readerView(row);
    const id = entityKeyOf(l);
    if (!id) { unkeyed++; return; }
    soldRows++;
    const a = acc(id);
    const ln = lensesOf(l);
    a.pts.push({ p: row.priceUsd!, d: String(row.saleDate || '').slice(0, 10), h: row.auctionHouse || '', lens: I(ln.lens), coarse: I(ln.coarse), id: row.id, t: row.title || '', img: row.imageUrl || null });
    note(a, l, ln);
  });
  for (const l of input.live) {
    if (!isLiveUpcoming(l, input.today)) continue;
    const id = l.ek !== undefined ? l.ek : entityKeyOf(l);
    if (!id) continue;
    const a = acc(id);
    a.live++;
    note(a, l, lensesOf(l));
  }

  const verified = new Map<string, unknown>();
  for (const v of verifiedMovers(input.market)) verified.set(v.slug, v);

  const summaries: EntitySummary[] = [];
  const details = new Map<string, EntityDetail>();
  accs.forEach(a => {
    if (!(a.live >= 1 || a.pts.length >= MIN_SOLD)) return;
    const ref = parseEntityId(a.id);
    if (!ref) return;
    const f = entityFigures(a.pts, input.today, LABELS);
    const domSub = top(a.subs);
    const subTag = domSub ? LABELS.lens(domSub) : null;
    let label: string;
    let discipline: string | null;
    if (ref.kind === 'maker') {
      label = ARTIST_LABEL[ref.slug!] || ref.slug!;
      discipline = MAKER_DISCIPLINE[ref.slug!] ?? null;
    } else if (ref.kind === 'sub') {
      label = subEntityLabel(ref.cat!, ref.sub!);
      discipline = CAT_LABEL[ref.cat!] ?? null;
    } else {
      label = top(a.names) || a.id;
      const sport = top(a.sports);
      const domain = top(a.domains);
      if (ref.kind === 'player') discipline = (sport && SPORTS.find(s => s.key === sport)?.label) || subTag;
      else if (ref.subKind === 'film' || ref.subKind === 'franchise' || (ref.subKind === 'person' && ref.market === 'culture')) {
        discipline = (domain && DOMAINS.find(x => x.key === domain)?.label) || subTag;
      } else discipline = subTag;
    }
    const slugFollow = ref.kind === 'maker' || ref.kind === 'player' ? ref.slug : null;
    summaries.push({
      id: a.id,
      kind: ref.kind,
      market: ref.market,
      label,
      subKind: ref.subKind,
      discipline,
      face: a.face?.url ?? null,
      page: entityPageOf(a.id),
      sold: f.sold,
      sold12m: f.sold12m,
      med12m: f.med12m,
      med12mN: f.med12mN,
      medScope: f.medScope,
      record: f.record,
      spark: f.spark,
      sparkN: f.sparkN,
      yoy: f.yoy,
      verified: ref.kind === 'maker' ? verified.get(ref.slug!) ?? null : null,
      thin: f.sold12m < THIN_SOLD12M,
      caps: { compare: !!f.spark, follow: slugFollow, dossier: f.sold >= MIN_SOLD },
      // (beyond the contract) the lens key the median reads — so a client can
      // scope a lot browser to the same lens the median names
      medLens: f.medLens,
    });
    if (f.sold) {
      const det: EntityDetail = {
        quarters: f.quarters, yearly: f.yearly, houses: f.houses, cats: f.cats, top: f.top, recent: f.recent,
      };
      if (f.lensSplit) det.lensSplit = f.lensSplit;
      details.set(a.id, det);
    }
  });
  summaries.sort((x, y) => (y.sold || 0) - (x.sold || 0) || (x.label < y.label ? -1 : x.label > y.label ? 1 : 0));
  return { summaries, details, soldRows, unkeyed };
}

/** build + write every entity file under `outDir` */
export function emitEntities(input: EntitiesInput): EntitiesReport {
  const t0 = Date.now();
  const { summaries, details, soldRows, unkeyed } = buildEntities(input);
  fs.mkdirSync(input.outDir, { recursive: true });
  for (const f of fs.readdirSync(input.outDir)) if (/^entit(?:y|ies)-.*\.json$/.test(f)) fs.unlinkSync(path.join(input.outDir, f));
  const generatedAt = new Date().toISOString();
  const files: Record<string, number> = {};
  const perMarket: Record<string, number> = {};
  for (const m of MARKETS) {
    const ents = m.key === 'all' ? summaries : summaries.filter(e => e.market === m.key);
    // sparkQ: the complete quarters every spark covers (one window per build)
    const body = JSON.stringify({ generatedAt, lastCrawl: input.lastCrawl, sparkQ: completeQuarters(input.today, SPARK_QUARTERS), entities: ents });
    fs.writeFileSync(path.join(input.outDir, `entities-${m.key}.json`), body);
    files[`entities-${m.key}.json`] = body.length;
    perMarket[m.key] = ents.length;
  }
  const buckets: Record<string, Record<string, unknown>> = {};
  details.forEach((d, id) => { const b = bucketOf(id); (buckets[b] || (buckets[b] = { _: { lastCrawl: input.lastCrawl } }))[id] = d; });
  let bucketsBytes = 0;
  for (let i = 0; i < 256; i++) {
    const b = i.toString(16).padStart(2, '0');
    const body = JSON.stringify(buckets[b] || { _: { lastCrawl: input.lastCrawl } });
    fs.writeFileSync(path.join(input.outDir, `entity-${b}.json`), body);
    bucketsBytes += body.length;
  }
  console.log(`[entities] ${summaries.length} entities (${Object.entries(perMarket).map(([k, n]) => `${k}:${n}`).join(' ')}) from ${soldRows.toLocaleString()} sold rows (${unkeyed} not by their maker) · details ${details.size} in 256 buckets ${(bucketsBytes / 1048576).toFixed(1)}MB raw · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { entities: summaries.length, perMarket, files, bucketsBytes, soldRows, unkeyed };
}

/** slugs whose sold history ships to the served book only as a sample */
export const SAMPLED_SOLD: ReadonlySet<string> = new Set(['sports-cards', 'graded-cards', 'pokemon']);

/** the served book as the standalone run reads it: main tier then archive
 *  (the main row wins a shared id), the eager live book, meta, market */
export function servedEntitiesInput(dir: string = SERVED_DIR): Omit<EntitiesInput, 'today' | 'outDir'> {
  const readJson = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
  const shards = (base: string): string[] => {
    let n = 0;
    try { n = Number(readJson<{ shards: number }>(`${base}-index.json`).shards) || 0; } catch { n = 0; }
    return Array.from({ length: n }, (_, i) => `${base}-${i}.json`);
  };
  const files = shards('lots').concat(shards('sold-archive'));
  if (!files.length) throw new Error('[entities] no served lots-*.json shards — run assemble first');
  // the served book ships only a SAMPLE of sold cards + Pokémon (build-market:
  // the newest 1,500 + top 500 by price) — a median over it is biased high, so
  // the standalone run leaves those sold rows out rather than print it
  let sampled = 0;
  const eachSold = (visit: (l: Lot) => void) => {
    for (const f of files) for (const l of readJson<Lot[]>(f)) {
      if (l.status === 'sold' && SAMPLED_SOLD.has(l.artist)) { sampled++; continue; }
      visit(l);
    }
    if (sampled) console.log(`[entities] served mode: ${sampled.toLocaleString()} sampled sold card / Pokémon rows left out (the nightly reads the full corpus)`);
  };
  const meta = readJson<{ lastCrawl?: string }>('meta.json');
  let market: Parameters<typeof verifiedMovers>[0] = null;
  try { market = readJson('market.json'); } catch { market = null; }
  return { eachSold, live: readJson<{ lots?: Lot[] }>('upcoming.json').lots || [], lastCrawl: meta.lastCrawl || '', market };
}

/** the build's calendar day — the same UTC day the nightly stamps everywhere */
export const buildDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/** the nightly's gate on the files the single-load step wrote: every
 *  entities-<market>.json and all 256 buckets present, parseable, and stamped
 *  with tonight's meta.json lastCrawl. Returns the problems ([] = pass). */
export function checkEntityFiles(dir: string = SERVED_DIR): string[] {
  const bad: string[] = [];
  const crawl = servedLastCrawl(dir);
  if (!crawl) bad.push('meta.json has no lastCrawl');
  const pages = path.join(dir, 'pages');
  const read = (f: string): Record<string, unknown> | null => {
    try { return JSON.parse(fs.readFileSync(path.join(pages, f), 'utf8')); } catch { bad.push(`${f} missing or unparseable`); return null; }
  };
  for (const m of MARKETS) {
    const j = read(`entities-${m.key}.json`) as { lastCrawl?: string; entities?: unknown[] } | null;
    if (!j) continue;
    if (j.lastCrawl !== crawl) bad.push(`entities-${m.key}.json lastCrawl ${j.lastCrawl} ≠ meta ${crawl}`);
    if (!Array.isArray(j.entities) || (m.key !== 'all' && MAKER_MARKETS.has(m.key) && !j.entities.length)) bad.push(`entities-${m.key}.json has no entities`);
  }
  for (let i = 0; i < 256; i++) {
    const b = i.toString(16).padStart(2, '0');
    const j = read(`entity-${b}.json`) as { _?: { lastCrawl?: string } } | null;
    if (j && j._?.lastCrawl !== crawl) bad.push(`entity-${b}.json lastCrawl ${j._?.lastCrawl} ≠ meta ${crawl}`);
  }
  return bad;
}

if (require.main === module) {
  try {
    const dir = process.argv.includes('--served') ? process.argv[process.argv.indexOf('--served') + 1] : SERVED_DIR;
    if (process.argv.includes('--check')) {
      const bad = checkEntityFiles(dir);
      if (bad.length) { console.error(`[entities] CHECK FAILED (${bad.length}):\n  ${bad.slice(0, 20).join('\n  ')}`); process.exit(1); }
      console.log('[entities] check: 8 market files + 256 buckets present, stamped with tonight\'s crawl');
    } else {
      emitEntities({ ...servedEntitiesInput(dir), today: process.env.RAY_ENTITY_TODAY || buildDay(), outDir: path.join(dir, 'pages') });
    }
  } catch (e) { console.error('[entities] FAILED:', e); process.exit(1); }
}

