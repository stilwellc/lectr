/**
 * fit-close-k.ts — run the bid rooms' close-multiple refit by hand
 * (scripts/lib/close-k-fit.ts; the nightly runs it inside build-upcoming).
 *
 *   npx tsx scripts/fit-close-k.ts --seed <upcoming.json>…   served books → data/closek/snaps/ (backfill the archive)
 *   npx tsx scripts/fit-close-k.ts [--served-sold] [--out DIR]   refit on data/corpus (+ the served sold shards) → DIR/close-k.json
 *   npx tsx scripts/fit-close-k.ts --eval [--served-sold]         held-out grade: compiled table vs a refit on the other half
 *
 * --served-sold adds the sold rows of public/data/ray (lots-*, sold-archive-*)
 * that the local corpus lacks — a local corpus older than the snapshots
 * misses their outcomes. Needs a big heap: NODE_OPTIONS=--max-old-space-size=12288.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus, SERVED_DIR } from './corpus-io';
import { CLOSE_K_DEFAULT, CLOSE_K_ROOMS, dayBucketOf, type CloseKGrid } from '../app/lib/close-k';
import { CLOSE_K_DIR, fitCloseK, obsFromBidHistory, obsFromSnaps, readSnapDir, refitCloseK, snapFromBook, soldIndex, writeSnap, type CloseKObs } from './lib/close-k-fit';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

type Row = Record<string, unknown>;

function loadLots(): Row[] {
  let lots: Row[] = [];
  try { lots = readCorpus(); console.log(`[fit-close-k] corpus: ${lots.length} rows`); }
  catch (e) { console.log(`[fit-close-k] no local corpus (${(e as Error).message.slice(0, 80)}…)`); }
  if (flag('--served-sold')) {
    const have = new Set<string>();
    for (const l of lots) if (l.status === 'sold') have.add(String(l.id));
    let added = 0;
    for (const base of ['lots', 'sold-archive']) {
      const idx = path.join(SERVED_DIR, `${base}-index.json`);
      if (!fs.existsSync(idx)) continue;
      const { shards } = JSON.parse(fs.readFileSync(idx, 'utf8'));
      for (let i = 0; i < shards; i++) {
        const j = JSON.parse(fs.readFileSync(path.join(SERVED_DIR, `${base}-${i}.json`), 'utf8'));
        for (const l of (Array.isArray(j) ? j : j.lots) as Row[]) {
          if (l.status !== 'sold' || have.has(String(l.id))) continue;
          have.add(String(l.id)); lots.push(l); added++;
        }
      }
    }
    console.log(`[fit-close-k] + ${added} served sold rows the corpus lacks`);
  }
  return lots;
}

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** median |log error| of bid × k vs the hammer, one sighting per lot × days bucket (the latest) */
function grade(test: CloseKObs[], table: Record<string, CloseKGrid>) {
  const pick = new Map<string, CloseKObs>();
  for (const o of test) { const k = `${o.id}|${dayBucketOf(o.days)}`; const p = pick.get(k); if (!p || o.days < p.days) pick.set(k, o); }
  const by = new Map<string, number[]>();
  for (const o of Array.from(pick.values())) {
    const g = table[o.room]; if (!g) continue;
    const kk = Math.max(1, g[dayBucketOf(o.days)][o.bid < 100 ? 0 : o.bid < 1e3 ? 1 : o.bid < 1e4 ? 2 : o.bid < 1e5 ? 3 : 4]);
    const e = Math.log(o.bid * kk / o.h);
    for (const key of [o.room, 'ALL']) { const a = by.get(key) ?? []; a.push(e); by.set(key, a); }
  }
  return by;
}

function main() {
  if (flag('--seed')) {
    const files = args.filter(a => a.endsWith('.json'));
    for (const f of files) {
      const u = JSON.parse(fs.readFileSync(f, 'utf8'));
      const snap = snapFromBook(u.generatedAt, u.lots || []);
      const name = `${String(u.generatedAt).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-seed.json.gz`;
      const bytes = writeSnap(path.join(CLOSE_K_DIR, 'snaps', name), snap);
      console.log(`[fit-close-k] seeded ${name}: ${snap.rows.length} rows, ${Math.round(bytes / 1024)}KB`);
    }
    return;
  }
  const lots = loadLots();
  if (flag('--eval')) {
    const snaps = readSnapDir(path.join(CLOSE_K_DIR, 'snaps'));
    const ids = new Set<string>(); for (const s of snaps) for (const r of s.rows) ids.add(r[0]);
    const hist = obsFromBidHistory(lots);
    const snapObs = obsFromSnaps(snaps, soldIndex(lots, ids));
    const all = [...hist, ...snapObs];
    console.log(`[eval] ${hist.length} history + ${snapObs.length} snapshot sightings over ${new Set(all.map(o => o.id)).size} lots`);
    const report = (label: string, train: CloseKObs[], test: CloseKObs[]) => {
      const fit = fitCloseK(train);
      const refit = Object.fromEntries(CLOSE_K_ROOMS.map(r => [r, fit.rooms[r].k]));
      const a = grade(test, CLOSE_K_DEFAULT), b = grade(test, refit);
      console.log(`\n[eval] ${label}: median |error| of bid×k vs hammer (test lots), compiled → refit (bias compiled → refit)`);
      for (const k of [...CLOSE_K_ROOMS, 'ALL']) {
        const x = a.get(k), y = b.get(k);
        if (!x || x.length < 15) { console.log(`  ${k.padEnd(18)} n ${String(x?.length ?? 0).padStart(5)}  ·`); continue; }
        const p = (v: number) => `${(Math.exp(v) * 100 - 100).toFixed(1)}%`;
        console.log(`  ${k.padEnd(18)} n ${String(x.length).padStart(5)}  ${p(med(x.map(Math.abs))).padStart(7)} → ${p(med(y!.map(Math.abs))).padStart(7)}   (${p(med(x)).padStart(7)} → ${p(med(y!)).padStart(7)})`);
      }
    };
    // 1 · id-hash halves (the compiled table saw both halves: in-sample for it)
    report('id-hash split (refit on odd ids, graded on even)', all.filter(o => hash(o.id) % 2 === 1), all.filter(o => hash(o.id) % 2 === 0));
    // 2 · time split: refit on sightings of lots closing before the cut, graded after
    const cut = Date.parse(opt('--cut') || '2026-10-01T00:00:00Z');
    // split on the lot's sold close (sightings carry days out only)
    const soldClose = new Map<string, number>();
    for (const l of lots) if (l.status === 'sold' && l.id) { const d = Date.parse(String(l.saleDateTime || `${l.saleDate}T23:59:00Z`)); if (!isNaN(d)) soldClose.set(String(l.id), d); }
    const before = all.filter(o => (soldClose.get(o.id) ?? 0) < cut), after = all.filter(o => (soldClose.get(o.id) ?? 0) >= cut);
    report(`time split (refit on lots closing before ${new Date(cut).toISOString().slice(0, 10)}: ${before.length} sightings; graded after: ${after.length})`, before, after);
    return;
  }
  const out = opt('--out') || SERVED_DIR;
  fs.mkdirSync(out, { recursive: true });
  const t = refitCloseK(lots, out);
  if (t) console.log(`[fit-close-k] wrote ${path.join(out, 'close-k.json')} (${fs.statSync(path.join(out, 'close-k.json')).size} bytes)`);
}

main();
