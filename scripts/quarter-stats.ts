/**
 * quarter-stats.ts — the numbers behind a quarterly "in review" note (/blog/qN-YYYY-<market>).
 *
 *   npx tsx scripts/quarter-stats.ts 2026 3 [out.json]
 *
 * One pass over the normalized corpus; every figure a note prints comes from here, so the notes
 * stop being hand-derived (the Q2 set was computed ad hoc). Bases match the site:
 *   - realized = the published sold price (priceUsd, premium-inclusive where the house's is)
 *   - vs estimate = RAW sold price / estimate midpoint (utils.overEstimatePct — the BASIS RULE)
 *   - sell-through = sold / (sold + bought-in), withdrawn and upcoming excluded
 *   - "same quarter last year" reads compare like with like (same maker, same quarter)
 */
import fs from 'fs';
import { readCorpus } from './corpus-io';
import { marketOf, ARTIST_LABEL } from '../app/constants';
import { overEstimatePct } from '../app/utils';

const [yy, qq, outFile] = [Number(process.argv[2] || 2026), Number(process.argv[3] || 3), process.argv[4]];
const qStart = (y: number, q: number) => `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
const qEnd = (y: number, q: number) => (q === 4 ? `${y + 1}-01-01` : qStart(y, q + 1));
const inQ = (d: string | undefined, y: number, q: number) => !!d && d >= qStart(y, q) && d < qEnd(y, q);

type L = Record<string, any>;
const all = readCorpus() as L[];
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normalizeCorpus } = require('./lib/corpus-normalize');
normalizeCorpus(all, { now: new Date() });

const SOLD = (l: L) => l.status === 'sold' && Number(l.priceUsd) > 0;
const BI = (l: L) => ['passed', 'unsold', 'bought-in', 'bought_in', 'not_sold'].includes(String(l.status));
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

function block(lots: L[]) {
  const sold = lots.filter(SOLD), bi = lots.filter(BI);
  const prices = sold.map(l => Number(l.priceUsd));
  const total = prices.reduce((a, b) => a + b, 0);
  const withEst = sold.filter(l => overEstimatePct(l) != null);
  const ratios = withEst.map(l => 1 + (overEstimatePct(l) as number) / 100);
  const beatHigh = withEst.filter(l => Number(l.priceUsd) > Number(l.estimateHigh || l.estimateLow)).length;
  const underLow = withEst.filter(l => Number(l.priceUsd) < Number(l.estimateLow || l.estimateHigh)).length;
  return {
    sold: sold.length, boughtIn: bi.length,
    sellThrough: sold.length + bi.length ? r1((100 * sold.length) / (sold.length + bi.length)) : null,
    total: Math.round(total), median: median(prices),
    withEstimate: withEst.length,
    medianVsEst: ratios.length ? Math.round((median(ratios) as number) * 100) / 100 : null,
    beatHighPct: withEst.length ? r1((100 * beatHigh) / withEst.length) : null,
    underLowPct: withEst.length ? r1((100 * underLow) / withEst.length) : null,
  };
}
const share = (lots: L[], key: (l: L) => string, total: number) => {
  const m = new Map<string, { v: number; n: number }>();
  for (const l of lots.filter(SOLD)) { const k = key(l) || '—'; const e = m.get(k) || { v: 0, n: 0 }; e.v += Number(l.priceUsd); e.n++; m.set(k, e); }
  return Array.from(m).map(([k, e]) => ({ key: k, value: Math.round(e.v), n: e.n, pct: r1((100 * e.v) / (total || 1)) })).sort((a, b) => b.value - a.value);
};

const markets = ['art', 'watches', 'design', 'sports', 'science', 'tcg', 'culture'];
const out: Record<string, any> = { quarter: `Q${qq} ${yy}`, range: [qStart(yy, qq), qEnd(yy, qq)], generatedAt: new Date().toISOString() };
// prior record per maker (max sold price strictly before the quarter) — one pass, no giant spreads
const priorMaxOf = new Map<string, number>();
for (const l of all) if (SOLD(l) && String(l.saleDate) < qStart(yy, qq)) { const k = String(l.artist); if (Number(l.priceUsd) > (priorMaxOf.get(k) || 0)) priorMaxOf.set(k, Number(l.priceUsd)); }
for (const mk of markets) {
  const cur = all.filter(l => marketOf(String(l.artist)) === mk && inQ(l.saleDate, yy, qq));
  const prev = all.filter(l => marketOf(String(l.artist)) === mk && inQ(l.saleDate, yy - 1, qq));
  const priorQ = qq === 1 ? [yy - 1, 4] : [yy, qq - 1];
  const prevQ = all.filter(l => marketOf(String(l.artist)) === mk && inQ(l.saleDate, priorQ[0], priorQ[1]));
  const b = block(cur);
  const byMaker = new Map<string, L[]>(); for (const l of cur) { const k = String(l.artist); (byMaker.get(k) || byMaker.set(k, []).get(k)!).push(l); }
  const prevByMaker = new Map<string, L[]>(); for (const l of prev) { const k = String(l.artist); (prevByMaker.get(k) || prevByMaker.set(k, []).get(k)!).push(l); }
  const makers = Array.from(byMaker).map(([slug, ls]) => {
    const cb = block(ls), pb = block(prevByMaker.get(slug) || []);
    const dem = ls.filter(SOLD).map(l => overEstimatePct(l)).filter((x): x is number => x != null);
    const pdem = (prevByMaker.get(slug) || []).filter(SOLD).map((l: L) => overEstimatePct(l)).filter((x): x is number => x != null);
    // prior record before this quarter (all earlier sold lots for this maker)
    const priorMax = priorMaxOf.get(slug) || 0;
    let qMax = 0; for (const l of ls) if (SOLD(l) && Number(l.priceUsd) > qMax) qMax = Number(l.priceUsd);
    return {
      slug, label: ARTIST_LABEL[slug] || slug, ...cb,
      demand: r1(median(dem)), demandN: dem.length, demandPrev: r1(median(pdem)), demandPrevN: pdem.length,
      medianPrev: pb.median, soldPrev: pb.sold, totalPrev: pb.total,
      medianYoY: cb.median && pb.median && cb.sold >= 5 && pb.sold >= 5 ? r1(100 * (cb.median / pb.median - 1)) : null,
      newRecord: qMax > priorMax && priorMax > 0 ? { prior: priorMax, now: qMax } : null,
    };
  }).filter(m => m.sold > 0).sort((a, b) => b.total - a.total);
  const top = cur.filter(SOLD).sort((a, b) => b.priceUsd - a.priceUsd).slice(0, 15).map(l => ({
    id: l.id, title: l.title, priceUsd: l.priceUsd, house: l.auctionHouse, date: l.saleDate, maker: l.artist, sale: l.saleName,
    estLow: l.estimateLow ?? null, estHigh: l.estimateHigh ?? null, image: l.imageUrl, url: l.url, objectType: l.objectType ?? null, subCat: l.subCat ?? null,
  }));
  out[mk] = {
    ...b, prevYear: block(prev), prevQuarter: block(prevQ),
    houses: share(cur, l => String(l.auctionHouse), b.total).slice(0, 10),
    subCats: share(cur, l => String(l.subCat || l.objectType || l.category || ''), b.total).slice(0, 12),
    makers: makers.slice(0, 40), top,
    closingNextQuarter: all.filter(l => marketOf(String(l.artist)) === mk && l.status === 'upcoming' && inQ(l.saleDate, ...(qq === 4 ? [yy + 1, 1] : [yy, qq + 1]) as [number, number])).length,
  };
  console.log(`[q] ${mk}: $${(b.total / 1e6).toFixed(1)}M · ${b.sold} sold · ST ${b.sellThrough}% · median $${b.median} · vsEst ${b.medianVsEst}× · beatHigh ${b.beatHighPct}%`);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
