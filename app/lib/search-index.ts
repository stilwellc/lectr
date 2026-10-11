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
import { tokenize, shardOf, foldText, refCompact, editDistance, type SearchMeta, type SoldDoc, type RefSale } from './search-tokens';
import { loadPageStats } from './page-data';
import { encodeRefPath } from '../ref/ref-path';

const BASE = '/data/ray';

/* ── meta + the reference list ─────────────────────────────────────────── */

export interface RefRow { maker: string; ref: string; n: number; med: number; /** the model line ('daytona'), when its sales name one */ line?: string | null }

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
      if (m?.refs?.length) return m.refs.map(([maker, ref, n, med, line]) => ({ maker, ref, n, med, line: line ?? null }));
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
 * The dial nicknames collectors search by, on the references that carry them
 * (W3 search, Oct 11). A row answers to its nickname when its reference
 * starts with one of the listed numbers ('6263/6265' is a 6263).
 */
export const REF_NICKNAMES: { maker: string; nick: string; refs: string[] }[] = [
  { maker: 'rolex', nick: 'paul newman', refs: ['6239', '6241', '6262', '6263', '6264', '6265'] },
  { maker: 'rolex', nick: 'big red', refs: ['6263', '6265'] },
  { maker: 'rolex', nick: 'pepsi', refs: ['1675', '16750', '16710', '126710blro', '116719blro'] },
  { maker: 'rolex', nick: 'coke', refs: ['16710', '16760'] },
  { maker: 'rolex', nick: 'root beer', refs: ['16753', '16713', '1675/3', '126711'] },
  { maker: 'rolex', nick: 'batman', refs: ['116710blnr', '126710blnr'] },
  { maker: 'rolex', nick: 'hulk', refs: ['116610lv'] },
  { maker: 'rolex', nick: 'kermit', refs: ['16610lv', '126610lv'] },
  { maker: 'rolex', nick: 'starbucks', refs: ['126610lv'] },
  { maker: 'rolex', nick: 'sprite', refs: ['126720vtnr'] },
  { maker: 'rolex', nick: 'james bond', refs: ['5508', '6538'] },
  { maker: 'rolex', nick: 'red sub', refs: ['1680'] },
  { maker: 'rolex', nick: 'double red', refs: ['1665'] },
  { maker: 'rolex', nick: 'great white', refs: ['1665'] },
  { maker: 'rolex', nick: 'polar', refs: ['16570', '216570'] },
  { maker: 'audemars-piguet', nick: 'jumbo', refs: ['5402', '14802', '15202', '16202'] },
];
const nicknamesOf = (row: RefRow): string => {
  const k = refCompact(row.ref);
  return REF_NICKNAMES
    .filter(n => n.maker === row.maker && n.refs.some(r => k.startsWith(refCompact(r))))
    .map(n => n.nick).join(' ');
};

/**
 * Ranks the reference book against a query. A maker word narrows to that
 * maker; the rest is compared on alphanumerics only ('5711/1A' = '57111a'),
 * exact before prefix, deeper books first; model names ('nautilus', 'royal
 * oak') and dial nicknames ('paul newman', 'pepsi') match the display label.
 * A reference typed among describing words ('rolex 1675 gilt', 'royal oak
 * 15202') is still that reference.
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
  // the reference-shaped words (a digit, 3+ chars; a suffix word like '1a' or
  // 'vtnr' joins the number before it) when other words ride along
  const refWords: string[] = [];
  if (restWords.length > 1) {
    restWords.forEach((w, i) => {
      if (!/\d/.test(w) || refCompact(w).length < 3) return;
      refWords.push(refCompact(w));
      const nx = restWords[i + 1];
      if (nx && /^[a-z0-9]{1,5}$/.test(nx)) refWords.push(refCompact(w + nx));
    });
  }
  const hits: RefHit[] = [];
  for (const row of refs) {
    if (maker && row.maker !== maker) continue;
    const k = refCompact(row.ref);
    if (k === rc) { hits.push({ row, how: 'exact' }); continue; }
    // a reference prefix needs 3+ typed characters and a digit — '57' should
    // not list every 57xx, and 'ro' is a word, not a reference
    if (rc.length >= 3 && /\d/.test(rc) && k.startsWith(rc)) { hits.push({ row, how: 'prefix' }); continue; }
    if (refWords.includes(k)) { hits.push({ row, how: 'exact' }); continue; }
    // the label, plus the line a reference belongs to ("rolex daytona" →
    // Ref. 6263, Ref. 116520 … as well as the 'daytona' bucket), plus its
    // dial nicknames
    const lab = foldText(label(row.ref) + (row.line ? ` ${label(row.line)} ${row.line}` : '') + ` ${nicknamesOf(row)}`);
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
  return (await searchSoldEx(query, limit)).hits;
}

/** a misspelled word's archive spelling: the shard key within its typo
 *  budget (same first letter) with the deepest posting list — taken only when
 *  the word as typed is absent or ~20x rarer (a typo some title also carries) */
