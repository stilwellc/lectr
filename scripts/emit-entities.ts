/**
 * emit-entities.ts — the entity payloads every /makers row, dossier and
 * entity page reads (makers overhaul, Oct 10 2026; mk-overhaul/CONTRACT.md).
 *
 *   pages/entities-<market>.json   the v2 WIRE (app/lib/entity/wire — columnar,
 *                                  slim, derived fields dropped) for all · art ·
 *                                  design · watches · sports · tcg · science ·
 *                                  culture — every entity with ≥1 live lot OR
 *                                  ≥ MIN_SOLD sold, tiered: makers + live +
 *                                  the top MAIN_SOLD_ONLY sold-only here,
 *   pages/entities-<market>-tail.json  the rest (fetched only on a miss)
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
import zlib from 'node:zlib';
import { SERVED_DIR } from './corpus-io';
import { servedLastCrawl } from './lib/served-stamp';
import { MARKETS, MAKER_MARKETS, MAKER_DISCIPLINE, ARTIST_LABEL, ARTISTS, marketOf, type Market } from '../app/constants';
import { MIN_SOLD, LENS_LABELS, BUDGET_MARKET_BR, BUDGET_ALL_BR, encodeEntities, tierEntities, isEntitiesWire, ledgerNamesBy } from '../app/lib/entity/wire';
import { entityKeyOf, parseEntityId, entityPageOf, subEntityLabel } from '../app/lib/entity/key';
import { entityFigures, completeQuarters, SPARK_QUARTERS, THIN_SOLD12M, type SoldPoint, type Labels } from '../app/lib/entity/stats';
import type { EntitySummary, EntityDetail } from '../app/lib/entity/model';
import { lotSubjectOf } from '../app/lib/maker-subjects';
import { taxonOf, CAT_LABEL, SPORTS, DOMAINS } from '../app/lib/taxonomy';
import { classifyForm, formsForMarket } from '../app/lib/comps';
import { bucketOf } from '../app/lib/page-data';
import { betterFace } from '../app/lib/img-host';
import { facetKeysFor, facetSplits, facetGroupsOf } from '../app/lib/entity/facets';
import { isLiveUpcoming } from '../app/utils';
import { verifiedMovers } from '../app/preview/terminal/verified';
import type { AuctionLot } from '../app/types';
import { parseCard, cardKey, cardLadderKey } from '../app/lib/cards';
import { numericWatchRef, watchMaterialCoarse, isEditionLot, editionIdentityKey } from '../app/lib/identity';
import { pokemonKey } from './sub-markets';

/** sold-only entities need this much history to get a row (app/lib/entity/wire) */
export { MIN_SOLD };

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

/** (P3, Oct 10) a sold lot's like-for-like identity — the unit the matched
 *  yoy pairs on (app/lib/entity/stats yoyOf): the same card at the same
 *  grade (cards: cardKey; Pokémon: sub-markets pokemonKey), the same watch
 *  reference in the same case material, the same print edition. null = no
 *  identity a resale could repeat (a unique work, most memorabilia). */
export function identityOf(l: Lot, lens: string): string | null {
  return identitiesOf(l, lens, false).k;
}
/** (r8) the identity AND, for a grade-ladder entity, the same card without its
 *  grade (`kg` — app/lib/entity/facets gradeLadder): a card's cardLadderKey, a
 *  Pokémon key minus its grade. One parse for both. */
export function identitiesOf(l: Lot, lens: string, ladder: boolean): { k: string | null; kg: string | null } {
  if (l.artist === 'pokemon') {
    const k = pokemonKey(l);
    return { k, kg: ladder && k ? k.slice(0, k.lastIndexOf('|')) : null };
  }
  if (lens.startsWith('sports-cards:')) {
    const t = String(l.title || '');
    const c = parseCard(t);
    const k = cardKey(c);
    // a card whose grade the parser could not read never prices a rung — nor
    // does a "raw" card whose title reads a slab the parser does not know
    // ("WCG GEM MT 10", "KSA 9.5"): it is no raw card
    const slabbedRaw = !!k && k.endsWith('|raw') && SLAB_WORDS.test(t);
    return { k, kg: ladder && k && !slabbedRaw ? cardLadderKey(c) : null };
  }
  return { k: otherIdentityOf(l), kg: null };
}
/** a grade or a grading company in a title (a "raw" read the card parser missed) */
const SLAB_WORDS = /\b(?:gem|mint|nm-mt|ex-mt|vg-ex|graded|slabbed|authentic|altered|wcg|ksa|gma|hga|isa|csg|ags|mnt|ace|bccg|bvg|beckett|psa|bgs|sgc|cgc)\b/i;
function otherIdentityOf(l: Lot): string | null {
  const ref = numericWatchRef(l);
  if (ref) return `${ref}|${watchMaterialCoarse(l) || '?'}`;
  const m = marketOf(l.artist);
  if ((m === 'art' || m === 'design') && isEditionLot(l)) return editionIdentityKey(l);
  return null;
}

