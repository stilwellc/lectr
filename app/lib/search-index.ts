/**
 * search-index.ts — the palette's reader for the sold-title index and the
 * reference book (written by scripts/emit-search-index.ts).
 *
 * Load discipline: nothing here runs at page load. search-meta.json (~30KB)
 * is fetched when the palette OPENS; a token shard (t-<pp>.json) is fetched on
 * the first keystroke that needs it; doc blocks (d-<n>.json) only for the
 * handful of rows actually shown. Everything is module-cached for the
 * session, and a failed fetch is forgotten so the next keystroke retries.
 *
 * Without the emitter's output (a fresh checkout, or before the nightly has
 * run it) the ref list falls back to page-stats.json's refIndex and the sold
 * search quietly returns nothing — the palette still works over makers, refs,
 * sub-markets and the live book.
 */
import { tokenize, shardOf, foldText, refCompact, type SearchMeta, type SoldDoc, type RefSale } from './search-tokens';
import { loadPageStats } from './page-data';
import { encodeRefPath } from '../ref/ref-path';

const BASE = '/data/ray';

/* ── meta + the reference list ─────────────────────────────────────────── */

export interface RefRow { maker: string; ref: string; n: number; med: number }

let metaP: Promise<SearchMeta | null> | null = null;
export function loadSearchMeta(): Promise<SearchMeta | null> {
  if (!metaP) {
    metaP = fetch(`${BASE}/search-meta.json`, { cache: 'no-cache' })
      .then(r => (r.ok ? (r.json() as Promise<SearchMeta>) : null))
      .catch(() => null)
      .then(m => { if (!m) metaP = null; return m; });
  }
  return metaP;
}

let refsP: Promise<RefRow[]> | null = null;
/** every reference with a dossier — from search-meta, else page-stats */
export function loadRefList(): Promise<RefRow[]> {
  if (!refsP) {
    refsP = loadSearchMeta().then(async m => {
      if (m?.refs?.length) return m.refs.map(([maker, ref, n, med]) => ({ maker, ref, n, med }));
      const st = await loadPageStats();
      return (st?.refIndex || []).map(r => ({ maker: r.maker, ref: r.ref, n: r.n, med: r.med }));
    }).then(rows => { if (!rows.length) refsP = null; return rows; });
  }
  return refsP;
}

export const refHref = (r: { maker: string; ref: string }) => `/ref/${r.maker}/${encodeRefPath(r.ref)}`;

/* ── reference parsing: '5711', 'Patek 5711', '126720VTNR', 'Rolex 1675' ── */

/** the words a collector types for each watch maker (folded) */
const MAKER_WORDS: Record<string, string[]> = {
  'patek-philippe': ['patek philippe', 'patek', 'pp'],
  rolex: ['rolex'],
  'audemars-piguet': ['audemars piguet', 'audemars', 'ap'],
  cartier: ['cartier'],
  omega: ['omega'],
};

export interface RefHit { row: RefRow; how: 'exact' | 'prefix' | 'name' }

/**
 * Ranks the reference book against a query. A maker word narrows to that
 * maker; the rest is compared on alphanumerics only ('5711/1A' = '57111a'),
 * exact before prefix, deeper books first; model names ('nautilus', 'royal
 * oak') match the display label.
 */
export function matchRefs(query: string, refs: RefRow[], label: (ref: string) => string, limit = 6): RefHit[] {
  let q = ' ' + foldText(query).replace(/[^a-z0-9/.-]+/g, ' ').trim() + ' ';
  let maker: string | null = null;
  for (const [slug, words] of Object.entries(MAKER_WORDS)) {
    for (const w of words) {
      if (q.includes(` ${w} `)) { maker = slug; q = q.replace(` ${w} `, ' '); break; }
    }
    if (maker) break;
  }
  const rest = q.trim();
  const rc = refCompact(rest);
  if (!rc) return [];
  const restWords = rest.split(/\s+/).filter(Boolean);
  const hits: RefHit[] = [];
  for (const row of refs) {
    if (maker && row.maker !== maker) continue;
    const k = refCompact(row.ref);
    if (k === rc) { hits.push({ row, how: 'exact' }); continue; }
    // a reference prefix needs 3+ typed characters and a digit — '57' should
    // not list every 57xx, and 'ro' is a word, not a reference
    if (rc.length >= 3 && /\d/.test(rc) && k.startsWith(rc)) { hits.push({ row, how: 'prefix' }); continue; }
    const lab = foldText(label(row.ref));
    if (rc.length >= 3 && restWords.every(w => lab.includes(w))) hits.push({ row, how: 'name' });
  }
  const rank = { exact: 0, prefix: 1, name: 2 } as const;
  hits.sort((a, b) => rank[a.how] - rank[b.how] || b.row.n - a.row.n);
  return hits.slice(0, limit);
}

/* ── the sold-title index ──────────────────────────────────────────────── */

type Shard = Record<string, number[]>;
const shardCache = new Map<string, Promise<Shard | null>>();
const blockCache = new Map<number, Promise<SoldDoc[] | null>>();