function archiveSpelling(t: string, sh: Shard): string | null {
  const budget = /\d/.test(t) || t.length < 4 ? 0 : t.length < 6 ? 1 : 2;
  if (!budget) return null;
  const own = sh[t]?.length ?? 0;
  if (own >= 5) return null;
  let best: string | null = null, bestD = budget + 1, bestN = 0;
  for (const k of Object.keys(sh)) {
    if (k === t || k[0] !== t[0] || Math.abs(k.length - t.length) > budget) continue;
    const d = editDistance(t, k, budget);
    if (d > budget) continue;
    const n = sh[k].length;
    if (d < bestD || (d === bestD && n > bestN)) { best = k; bestD = d; bestN = n; }
  }
  return best && bestN >= Math.max(20 * own, 3) ? best : null;
}

export interface SoldResult {
  hits: SoldHit[];
  /** how many archive sales carry every word — exact only when no word had
   *  to be checked on the text (a common word, a half-typed word); else null */
  total: number | null;
  /** typed word → the archive spelling it was read as ('warhole' → 'warhol') */
  fixed: Record<string, string>;
}

/**
 * searchSold with its count and its spelling fixes. Doc blocks load in waves
 * (the blocks the first `limit` candidates sit in, then more only when the
 * text check rejected some) instead of eight blocks up front: a typical
 * query pays one wave.
 */
export async function searchSoldEx(query: string, limit = 6): Promise<SoldResult> {
  const none: SoldResult = { hits: [], total: null, fixed: {} };
  const meta = await loadSearchMeta();
  if (!meta) return none;
  const toks = tokenize(query);
  if (!toks.length) return none;
  const typing = !/\s$/.test(query);
  const split = new Set(meta.split || []);
  const shardSet = new Set(meta.shards);
  const common = new Set(meta.common);
  const fixed: Record<string, string> = {};

  const lists: number[][] = [];
  const checks: { t: string; prefix: boolean }[] = [];
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    const prefix = typing && i === toks.length - 1 && t.length >= 3;
    // a common word narrows nothing (its completions would narrow WRONGLY —
    // 'rolex' typed would list only 'rolexes'); it is verified on the text below
    if (common.has(t)) { checks.push({ t, prefix }); continue; }
    const key = shardOf(t, split);
    if (!shardSet.has(key)) return none;
    const sh = await loadShard(meta, key);
    if (!sh) return none;
    if (prefix) {
      const keys = Object.keys(sh).filter(k => k.startsWith(t));
      if (!keys.length) {
        // a half-typed word that starts nothing may be a finished typo
        const fix = archiveSpelling(t, sh);
        if (!fix) return none;
        fixed[t] = fix; t = fix;
        checks.push({ t, prefix: false });
        lists.push(decode(sh[t]));
        continue;
      }
      checks.push({ t, prefix });
      // bound the work: the 40 deepest completions carry the useful hits
      keys.sort((a, b) => sh[b].length - sh[a].length);
      lists.push(union(keys.slice(0, 40).map(k => decode(sh[k]))));
    } else {
      const fix = archiveSpelling(t, sh);
      if (fix) { fixed[t] = fix; t = fix; }
      checks.push({ t, prefix });
      if (!sh[t]) return none;
      lists.push(decode(sh[t]));
    }
  }
  if (!lists.length) return none; // only common words — too broad to list
  lists.sort((a, b) => a.length - b.length);
  let ords = lists[0];
  for (let i = 1; i < lists.length && ords.length; i++) ords = intersect(ords, lists[i]);
  const exact = checks.every(c => !c.prefix && !common.has(c.t));

  // verify the common words (and the prefix) against the doc text, walking
  // the lowest ordinals (= newest sales) block by block
  const out: SoldHit[] = [];
  const CANDIDATES = 160;
  const cand = ords.slice(0, CANDIDATES);
  const byBlock = new Map<number, SoldDoc[] | null>();
  let at = 0, loadedBlocks = 0;
  while (at < cand.length && out.length < limit && loadedBlocks < 8) {
    // the next wave: blocks of the next (limit - found) candidates
    const want = new Set<number>();
    for (let j = at; j < cand.length && want.size < Math.max(1, limit - out.length); j++) {
      const b = Math.floor(cand[j] / meta.block);
      if (!byBlock.has(b)) want.add(b);
    }
    const wave = Array.from(want).slice(0, 8 - loadedBlocks);
    loadedBlocks += wave.length;
    (await Promise.all(wave.map(b => loadBlock(meta, b).then(d => [b, d] as const)))).forEach(([b, d]) => byBlock.set(b, d));
    for (; at < cand.length && out.length < limit; at++) {
      const b = Math.floor(cand[at] / meta.block);
      if (!byBlock.has(b)) break; // the next wave fetches it
      const d = byBlock.get(b);
      const doc = d?.[cand[at] % meta.block];
      if (!doc) continue;
      if (!exact) {
        const words = tokenize(`${doc[1]} ${doc[2].replace(/-/g, ' ')}`);
        if (!checks.every(c => (c.prefix ? words.some(w => w.startsWith(c.t)) : words.includes(c.t)))) continue;
      }
      out.push({ id: doc[0], title: doc[1], maker: doc[2], price: doc[3], date: doc[4], house: doc[5] });
    }
  }
  return { hits: out, total: exact ? ords.length : null, fixed };
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