/** (r7) a set entity's scope, printed as its discipline */
export const SET_SCOPE = 'Sets, lots & sealed · singles file under the player';

/** the lens labels (one copy, shared with the client's decoder) */
export const LABELS: Labels = LENS_LABELS;

interface Acc {
  id: string;
  pts: SoldPoint[];
  live: number;
  /** some live lot carries a photo (the row's hero is then the live photo) */
  livePhoto: boolean;
  names: Map<string, number>;
  sports: Map<string, number>;
  domains: Map<string, number>;
  subs: Map<string, number>;
  /** (r7) the live lots' fine lenses — the median prefers the live book's lens (stats FigureOpts) */
  liveLens: Map<string, number>;
  face: { url: string; val: number } | null;
}

/** the fields the entity readers look at, copied off a corpus row */
function readerView(l: Lot): Lot {
  return {
    id: l.id, artist: l.artist, title: l.title, subCat: l.subCat, drill: l.drill,
    playerName: l.playerName, playerSlug: l.playerSlug, description: l.description,
    imageUrl: l.imageUrl, medium: l.medium, category: l.category, status: l.status,
    priceUsd: l.priceUsd, currentBid: l.currentBid, estimateHigh: l.estimateHigh, estimateLow: l.estimateLow,
    flown: l.flown,
    // (P3) the identity readers' fields (identityOf)
    reference: l.reference, formKey: l.formKey, saleName: l.saleName,
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
  /** raw bytes per file (main + tail) */
  files: Record<string, number>;
  /** brotli bytes per file (brotliBytes) */
  filesBr: Record<string, number>;
  /** main files over their budget (wire BUDGET_*) — the nightly warns */
  overBudget: string[];
  bucketsBytes: number;
  soldRows: number;
  unkeyed: number;
}

/** build every summary + detail (pure — no I/O) */
export interface BuiltEntities {
  summaries: EntitySummary[];
  details: Map<string, EntityDetail>;
  /** per summary id: its live lot count + whether one carries a photo */
  live: Map<string, { n: number; photo: boolean }>;
  soldRows: number;
  unkeyed: number;
}
export function buildEntities(input: Omit<EntitiesInput, 'outDir'>): BuiltEntities {
  const accs = new Map<string, Acc>();
  const acc = (id: string): Acc => {
    let a = accs.get(id);
    if (!a) accs.set(id, a = { id, pts: [], live: 0, livePhoto: false, names: new Map(), sports: new Map(), domains: new Map(), subs: new Map(), liveLens: new Map(), face: null });
    return a;
  };
  const note = (a: Acc, l: Lot, ln: ReturnType<typeof lensesOf>) => {
    vote(a.names, lotSubjectOf(l)?.name);
    vote(a.sports, ln.sport);
    vote(a.domains, ln.domain);
    vote(a.subs, ln.lens);
    const fv = faceValueOf(l);
    // host tier first (a christies face is a letter tile for some readers —
    // app/lib/img-host), then value
    if (fv != null && betterFace(a.face, { url: l.imageUrl!, val: fv })) a.face = { url: l.imageUrl!, val: fv };
  };

  const seen = new Set<string>();
  // lens strings interned: one copy per distinct `cat:sub`, not one per row
  const intern = new Map<string, string>();
  const I = (k: string) => { const h = intern.get(k); if (h) return h; intern.set(k, k); return k; };
  let soldRows = 0, unkeyed = 0;
  // (r7) every result row keeps its lot link: sold cards / Pokémon outside
  // the served sample still open — the lot page resolves them from the lots
  // table (LotPage's PostgREST path; sync-lots-db upserts the whole corpus).
  // Verified on prod: 40/40 bucket result ids from five player pages open.
  const linkId = (row: Lot) => row.id;
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
    const ids = identitiesOf(l, ln.lens, !!facetGroupsOf(id)?.includes('grade'));
    const pt: SoldPoint = { p: row.priceUsd!, d: String(row.saleDate || '').slice(0, 10), h: row.auctionHouse || '', lens: I(ln.lens), coarse: I(ln.coarse), id: linkId(row), t: row.title || '', img: row.imageUrl || null, fx: facetKeysFor(id, l), k: ids.k };
    if (ids.kg) pt.kg = ids.kg;
    a.pts.push(pt);
    note(a, l, ln);
  });
  for (const l of input.live) {
    if (!isLiveUpcoming(l, input.today)) continue;
    const id = l.ek !== undefined ? l.ek : entityKeyOf(l);
    if (!id) continue;
    const a = acc(id);
    a.live++;
    if (l.imageUrl) a.livePhoto = true;
    const ln = lensesOf(l);
    vote(a.liveLens, ln.lens);
    note(a, l, ln);
  }

  const verified = new Map<string, unknown>();
  for (const v of verifiedMovers(input.market)) verified.set(v.slug, v);

  const summaries: EntitySummary[] = [];
  const details = new Map<string, EntityDetail>();
  const live = new Map<string, { n: number; photo: boolean }>();
  // (r8) EVERY roster maker ships a summary, however thin its history: a maker
  // missing from the wire fell back to stats.json's unlabeled median (Fab 5
  // Freddy's "typical sale $704" was one sale, printed with no n). The wire's
  // median is n-gated (MIN_MED_N) with its n beside it.
  for (const m of ARTISTS) if (MAKER_MARKETS.has(m.market as Market)) acc(`mk:${m.slug}`);
  accs.forEach(a => {
    if (!(a.live >= 1 || a.pts.length >= MIN_SOLD || a.id.startsWith('mk:'))) return;
    const ref = parseEntityId(a.id);
    if (!ref) return;
    // (r7) a SUBJECT's typical sale reads its live book's lens, when that lens holds at least half
    // its live lots (≥ 3 live) and has a 12-month median of its own (stats FigureOpts). Makers and
    // players keep their sold-dominant lens: their median is the long-run read the ledger ranks on
    const ll = (ref.kind === 'subject' || ref.kind === 'set') ? top(a.liveLens) : null;
    const liveLens = ll && a.live >= 3 && (a.liveLens.get(ll) || 0) * 2 >= a.live ? ll : null;
    const f = entityFigures(a.pts, input.today, LABELS, { liveLens });
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
      // (r7 data fix) a set is its sealed product, complete / partial sets and multi-card lots —
      // every single files under its player (one entity per lot) — and says so
      else if (ref.kind === 'set') discipline = SET_SCOPE;
      // a tracked artist's own works file under the maker (entity key); what stays here is signed
      // ephemera and pieces about them — said so, so ⌘K's second "Andy Warhol" is not a twin
      else if (ref.subKind === 'film' || ref.subKind === 'franchise' || (ref.subKind === 'person' && ref.market === 'culture')) {
        discipline = (domain && DOMAINS.find(x => x.key === domain)?.label) || subTag;
      } else discipline = subTag;
    }
    if (a.live) live.set(a.id, { n: a.live, photo: a.livePhoto });
    // (r7) a subject / set follows by its own id (app/lib/follows entityFollow)
    const slugFollow = ref.kind === 'maker' || ref.kind === 'player' ? ref.slug : ref.kind === 'subject' || ref.kind === 'set' ? a.id : null;
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
      sparkBasis: f.sparkBasis,
      sparkYoyOff: f.sparkYoyOff,
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
        // (no `quarters` since Oct 10: no page read them — the trend rides
        // the summary's spark)
        yearly: f.yearly, houses: f.houses, cats: f.cats, top: f.top, recent: f.recent,
      };
      if (f.lensSplit) det.lensSplit = f.lensSplit;
      const fx = facetSplits(a.id, a.pts, input.today);
      if (fx) det.facets = fx;
      details.set(a.id, det);
    }
  });
  summaries.sort((x, y) => (y.sold || 0) - (x.sold || 0) || (x.label < y.label ? -1 : x.label > y.label ? 1 : 0));
  return { summaries, details, live, soldRows, unkeyed };
}

