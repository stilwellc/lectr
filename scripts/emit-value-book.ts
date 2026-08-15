/**
 * emit-value-book.ts — lectr's value book for Starling (the buy-side sibling).
 *
 * Emits ONE row per high-confidence identity key per vertical:
 *   { k, v, med, lo, hi, n, lastSale, trend, conf }
 * gzipped → PRIVATE R2 (lectr-data/latest/value-book.json.gz). Starling reads it
 * with a scoped read token; the book is never published publicly (it's the moat).
 *
 * The identity keys MUST be byte-identical to what Starling's matchers produce
 * (Starling ported its parsers from these very functions), so we reuse lectr's
 * key machinery as the source of truth and map lectr's markets → Starling's
 * vertical slugs. Two segments Starling hyphenates (art-edition titles, autograph
 * signers) are slug()'d here to match.
 *
 * Runs in the nightly `assemble` job after the corpus is built + normalized.
 * Standalone: loads the corpus itself (NODE_OPTIONS=--max-old-space-size≈8192).
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { readGzRows, CORPUS_DIR } from './corpus-io';
import { normalizeCorpus } from './lib/corpus-normalize';
import {
  numericWatchRef,
  editionIdentityKey,
  isEditionLot,
  autographFormatOf,
  WATCH_SLUGS,
  AUTOGRAPH_SLUGS,
} from '../app/lib/identity';
import { marketOf } from '../app/constants';
import { extractSignerSlug } from './lib/autograph-signer';
import type { AuctionLot } from '../app/types';

// ── Starling's slug (replicated verbatim so keys match) ──────────────────────
function slug(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── value.ts primitives (module-private there — copied) ──────────────────────
function weightedMedian(pairs: [number, number][]): number {
  const s = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = s.reduce((t, p) => t + p[1], 0);
  let c = 0;
  for (const [v, w] of s) {
    c += w;
    if (c >= total / 2) return v;
  }
  return s.length ? s[s.length - 1][0] : 0;
}
function quantile(sortedVals: number[], q: number): number {
  if (!sortedVals.length) return 0;
  const i = Math.min(sortedVals.length - 1, Math.max(0, Math.round(q * (sortedVals.length - 1))));
  return sortedVals[i];
}
function lerpQuantile(sortedVals: number[], q: number): number {
  if (!sortedVals.length) return 0;
  const pos = q * (sortedVals.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedVals[lo];
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (pos - lo);
}

// ── card + pokemon keys (module-private in sub-markets.ts — copied, minus the
//    /serial suffix Starling doesn't carry) ──────────────────────────────────
function cardKeyNoSerial(l: AuctionLot): string | null {
  const c = l._card;
  if (!c || !c.playerSlug || !c.year || !c.cardNo) return null;
  // Serial-numbered parallels (/25, 1/1) are a DIFFERENT market than the base
  // card — pooling them into the base key inflates its median, and Starling's
  // eBay matcher joins base pools. Exclude them rather than mis-price the base.
  if (c.serialOf != null) return null;
  const grade = c.gradeCo && c.gradeNum != null ? `${c.gradeCo}${c.gradeNum}` : 'raw';
  const set = (c.setName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${c.playerSlug}|${c.year}|${set}|${c.cardNo}|${grade}`;
}
const PKMN_GRADE = /\b(PSA|BGS|CGC|SGC)\s*(?:GEM\s*MT|GEM\s*MINT|MINT|NM-?MT\+?|NM|EX-?MT|EX|VG)?\s*(10|[1-9](?:\.5)?)\b/i;
function pokemonKey(l: AuctionLot): string | null {
  if (l.artist !== 'pokemon') return null;
  const t = l.title || '';
  const yr = (t.match(/\b(19|20)\d{2}\b/) || [])[0];
  const no = (t.match(/#([A-Za-z0-9]+)\b/) || [])[1];
  const g = t.match(PKMN_GRADE);
  if (!yr || !no || !g) return null;
  const setPart = t
    .slice(t.indexOf(yr) + 4)
    .split('#')[0]
    .replace(/\b(pok[eé]mon|holo(?:foil)?|1st edition|shadowless|unlimited|reverse|japanese|english)\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-');
  if (!setPart) return null;
  const ed = /1st edition/i.test(t) ? '1st' : /shadowless/i.test(t) ? 'shadowless' : 'unl';
  return `${yr}|${setPart}|${no}|${ed}|${g[1].toUpperCase()}${g[2]}`;
}

type Vertical = 'sports-cards' | 'autographs' | 'pokemon' | 'art-editions' | 'watches' | 'design';

/** Route a lot to its identity key + Starling vertical, or null to skip.
 *  Autographs first (signer+format), then pokémon, then market-dispatched. */