function getJson<T>(url: string): Promise<T | null> {
  return fetch(url, { cache: 'force-cache' }).then(r => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
}
function loadShard(meta: SearchMeta, key: string): Promise<Shard | null> {
  let p = shardCache.get(key);
  if (!p) {
    p = getJson<Shard>(`${BASE}/search/t-${key}.json?v=${encodeURIComponent(meta.v)}`).then(s => { if (!s) shardCache.delete(key); return s; });
    shardCache.set(key, p);
  }
  return p;
}
function loadBlock(meta: SearchMeta, b: number): Promise<SoldDoc[] | null> {
  let p = blockCache.get(b);
  if (!p) {
    p = getJson<SoldDoc[]>(`${BASE}/search/d-${b}.json?v=${encodeURIComponent(meta.v)}`).then(s => { if (!s) blockCache.delete(b); return s; });
    blockCache.set(b, p);
  }
  return p;
}

function decode(deltas: number[]): number[] {
  const out = new Array<number>(deltas.length);
  let acc = 0;
  for (let i = 0; i < deltas.length; i++) { acc += deltas[i]; out[i] = acc; }
  return out;
}
function intersect(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++;
  }
  return out;
}
function union(lists: number[][]): number[] {
  if (lists.length === 1) return lists[0];
  return Array.from(new Set(lists.flat())).sort((x, y) => x - y);
}

export interface SoldHit { id: string; title: string; maker: string; price: number; date: string; house: string }

/**
 * Sold lots whose title (plus maker) carries every typed word. The last word
 * matches as a prefix while the query is still being typed ('nakash' finds
 * 'Nakashima'); earlier words match whole. Newest sales first. Returns []
 * when every word is too common to narrow ('rolex', 'signed').
 */
export async function searchSold(query: string, limit = 6): Promise<SoldHit[]> {
  const meta = await loadSearchMeta();
  if (!meta) return [];
  const toks = tokenize(query);
  if (!toks.length) return [];
  const typing = !/\s$/.test(query);
  const split = new Set(meta.split || []);
  const shardSet = new Set(meta.shards);
  const common = new Set(meta.common);

  const lists: number[][] = [];
  const checks: { t: string; prefix: boolean }[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prefix = typing && i === toks.length - 1 && t.length >= 3;
    checks.push({ t, prefix });
    // a common word narrows nothing (its completions would narrow WRONGLY —
    // 'rolex' typed would list only 'rolexes'); it is verified on the text below
    if (common.has(t)) continue;
    const key = shardOf(t, split);
    if (!shardSet.has(key)) return [];
    const sh = await loadShard(meta, key);
    if (!sh) return [];
    if (prefix) {
      const keys = Object.keys(sh).filter(k => k.startsWith(t));
      if (!keys.length) return [];
      // bound the work: the 40 deepest completions carry the useful hits
      keys.sort((a, b) => sh[b].length - sh[a].length);
      lists.push(union(keys.slice(0, 40).map(k => decode(sh[k]))));
    } else {
      if (!sh[t]) return [];
      lists.push(decode(sh[t]));
    }
  }
  if (!lists.length) return []; // only common words — too broad to list
  lists.sort((a, b) => a.length - b.length);
  let ords = lists[0];
  for (let i = 1; i < lists.length && ords.length; i++) ords = intersect(ords, lists[i]);

  // verify the common words (and the prefix) against the doc text, walking
  // the lowest ordinals (= newest sales) block by block
  const out: SoldHit[] = [];
  const CANDIDATES = 160;
  const cand = ords.slice(0, CANDIDATES);
  const blocks = Array.from(new Set(cand.map(o => Math.floor(o / meta.block))));
  const loaded = await Promise.all(blocks.slice(0, 8).map(b => loadBlock(meta, b).then(d => [b, d] as const)));
  const byBlock = new Map(loaded);
  for (const o of cand) {
    const d = byBlock.get(Math.floor(o / meta.block));
    if (!d) continue;
    const doc = d[o % meta.block];
    if (!doc) continue;
    const words = tokenize(`${doc[1]} ${doc[2].replace(/-/g, ' ')}`);
    const ok = checks.every(c => (c.prefix ? words.some(w => w.startsWith(c.t)) : words.includes(c.t)));
    if (!ok) continue;
    out.push({ id: doc[0], title: doc[1], maker: doc[2], price: doc[3], date: doc[4], house: doc[5] });
    if (out.length >= limit) break;
  }
  return out;
}

/* ── one reference's full sale ledger (the /ref chart + "show all") ────── */

const ledgerCache = new Map<string, Promise<RefSale[] | null>>();
export function loadRefSales(maker: string, ref: string): Promise<RefSale[] | null> {
  const key = `${maker}:${ref}`;
  let p = ledgerCache.get(key);
  if (!p) {
    p = loadSearchMeta().then(m => (m
      ? getJson<RefSale[]>(`${BASE}/search/r-${maker}--${encodeRefPath(ref)}.json?v=${encodeURIComponent(m.v)}`)
      : null))
      .then(s => { if (!s) ledgerCache.delete(key); return s; });
    ledgerCache.set(key, p);
  }
  return p;
}
