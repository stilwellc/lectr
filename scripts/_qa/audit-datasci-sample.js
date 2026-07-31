// Field-presence sampler over the gzipped-NDJSON corpus.
// Reservoir-samples ~N lines per file, reports per-field presence % + examples.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const N = 20000;

function sampleFile(file, n) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  // reservoir sample over lines without building one giant string
  const reservoir = [];
  let count = 0;
  let start = 0;
  const push = (s, e) => {
    if (e <= s) return;
    count++;
    if (reservoir.length < n) reservoir.push([s, e]);
    else {
      const j = Math.floor(Math.random() * count);
      if (j < n) reservoir[j] = [s, e];
    }
  };
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { push(start, i); start = i + 1; }
  }
  push(start, buf.length);
  const rows = reservoir.map(([s, e]) => JSON.parse(buf.toString('utf8', s, e)));
  return { rows, total: count };
}

function profile(rows, label, total) {
  const pres = {}; // field -> {n, examples:Set, types:Set}
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      const p = pres[k] || (pres[k] = { n: 0, ex: [], types: new Set() });
      p.n++;
      p.types.add(Array.isArray(v) ? 'array' : typeof v);
      if (p.ex.length < 3 && Math.random() < 0.01) {
        let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (s.length > 90) s = s.slice(0, 90) + '…';
        p.ex.push(s);
      }
    }
  }
  const out = { label, total, sampled: rows.length, fields: {} };
  for (const [k, p] of Object.entries(pres).sort((a, b) => b[1].n - a[1].n)) {
    out.fields[k] = { pct: +(100 * p.n / rows.length).toFixed(2), types: [...p.types], ex: p.ex };
  }
  return out;
}

// segment breakdown: house x status counts, plus targeted sub-questions
function targeted(rows) {
  const t = {
    byHouse: {}, byStatus: {}, byArtistTop: {},
    bidHistory: { n: 0, lens: [], example: null, dateSpan: {} },
    rrArchiveYears: {}, cardYears: { pre1980: 0, y1980_99: 0, y2000_09: 0, y2010plus: 0, none: 0, totalCards: 0 },
    gradeOnCards: 0, cardsN: 0,
    subCat: {}, drill: {}, flownN: 0,
    firstSeen: {}, bidCountSold: { n: 0, withBC: 0 },
    estOnSold: { n: 0, withEst: 0 }, repeatGroup: 0,
  };
  for (const r of rows) {
    t.byHouse[r.auctionHouse] = (t.byHouse[r.auctionHouse] || 0) + 1;
    t.byStatus[r.status] = (t.byStatus[r.status] || 0) + 1;
    t.byArtistTop[r.artist] = (t.byArtistTop[r.artist] || 0) + 1;
    if (r.bidHistory && Array.isArray(r.bidHistory) && r.bidHistory.length) {
      t.bidHistory.n++;
      t.bidHistory.lens.push(r.bidHistory.length);
      if (!t.bidHistory.example) t.bidHistory.example = r.bidHistory.slice(0, 4);
      for (const s of r.bidHistory) {
        const d = String(s.d || s.date || s.t || '').slice(0, 10);
        if (d) t.bidHistory.dateSpan[d] = (t.bidHistory.dateSpan[d] || 0) + 1;
      }
    }
    if (r.auctionHouse === 'RR Auction' && r.saleDate) {
      const y = r.saleDate.slice(0, 4);
      t.rrArchiveYears[y] = (t.rrArchiveYears[y] || 0) + 1;
    }
    if (r.artist === 'sports-cards') {
      t.cardsN++;
      const cy = r._card && r._card.year ? parseInt(r._card.year) : null;
      if (cy == null || isNaN(cy)) t.cardYears.none++;
      else if (cy < 1980) t.cardYears.pre1980++;
      else if (cy < 2000) t.cardYears.y1980_99++;
      else if (cy < 2010) t.cardYears.y2000_09++;
      else t.cardYears.y2010plus++;
      if (r._card && r._card.gradeNum != null) t.gradeOnCards++;
    }
    if (r.subCat) t.subCat[r.subCat] = (t.subCat[r.subCat] || 0) + 1;
    if (r.drill) t.drill[r.drill] = (t.drill[r.drill] || 0) + 1;
    if (r.flown) t.flownN++;
    if (r.firstSeen) { const m = r.firstSeen.slice(0, 7); t.firstSeen[m] = (t.firstSeen[m] || 0) + 1; }
    if (r.status === 'sold') {
      t.bidCountSold.n++;
      if (r.bidCount > 0) t.bidCountSold.withBC++;
      t.estOnSold.n++;
      if ((r.estLowUsd || r.estimateLow) > 0) t.estOnSold.withEst++;
    }
    if (r.repeatSaleGroupId) t.repeatGroup++;
  }
  t.bidHistory.lenStats = (() => {
    const l = t.bidHistory.lens.sort((a, b) => a - b);
    if (!l.length) return null;
    return { min: l[0], med: l[Math.floor(l.length / 2)], max: l[l.length - 1], mean: +(l.reduce((s, x) => s + x, 0) / l.length).toFixed(1) };
  })();
  delete t.bidHistory.lens;
  // top artists only
  t.byArtistTop = Object.fromEntries(Object.entries(t.byArtistTop).sort((a, b) => b[1] - a[1]).slice(0, 15));
  // firstSeen months sorted
  t.firstSeen = Object.fromEntries(Object.entries(t.firstSeen).sort());
  t.rrArchiveYears = Object.fromEntries(Object.entries(t.rrArchiveYears).sort());
  // bidHistory dateSpan: min/max only
  const ds = Object.keys(t.bidHistory.dateSpan).sort();
  t.bidHistory.dateSpan = ds.length ? { first: ds[0], last: ds[ds.length - 1], distinctDays: ds.length } : null;
  return t;
}

const out = {};
for (const f of ['lots.json.gz', 'sold-archive.json.gz']) {
  const fp = path.join(CORPUS, f);
  const t0 = Date.now();
  const { rows, total } = sampleFile(fp, N);
  out[f] = { profile: profile(rows, f, total), targeted: targeted(rows), ms: Date.now() - t0 };
  console.error(`${f}: ${total} rows, sampled ${rows.length}, ${Date.now() - t0}ms`);
}
fs.writeFileSync(path.join(process.cwd(), 'scripts', '_qa', 'audit-datasci-sample.json'), JSON.stringify(out, null, 1));
console.error('wrote scripts/_qa/audit-datasci-sample.json');
