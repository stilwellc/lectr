/**
 * emit-search-index.ts — the sold-title search index + the per-reference sale
 * ledgers, written next to the served book.
 *
 * WHY: the ⌘K palette searched only makers and the live lots — '5711' or a
 * remembered hammer title dead-ended at "Nothing matches" while the sold book
 * held the answer. The sold book is ~10⁶ titles, far too big to ship whole, so
 * this writes a SHARDED inverted index the palette pulls lazily:
 *
 *   search-meta.json         small: shard list, common tokens, every ref with a
 *                            dossier [maker, ref, n, median]. Fetched when the
 *                            palette opens.
 *   search/t-<pp>.json       token → delta-encoded doc ordinals, for every token
 *                            whose first two chars are <pp>. One shard per typed
 *                            token, fetched on the first keystroke that needs it.
 *   search/d-<n>.json        the doc rows (SoldDoc), BLOCK per file. Ordinals are
 *                            assigned newest-sale-first, so the best (lowest)
 *                            ordinals of any hit list share the first blocks.
 *   search/r-<maker>--<key>.json  every sale behind one /ref dossier (RefSale[]),
 *                            newest first — the /ref chart plots these on a true
 *                            time axis and "show all sales" lists them.
 *
 * Tokens carried by more than COMMON_DF docs ('rolex', 'card', 'signed') ship no
 * postings: they narrow nothing, and the palette verifies them against the doc
 * text after a rarer token has done the narrowing.
 *
 * Reads public/data/ray/{lots,sold-archive}-*.json (the served slim book — the
 * same rows a /lot certificate prints) + refs.json. Pure read of those; writes
 * only search-meta.json and search/. Run after assemble + build-market:
 *
 *   NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/emit-search-index.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVED_DIR } from './corpus-io';
import { tokenize, shardOf, type SoldDoc, type RefSale, type SearchMeta } from '../app/lib/search-tokens';
import { encodeRefPath } from '../app/ref/ref-path';
import type { AuctionLot } from '../app/types';

const BLOCK = 1000;
// a two-char shard heavier than this splits into three-char shards
const SPLIT_BYTES = 160_000;
const COMMON_DF = 15000;
const t0 = Date.now();
const log = (s: string) => console.log(`[search-index] ${s} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const readJson = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(SERVED_DIR, f), 'utf8')) as T;

function shardCount(base: string): number {
  try { return Number(readJson<{ shards: number }>(`${base}-index.json`).shards) || 0; } catch { return 0; }
}

type Row = AuctionLot & { reference?: string | null };

// ── 1 · the sold book, deduped by id ──────────────────────────────────────
const seen = new Set<string>();
const sold: Row[] = [];
for (const base of ['lots', 'sold-archive']) {
  const n = shardCount(base);
  for (let i = 0; i < n; i++) {
    for (const l of readJson<Row[]>(`${base}-${i}.json`)) {
      if (l.status !== 'sold' || !(Number(l.priceUsd) > 0) || !l.title || !l.saleDate) continue;
      const id = String(l.id);
      if (seen.has(id)) continue;
      seen.add(id);
      sold.push(l);
    }
  }
}
if (!sold.length) throw new Error('[search-index] no sold rows in the served book — run assemble first');
// newest sale first; ties by price (the notable lot of the day leads)
sold.sort((a, b) => (a.saleDate! < b.saleDate! ? 1 : a.saleDate! > b.saleDate! ? -1 : (b.priceUsd || 0) - (a.priceUsd || 0)));
log(`${sold.length.toLocaleString()} sold rows`);

const OUT = path.join(SERVED_DIR, 'search');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ── 2 · doc blocks ─────────────────────────────────────────────────────────
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
let bytes = 0;
for (let b = 0; b * BLOCK < sold.length; b++) {
  const docs: SoldDoc[] = sold.slice(b * BLOCK, (b + 1) * BLOCK).map(l => [
    String(l.id), clip(l.title.replace(/\s+/g, ' ').trim(), 120), l.artist, Math.round(l.priceUsd!), l.saleDate!, l.auctionHouse || '',
  ]);
  const s = JSON.stringify(docs);
  bytes += s.length;
  fs.writeFileSync(path.join(OUT, `d-${b}.json`), s);
}
log(`${Math.ceil(sold.length / BLOCK)} doc blocks, ${(bytes / 1048576).toFixed(1)}MB`);

// ── 3 · postings ───────────────────────────────────────────────────────────
// a token posts a doc once; the maker's own slug words post too, so 'nakashima
// chair' finds a chair whose title never names its maker
const post = new Map<string, number[]>();
sold.forEach((l, ord) => {
  const toks = new Set(tokenize(`${l.title} ${l.artist.replace(/-/g, ' ')}`));
  for (const t of Array.from(toks)) {
    const arr = post.get(t);
    if (arr) arr.push(ord); else post.set(t, [ord]);
  }
});
const common: string[] = [];
// pass 1 — size each two-char shard (≈ digits per delta + separators) to find
// the ones that must split
const est = new Map<string, number>();
for (const [tok, ords] of Array.from(post)) {
  if (ords.length > COMMON_DF) continue;
  const k = shardOf(tok);
  est.set(k, (est.get(k) || 0) + tok.length + 4 + ords.length * (Math.max(1, Math.log10(sold.length / ords.length)) + 1.5));
}
const split = new Set(Array.from(est.entries()).filter(([, b]) => b > SPLIT_BYTES).map(([k]) => k));
const shards = new Map<string, Record<string, number[]>>();
for (const [tok, ords] of Array.from(post)) {
  if (ords.length > COMMON_DF) { common.push(tok); continue; }
  const k = shardOf(tok, split);
  const sh = shards.get(k) || (shards.set(k, {}), shards.get(k)!);
  // delta-encode: ordinals ascend, so small gaps serialize as short numbers
  const d = new Array<number>(ords.length);
  for (let i = 0; i < ords.length; i++) d[i] = i ? ords[i] - ords[i - 1] : ords[i];
  sh[tok] = d;
}
let tBytes = 0; let tMax = 0; let tMaxK = '';
for (const [k, sh] of Array.from(shards)) {
  const s = JSON.stringify(sh);
  tBytes += s.length;
  if (s.length > tMax) { tMax = s.length; tMaxK = k; }
  fs.writeFileSync(path.join(OUT, `t-${k}.json`), s);
}
log(`${post.size.toLocaleString()} tokens in ${shards.size} shards (${split.size} split), ${(tBytes / 1048576).toFixed(1)}MB (largest t-${tMaxK} ${(tMax / 1024).toFixed(0)}KB) · ${common.length} common`);

// ── 4 · reference ledgers + the palette's ref list ────────────────────────
interface RefRow { key: string; maker: string; ref: string; n: number; medianUsd: number }
let refs: RefRow[] = [];
try { refs = readJson<{ refs: RefRow[] }>('refs.json').refs || []; } catch { refs = []; }
const refKeys = new Set(refs.map(r => r.key));
const bySale = new Map<string, RefSale[]>();
for (const l of sold) {
  // a reference dossier is a WATCH ledger — the 'panthère' key also tags
  // Cartier brooches, which the dossier's comp pool never counts
  if (!l.reference || (l as Row & { objectClass?: string }).objectClass !== 'watch') continue;
  const key = `${l.artist}:${l.reference}`;
  if (!refKeys.has(key)) continue;
  const arr = bySale.get(key) || (bySale.set(key, []), bySale.get(key)!);
  arr.push([l.saleDate!, Math.round(l.priceUsd!), String(l.id), l.auctionHouse || '', clip(l.title.replace(/\s+/g, ' ').trim(), 90), l.imageUrl || null]);
}
let rFiles = 0;
for (const [key, sales] of Array.from(bySale)) {
  const i = key.indexOf(':');
  fs.writeFileSync(path.join(OUT, `r-${key.slice(0, i)}--${encodeRefPath(key.slice(i + 1))}.json`), JSON.stringify(sales));
  rFiles++;
}
log(`${rFiles} reference ledgers`);

const meta: SearchMeta = {
  v: new Date().toISOString().slice(0, 16),
  block: BLOCK,
  docs: sold.length,
  shards: Array.from(shards.keys()).sort(),
  split: Array.from(split).sort(),
  common: common.sort(),
  refs: refs.map(r => [r.maker, r.ref, r.n, Math.round(r.medianUsd)]),
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(SERVED_DIR, 'search-meta.json'), JSON.stringify(meta));
log(`search-meta.json ${(fs.statSync(path.join(SERVED_DIR, 'search-meta.json')).size / 1024).toFixed(0)}KB — done`);