function keyForLot(l: AuctionLot): { key: string; v: Vertical } | null {
  // Autographs: science/culture (excl. pokémon) + the autographs slug.
  if (AUTOGRAPH_SLUGS.has(l.artist)) {
    const fmt = autographFormatOf(l.title);
    if (!fmt) return null;
    const signer = extractSignerSlug(l); // structured field OR parsed from RR/Christie's title/medium
    if (!signer) return null;
    return { key: `${signer}|${fmt}`, v: 'autographs' };
  }
  if (l.artist === 'pokemon') {
    const k = pokemonKey(l);
    return k ? { key: k, v: 'pokemon' } : null;
  }
  const m = marketOf(l.artist);
  if (m === 'sports') {
    const k = cardKeyNoSerial(l);
    return k ? { key: k, v: 'sports-cards' } : null;
  }
  if (WATCH_SLUGS.has(l.artist)) {
    const k = numericWatchRef(l);
    return k ? { key: k, v: 'watches' } : null;
  }
  if (m === 'art') {
    if (!isEditionLot(l)) return null;
    const k = editionIdentityKey(l);
    if (!k) return null;
    const bar = k.indexOf('|');
    // Starling hyphenates the normalized title segment; match it.
    return { key: `${k.slice(0, bar)}|${slug(k.slice(bar + 1))}`, v: 'art-editions' };
  }
  if (m === 'design') {
    const mk = l.modelKey ?? null; // persisted; no comps.ts import needed
    return mk ? { key: `${l.artist}|${mk}`, v: 'design' } : null;
  }
  return null;
}

interface ValueBookRow {
  k: string;
  v: Vertical;
  med: number;
  lo: number;
  hi: number;
  n: number;
  lastSale: string;
  trend: number | null;
  conf: 'high' | 'medium';
}

const YEAR_MS = 365.25 * 864e5;