/** the brotli size the CDN serves (Cloudflare's on-the-fly level sits near
 *  quality 3–4; quality 3 is the conservative read) */
export const brotliBytes = (body: string): number =>
  zlib.brotliCompressSync(Buffer.from(body), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3 } }).length;

/** one market file's main + tail bodies (pure) */
export function entityFileBodies(ents: readonly EntitySummary[], live: BuiltEntities['live'], meta: { generatedAt: string; lastCrawl: string; sparkQ: string[] }): { main: string; tail: string; mainN: number; tailN: number } {
  const { main, tail } = tierEntities(ents, id => live.get(id)?.n ?? 0);
  // the face ships for a maker (its hero), and for a live entity none of
  // whose live lots carries a photo — every other row shows its live photo
  const keepFace = (e: EntitySummary) => e.kind === 'maker' || (!!live.get(e.id) && !live.get(e.id)!.photo);
  const base = { ...meta, keepFace };
  return {
    main: JSON.stringify(encodeEntities(main, { ...base, tier: 'main', tailN: tail.length, tailBy: ledgerNamesBy(tail) })),
    tail: JSON.stringify(encodeEntities(tail, { ...base, tier: 'tail', tailN: 0 })),
    mainN: main.length,
    tailN: tail.length,
  };
}

/** build + write every entity file under `outDir` */
export function emitEntities(input: EntitiesInput): EntitiesReport {
  const t0 = Date.now();
  const { summaries, details, live, soldRows, unkeyed } = buildEntities(input);
  fs.mkdirSync(input.outDir, { recursive: true });
  for (const f of fs.readdirSync(input.outDir)) if (/^entit(?:y|ies)-.*\.json$/.test(f)) fs.unlinkSync(path.join(input.outDir, f));
  const generatedAt = new Date().toISOString();
  const files: Record<string, number> = {};
  const filesBr: Record<string, number> = {};
  const perMarket: Record<string, number> = {};
  const overBudget: string[] = [];
  // sparkQ: the complete quarters every spark covers (one window per build)
  const meta = { generatedAt, lastCrawl: input.lastCrawl, sparkQ: completeQuarters(input.today, SPARK_QUARTERS) };
  for (const m of MARKETS) {
    const ents = m.key === 'all' ? summaries : summaries.filter(e => e.market === m.key);
    const b = entityFileBodies(ents, live, meta);
    for (const [f, body] of [[`entities-${m.key}.json`, b.main], [`entities-${m.key}-tail.json`, b.tail]] as const) {
      fs.writeFileSync(path.join(input.outDir, f), body);
      files[f] = body.length;
      filesBr[f] = brotliBytes(body);
    }
    const budget = m.key === 'all' ? BUDGET_ALL_BR : BUDGET_MARKET_BR;
    if (filesBr[`entities-${m.key}.json`] > budget) overBudget.push(`entities-${m.key}.json ${(filesBr[`entities-${m.key}.json`] / 1024).toFixed(0)}KB br > ${(budget / 1024).toFixed(0)}KB`);
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
  console.log(`[entities] files (KB brotli main / tail): ${MARKETS.map(m => `${m.key} ${(filesBr[`entities-${m.key}.json`] / 1024).toFixed(1)}/${(filesBr[`entities-${m.key}-tail.json`] / 1024).toFixed(1)}`).join(' · ')}`);
  if (overBudget.length) console.warn(`::warning::[entities] over the size budget: ${overBudget.join('; ')}`);
  console.log(`[entities] ${summaries.length} entities (${Object.entries(perMarket).map(([k, n]) => `${k}:${n}`).join(' ')}) from ${soldRows.toLocaleString()} sold rows (${unkeyed} not by their maker) · details ${details.size} in 256 buckets ${(bucketsBytes / 1048576).toFixed(1)}MB raw · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { entities: summaries.length, perMarket, files, filesBr, overBudget, bucketsBytes, soldRows, unkeyed };
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
    for (const f of [`entities-${m.key}.json`, `entities-${m.key}-tail.json`]) {
      const j = read(f);
      if (!j) continue;
      if (!isEntitiesWire(j)) { bad.push(`${f} is not the v2 entities wire`); continue; }
      if (j.lastCrawl !== crawl) bad.push(`${f} lastCrawl ${j.lastCrawl} ≠ meta ${crawl}`);
      if (j.tier === 'main' && m.key !== 'all' && MAKER_MARKETS.has(m.key) && !j.c.id.length) bad.push(`${f} has no entities`);
    }
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
      console.log('[entities] check: 8 market files + 8 tails + 256 buckets present, stamped with tonight\'s crawl');
    } else {
      emitEntities({ ...servedEntitiesInput(dir), today: process.env.RAY_ENTITY_TODAY || buildDay(), outDir: path.join(dir, 'pages') });
    }
  } catch (e) { console.error('[entities] FAILED:', e); process.exit(1); }
}

