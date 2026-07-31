/**
 * submarket-mine.ts — research pass for the sub-category program.
 * Streams the full corpus (main + sold archive) and measures, per vertical,
 * the coverage and value-distribution of every candidate sub-category axis
 * that already exists in the data (stamped fields, slugs, parseable structure).
 * Read-only. Output: scripts/_qa/submarket-mine.json + console summary.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { ARTIST_MARKET } from '../../app/constants';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');

type Counter = Map<string, number>;
const bump = (c: Counter, k: string | null | undefined, n = 1) => {
  if (!k) return;
  c.set(k, (c.get(k) || 0) + n);
};
const top = (c: Counter, n: number) =>
  Array.from(c.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);

interface VertAgg {
  n: number;
  sold: number;
  bySlug: Counter;
  byHouse: Counter;
  // axis coverage counts
  cov: Record<string, number>;
  // axis value distributions
  vals: Record<string, Counter>;
}
const mkAgg = (): VertAgg => ({ n: 0, sold: 0, bySlug: new Map(), byHouse: new Map(), cov: {}, vals: {} });
const verts = new Map<string, VertAgg>();
const cover = (a: VertAgg, axis: string, v: string | null | undefined) => {
  if (v == null || v === '') return;
  a.cov[axis] = (a.cov[axis] || 0) + 1;
  if (!a.vals[axis]) a.vals[axis] = new Map();
  bump(a.vals[axis], String(v).slice(0, 60));
};

// field-presence census (which keys exist at all, per vertical)
const fieldCensus = new Map<string, Counter>();

function eat(l: Record<string, unknown>) {
  const slug = l.artist as string;
  const vert = ARTIST_MARKET[slug as keyof typeof ARTIST_MARKET] || 'unknown';
  let a = verts.get(vert);
  if (!a) { a = mkAgg(); verts.set(vert, a); }
  a.n++;
  if (l.status === 'sold') a.sold++;
  bump(a.bySlug, slug);
  bump(a.byHouse, l.auctionHouse as string);

  let fc = fieldCensus.get(vert);
  if (!fc) { fc = new Map(); fieldCensus.set(vert, fc); }
  for (const k of Object.keys(l)) if (l[k] != null) bump(fc, k);

  // shared axes
  cover(a, 'formKey', l.formKey as string);
  cover(a, 'modelKey', l.modelKey as string);
  cover(a, 'reference', l.reference as string);
  cover(a, 'category', l.category as string);
  cover(a, 'mediumCanon', l.mediumCanon as string);
  cover(a, 'catReclass', l.catReclass as string);
  cover(a, 'objectType', l.objectType as string);
  cover(a, 'playerSlug', l.playerSlug as string);
  cover(a, 'itemClass', l.itemClass as string);
  cover(a, 'yearNum', l.yearNum != null ? String(Math.floor((l.yearNum as number) / 10) * 10) : null);
  cover(a, 'sizeClass', l.sizeClass as string);
  cover(a, 'gradeLabel', l.gradeLabel as string);
  const sk = l.subjectKeys as string[] | undefined;
  if (Array.isArray(sk) && sk.length) { a.cov['subjectKeys'] = (a.cov['subjectKeys'] || 0) + 1; if (!a.vals['subjectKeys']) a.vals['subjectKeys'] = new Map(); for (const s of sk) bump(a.vals['subjectKeys'], s); }
  const card = l._card as Record<string, unknown> | undefined;
  if (card) {
    cover(a, 'card.sport', (card.sport as string) ?? null);
    cover(a, 'card.setName', card.setName as string);
    cover(a, 'card.gradeCo', card.gradeCo as string);
    cover(a, 'card.year', card.year != null ? String(Math.floor((card.year as number) / 10) * 10) : null);
  }
  const mt = l.materialTokens as string[] | undefined;
  if (Array.isArray(mt) && mt.length) { a.cov['materialTokens'] = (a.cov['materialTokens'] || 0) + 1; if (!a.vals['materialTokens']) a.vals['materialTokens'] = new Map(); for (const m of mt.slice(0, 4)) bump(a.vals['materialTokens'], m); }
  cover(a, 'saleName', (l.saleName as string || '').slice(0, 48));
  cover(a, 'source', l.source as string);
}

function stream(file: string) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  let start = 0, n = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start);
    if (end === -1) end = buf.length;
    if (end > start + 1) {
      const line = buf.toString('utf8', start, end).trim();
      if (line && line !== '[' && line !== ']') {
        try { eat(JSON.parse(line.replace(/,$/, ''))); n++; } catch { /* legacy array line */
          try { const arr = JSON.parse(line); if (Array.isArray(arr)) { arr.forEach(eat); n += arr.length; } } catch {}
        }
      }
    }
    start = end + 1;
  }
  console.log(`[mine] ${path.basename(file)}: ${n} lots`);
}

stream(path.join(CORPUS, 'lots.json.gz'));
stream(path.join(CORPUS, 'sold-archive.json.gz'));

const out: Record<string, unknown> = {};
for (const [vert, a] of Array.from(verts.entries()).sort((x, y) => y[1].n - x[1].n)) {
  const axes: Record<string, unknown> = {};
  for (const [axis, cnt] of Object.entries(a.cov).sort((x, y) => y[1] - x[1])) {
    axes[axis] = { coverage: cnt, pct: +(100 * cnt / a.n).toFixed(1), top: top(a.vals[axis], axis === 'saleName' ? 25 : 40) };
  }
  out[vert] = { n: a.n, sold: a.sold, slugs: top(a.bySlug, 20), houses: top(a.byHouse, 10), axes, fields: top(fieldCensus.get(vert)!, 60) };
  console.log(`\n=== ${vert} · ${a.n} lots (${a.sold} sold) ===`);
  console.log('  slugs:', top(a.bySlug, 8).map(([k, v]) => `${k}:${v}`).join(' '));
  for (const [axis, cnt] of Object.entries(a.cov).sort((x, y) => y[1] - x[1]).slice(0, 12)) {
    console.log(`  ${axis.padEnd(16)} ${String(cnt).padStart(7)} (${(100 * cnt / a.n).toFixed(0)}%)  ${top(a.vals[axis], 6).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
  }
}
fs.writeFileSync(path.join(process.cwd(), 'scripts', '_qa', 'submarket-mine.json'), JSON.stringify(out, null, 1));
console.log('\n[mine] wrote scripts/_qa/submarket-mine.json');