function main() {
  const REF_MS = Date.now();
  console.log('[value-book] reading corpus…');
  const lots = readGzRows(path.join(CORPUS_DIR, 'lots.json.gz')) as unknown as AuctionLot[];
  const archive = readGzRows(path.join(CORPUS_DIR, 'sold-archive.json.gz')) as unknown as AuctionLot[];
  const all = lots.concat(archive);
  console.log(`[value-book] ${all.length.toLocaleString()} lots; normalizing…`);
  normalizeCorpus(all);

  // Pool settled sales by identity key.
  const pools = new Map<string, { v: Vertical; prices: [number, number][]; last: string }>();
  let sold = 0;
  for (const l of all) {
    if (l.status !== 'sold') continue;
    const price = (l.realizedUsd ?? l.priceUsd) as number | null | undefined;
    if (!price || price <= 0 || !l.saleDate) continue;
    const ms = Date.parse(l.saleDate);
    if (!Number.isFinite(ms)) continue;
    const kv = keyForLot(l);
    if (!kv) continue;
    sold++;
    let p = pools.get(kv.key);
    if (!p) {
      p = { v: kv.v, prices: [], last: l.saleDate };
      pools.set(kv.key, p);
    }
    p.prices.push([price, ms]);
    if (l.saleDate > p.last) p.last = l.saleDate;
  }
  console.log(`[value-book] ${sold.toLocaleString()} keyed sales → ${pools.size.toLocaleString()} keys`);

  // Aggregate each key: recency-weighted median + band + confidence tier + trend.
  const rows: ValueBookRow[] = [];
  for (const [k, p] of Array.from(pools.entries())) {
    const n = p.prices.length;
    if (n < 4) continue; // below the medium bar → never ships
    const vals = p.prices.map((x: [number, number]) => x[0]).sort((a: number, b: number) => a - b);
    const disp = quantile(vals, 0.75) / Math.max(quantile(vals, 0.25), 1);
    // Vertical-aware dispersion tolerance for the MEDIUM tier. Graded cards are
    // fungible (same card+grade → same price) so stay strict; autographs and
    // editions legitimately spread wide (content/state-driven), and the honest
    // lo–hi band already carries that uncertainty. High tier stays strict for
    // all — a high call means a genuinely clustered pool.
    const MEDIUM_DISP: Record<Vertical, number> = {
      'sports-cards': 2.5,
      pokemon: 2.5,
      design: 3.0,
      watches: 3.5,
      'art-editions': 3.5,
      autographs: 5.0,
    };
    let conf: 'high' | 'medium' | null = null;
    if (n >= 6 && disp <= 1.5) conf = 'high';
    else if (n >= 4 && disp <= (MEDIUM_DISP[p.v] ?? 2.5)) conf = 'medium';
    if (!conf) continue; // drop 'low' — only high/medium ship

    // Staleness gate: a pool whose LATEST sale is >4y old is not a tradable
    // book — "60% under" a 2015 median is not a live call. (2–4y rows ship and
    // Starling badges them "aging"; older is dropped.)
    if (REF_MS - Date.parse(p.last) > 4 * YEAR_MS) continue;

    const wpairs: [number, number][] = p.prices.map(([usd, ms]) => [
      usd,
      Math.pow(0.5, (REF_MS - ms) / YEAR_MS / 2),
    ]);
    const med = Math.round(weightedMedian(wpairs));
    // Band from unweighted quantiles, CLAMPED to contain the recency-weighted
    // median — a med outside its own band (11% of rows otherwise, when recent
    // sales run hot/cold vs the all-time distribution) breaks the display
    // semantics and the honesty of "the band".
    const lo = Math.min(Math.round(lerpQuantile(vals, 0.15)), med);
    const hi = Math.max(Math.round(lerpQuantile(vals, 0.85)), med);

    // 1Y trend: trailing-12mo median vs prior-12mo median (fraction), else null.
    const t12 = p.prices.filter(([, ms]) => REF_MS - ms <= YEAR_MS).map((x: [number, number]) => x[0]).sort((a: number, b: number) => a - b);
    const p12 = p.prices
      .filter(([, ms]) => REF_MS - ms > YEAR_MS && REF_MS - ms <= 2 * YEAR_MS)
      .map((x: [number, number]) => x[0])
      .sort((a: number, b: number) => a - b);
    const trend =
      t12.length && p12.length ? Number((quantile(t12, 0.5) / quantile(p12, 0.5) - 1).toFixed(3)) : null;

    rows.push({ k, v: p.v, med, lo, hi, n, lastSale: p.last, trend, conf });
  }

  rows.sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : b.med - a.med));
  const book = { schema: 1 as const, builtAt: new Date().toISOString(), rows };

  // Per-vertical tally for the log.
  const byV: Record<string, number> = {};
  for (const r of rows) byV[r.v] = (byV[r.v] ?? 0) + 1;
  console.log(`[value-book] ${rows.length.toLocaleString()} rows: ${JSON.stringify(byV)}`);

  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(book)));
  const tmp = path.join(os.tmpdir(), 'value-book.json.gz');
  fs.writeFileSync(tmp, gz);
  console.log(`[value-book] wrote ${(gz.length / 1024).toFixed(0)}KB gz → ${tmp}`);

  // Push to PRIVATE R2 the house way (data-store.sh pattern): the payload goes
  // to a WRITE-ONCE versioned key — a fresh key can never be stale-cached, its
  // first read is authoritative — and only a tiny pointer is overwritten.
  // (Measured: an overwritten 220KB `latest/` object served 79-minutes-stale
  // reads; a few-byte pointer flips fast. Never overwrite payloads.)
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || '5bcc5f43136c9ba6b6cb7f949813f473';
  if (!token) {
    console.warn('[value-book] no CLOUDFLARE_API_TOKEN — wrote local file only, skipping R2 push.');
    return;
  }
  const objUrl = (key: string) =>
    `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/lectr-data/objects/${encodeURIComponent(key)}`;
  const put = (key: string, file: string, type = 'application/octet-stream') =>
    execFileSync(
      'curl',
      ['-sf', '-X', 'PUT', '-H', `Authorization: Bearer ${token}`, '-H', `Content-Type: ${type}`, '--data-binary', `@${file}`, objUrl(key)],
      { stdio: 'inherit' },
    );

  const stamp = book.builtAt.replace(/[-:]/g, '').replace(/\..+/, '');
  const versionKey = `value-book/versions/${stamp}.json.gz`;
  put(versionKey, tmp);
  const ptr = path.join(os.tmpdir(), 'value-book-pointer.txt');
  fs.writeFileSync(ptr, versionKey);
  put('value-book/latest.txt', ptr, 'text/plain');
  // legacy key for one transition cycle (older Starling readers)
  put('latest/value-book.json.gz', tmp);
  console.log(`[value-book] pushed → lectr-data/${versionKey} (+ pointer value-book/latest.txt)`);
}

main();
