/**
 * deep-value.ts — find lots where OUR engine had evidence of a lot's value and
 * the lot then sold UNDER it.
 *
 * This is the end-to-end proof of the product, and it is deliberately NOT
 * "sold under the house estimate" — that is the house's opinion missing, not
 * our tool working. Here the engine prices the lot from comparable SOLD
 * evidence, using only sales dated strictly before it (valueOne → the same
 * resolveComps/estimateValue production runs), and we keep the cases where the
 * hammer came in materially below that comp-derived value.
 *
 * The strongest tier is a REPEAT SALE: the same object (or same model) is on
 * record selling for $Z, and this one traded well under it. That is not a
 * model output — it is the same thing, cheaper.
 *
 * Read-only. Writes a JSON report to scripts/_qa/ga/deep-value.json.
 *
 *   npx tsx scripts/_qa/deep-value.ts                 # last 3 years, est >= $10k
 *   SINCE=2020-01-01 MIN_EST=25000 npx tsx scripts/_qa/deep-value.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus } from '../corpus-io';
import { prepare, valueOne, hasEst, type L } from '../backtest-core';
import { ARTISTS } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

const SINCE = process.env.SINCE || new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
const MIN_EST = Number(process.env.MIN_EST || 10000);
const MIN_COMPS = Number(process.env.MIN_COMPS || 5);
const MIN_DISCOUNT = Number(process.env.MIN_DISCOUNT || 0.45); // sold >=45% under our value
const MIN_CONF = process.env.ALLOW_LOW !== '1'; // drop 'low' confidence by default
// Stop as soon as we have enough examples. The replay is O(targets x priors)
// and Goldin's roster is ~320k sold priors per call, so a full sweep of the
// no-estimate markets costs hours to answer a question that needs a handful of
// cases. ENOUGH=0 restores the exhaustive run.
const ENOUGH = Number(process.env.ENOUGH ?? 24);
// MARKET=culture,science scopes the scan to those verticals. Without it the
// sweep runs in corpus order, which front-loads Goldin — so an early exit can
// fill up on sports and never reach a thinner vertical at all.
const MARKET_FILTER = (process.env.MARKET || '').split(',').map(x => x.trim()).filter(Boolean);
const MARKET_OF: Record<string, string> = Object.fromEntries(ARTISTS.map(a => [a.slug, a.market]));

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const log = (m: string) => console.log(m);

const all = readCorpus() as unknown as AuctionLot[];
const prep = prepare(all, log, elapsed);

// Targets: sold, with an estimate (so the house's view is available for
// context), inside the window, materially sized.
// NO_EST=1 targets the markets where the engine's absolute value is the ONLY
// valuation there is — Goldin sports/science publish no estimate at all, and
// that is precisely where holdout validation says the absolute read is usable
// (1.32x at high confidence). Requiring an estimate silently excluded them and
// left only unique art, where we deliberately DEFER to the house.
const NO_EST = process.env.NO_EST === '1';
const targets = prep.sold.filter((l) =>
  (MARKET_FILTER.length === 0 || MARKET_FILTER.includes(MARKET_OF[l.artist] || '')) &&
  l.saleDate >= SINCE && (NO_EST
    ? !hasEst(l) && (l.realizedUsd || 0) >= MIN_EST
    : hasEst(l) && ((l.estLowUsd || 0) + (l.estHighUsd || 0)) / 2 >= MIN_EST),
);
log(`[deep-value] ${targets.length} sold targets since ${SINCE} with est >= $${MIN_EST.toLocaleString()}`);

interface Hit {
  id: string; title: string; maker: string; house: string; saleDate: string; url: string | null;
  realizedUsd: number; ourValueUsd: number; discountPct: number;
  comps: number; confidence: string; basis?: string;
  estLow: number | null; estHigh: number | null;
  exact?: { id: string; realizedUsd: number; saleDate: string; cls: string } | null;
}

const hits: Hit[] = [];
let scored = 0;
for (let i = 0; i < targets.length; i++) {
  if (ENOUGH && hits.length >= ENOUGH) { log(`[deep-value] ${ENOUGH} examples found — stopping early at ${i}/${targets.length}`); break; }
  const lot = targets[i];
  if (i % 2000 === 0 && i) log(`  …${i}/${targets.length} (${elapsed()}) — ${hits.length} hits`);
  let v;
  try { v = valueOne(prep, lot); } catch { continue; }
  if (!v || !(v.compValueUsd > 0) || (v.n || 0) < MIN_COMPS) continue;
  // Only cases the engine would actually STAND BEHIND. 'low' confidence is the
  // tier that produced every absurd art valuation in the first pass.
  if (MIN_CONF && String(v.confidence) === 'low') continue;
  scored++;
  const realized = lot.realizedUsd!;
  const disc = realized / v.compValueUsd - 1;
  if (disc > -MIN_DISCOUNT) continue;
  hits.push({
    id: lot.id, title: lot.title, maker: lot.artist, house: lot.auctionHouse,
    saleDate: lot.saleDate, url: (lot as AuctionLot).url ?? null,
    realizedUsd: Math.round(realized), ourValueUsd: Math.round(v.compValueUsd),
    discountPct: Math.round(disc * 1000) / 10,
    comps: v.n, confidence: String(v.confidence), basis: v.basis,
    estLow: lot.estLowUsd ?? null, estHigh: lot.estHighUsd ?? null,
    exact: v.exact ? {
      id: v.exact.id, realizedUsd: Math.round(v.exact.realizedUsd),
      saleDate: v.exact.saleDate, cls: String(v.exact.cls),
    } : null,
  });
}

// A repeat-sale hit is the headline case: the same object on record, cheaper.
hits.sort((a, b) => {
  const ax = a.exact ? 1 : 0, bx = b.exact ? 1 : 0;
  if (ax !== bx) return bx - ax;
  return a.discountPct - b.discountPct;
});

const outDir = path.join(process.cwd(), 'scripts', '_qa', 'ga');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'deep-value.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  params: { SINCE, MIN_EST, MIN_COMPS, MIN_DISCOUNT },
  scored, hits: hits.length, rows: hits.slice(0, 200),
}, null, 2));

log(`\n[deep-value] engine priced ${scored} of ${targets.length} targets with >=${MIN_COMPS} comps`);
log(`[deep-value] ${hits.length} sold >=${MIN_DISCOUNT * 100}% UNDER our comp-derived value (${elapsed()})\n`);
for (const h of hits.slice(0, 14)) {
  log(`  ${h.maker} · ${h.house} · ${h.saleDate}`);
  log(`    ${h.title.slice(0, 78)}`);
  log(`    our value $${h.ourValueUsd.toLocaleString()} from ${h.comps} comps (${h.confidence})` +
      (h.estLow ? ` · house est $${h.estLow.toLocaleString()}–$${(h.estHigh || 0).toLocaleString()}` : ''));
  log(`    SOLD $${h.realizedUsd.toLocaleString()}  →  ${h.discountPct}% under our value`);
  if (h.exact) log(`    ↳ same ${h.exact.cls === 'physicalMatch' ? 'ITEM' : 'model'} sold $${h.exact.realizedUsd.toLocaleString()} on ${h.exact.saleDate}`);
  log(`    ${h.url || '(no url)'}`);
  log('');
}
