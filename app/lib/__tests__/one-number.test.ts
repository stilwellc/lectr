/**
 * ONE LOT, ONE NUMBER (r8, QA3 N1/N5/N10). Every value figure a surface
 * prints about a live lot comes from lib/lot-face's lotFace(); the record's
 * headline from lib/record-lead's recordLead().
 *
 *  1. Surfaces: the call plate (Terminal.tsx), the /value ledger, the lot
 *     page, the comps modal, the lot card, the home table and the sub-market
 *     hero import lotFace and read no engine number field of their own.
 *  2. Live book (public/data/ray/upcoming.json, the served build): for every
 *     valued live lot, the face's figures ARE the engine's stamp — the call
 *     ratio reconstructs from the printed comps median, the comps median is
 *     one of the pool's own sales, the value is the engine's expected hammer.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync } from 'fs';
import path from 'path';
import { lotFace, fmtFace, medianRowId } from '../lot-face';
import { recordLead, recordScope } from '../record-lead';
import { engineFlagOf, signalMagnitude } from '../comps';
import { enginePoolOf } from '../engine-pool';
import { lotHammerFromAllIn } from '../premiums';
import { lotVerdict } from '../verdict';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const SURFACES = [
  'app/components/Terminal.tsx',          // the call plate
  'app/value/page.tsx',                   // /value ledger rows + plate band
  'app/components/LotPage.tsx',           // the lot page
  'app/components/ComparableModal.tsx',   // the comps modal
  'app/components/LotCard.tsx',           // the lot card
  'app/components/LotBrowser.tsx',        // the home table
  'app/preview/terminal/SubMarketBoard.tsx', // the sub-market hero
];

/** engine number fields a surface must never read for itself */
const RAW = /\b(compMedianUsd|expectedHammerUsd|bandLowUsd|bandHighUsd|maxBidUsd)\b|estMid \* \(1 \+|\(d\.signal as \{ med\?/;

test('every value surface prints lotFace — and reads no engine figure of its own', () => {
  for (const f of SURFACES) {
    const s = src(f);
    assert.match(s, /import \{[^}]*\blotFace\b[^}]*\} from '[./]+\/?(lib\/)?lot-face'/, `${f} must import lotFace`);
    const code = s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const hit = code.match(RAW);
    assert.equal(hit, null, `${f} reads ${hit?.[0]} directly — print lotFace(lot) instead`);
  }
});

test('the modal never labels the comps median "lectr value", nor takes a range from resolved rows on an engine lot', () => {
  const s = src('app/components/ComparableModal.tsx');
  assert.doesNotMatch(s, /\? 'lectr value' : 'Median'/);
  assert.match(s, /engineValue\.range/);
});

test('/analytics and /value lead "The record" from recordLead', () => {
  for (const f of ['app/analytics/page.tsx', 'app/value/page.tsx']) assert.match(src(f), /recordLead\(/, f);
  const bt = { flagged: { n: 9399, medianPerfPct: 32, hammerMedianPct: 5 }, byMarket: { sports: { flagged: { n: 812, medPct: 18 } } } };
  const all = recordLead(bt, recordScope('all'))!;
  assert.equal(all.pct, 5);
  assert.equal(all.basis, 'hammer');
  assert.match(all.sub, /hammer vs estimate · all-in \+32%/);
  const sports = recordLead(bt, recordScope('sports'))!;
  assert.equal(sports.pct, 18);
  assert.equal(sports.basis, 'all-in');
  assert.equal(recordLead({ flagged: { n: 40, medianPerfPct: 10 } }, null), null);
});

test('maker pages print the YoY and the verified index each under its own label', () => {
  const s = src('app/components/entity/EntityPage.tsx');
  assert.doesNotMatch(s, /\{verified \? \(\s*<div>\s*<div className="k">Verified index[\s\S]{0,400}\) : summary\?\.yoy \?/);
  assert.match(s, /Year on year/);
  assert.match(s, /Verified index, \{verified\.horizon\}/);
});

test('the QA3 N1 lot: one value, one comps median, a ratio reconstructable from printed numbers', () => {
  const lot = {
    id: 'rrauction-751-351808807510594', status: 'upcoming', auctionHouse: 'RR Auction', saleDate: '2026-10-15',
    estimateLow: 300, estimateHigh: null, estLowUsd: 300, currentBid: 200, artist: 'music-memorabilia', category: 'object',
    title: 'Coldplay Signed Drumhead',
    signal: { label: 'Below Market', pct: 303, basis: 4, med: 1669, kind: 'form', form: 'unknown', confidence: 'medium' },
    value: {
      poolIds: ['juliens-354-144023', 'rrauction-556-341043405566061', 'rrauction-685-348257006850484', 'rrauction-699-349138306990643'],
      n: 4, compValueUsd: 520, low: 365, high: 1159, compRatio: 4.4507,
      signal: { label: 'below comparable market', strength: 'moderate', beatRatePct: 54 },
      estimateUsd: null, vsBid: null, confidence: 'medium', exact: null,
      compMedianUsd: 1669, flagRatio: 4.031, houseFactor: 1.104,
      expectedHammerUsd: 416, bandLowUsd: 292, bandHighUsd: 927, maxBidUsd: 370,
    },
  } as unknown as AuctionLot;
  const f = lotFace(lot);
  assert.equal(f.call!.text, '4.0×');
  assert.equal(f.comps!.text, '$1.7K');
  assert.equal(f.comps!.sub, 'weighted · 4 sales');
  assert.equal(f.value!.text, '$416');
  assert.equal(f.value!.range, '$292–$927');
  // the ratio from the printed numbers: comps hammer ÷ house-adjusted ask
  assert.ok(Math.abs(f.call!.compsHammer! / f.call!.askAdj! - 4.031) < 0.02);
  assert.match(f.call!.derivation!, /comps hammer ÷ \$331 adj\. ask/);
  // the weighted median names its row
  const rows = [{ id: 'a', priceUsd: 413 }, { id: 'b', priceUsd: 1676 }, { id: 'c', priceUsd: 1669 }];
  assert.equal(medianRowId(rows, f.comps!.med), 'c');
});

function liveBook(): AuctionLot[] | null {
  try {
    return (JSON.parse(src('public/data/ray/upcoming.json')) as { lots: AuctionLot[] }).lots.filter(l => l.status === 'upcoming');
  } catch { return null; }
}
function evidence(): Record<string, { i: string; p: number }[]> | null {
  try { return (JSON.parse(src('public/data/ray/comp-evidence.json')) as { byLot: Record<string, { i: string; p: number }[]> }).byLot; } catch { return null; }
}

test('live book: every valued lot prints the engine stamp, through one function', () => {
  const book = liveBook();
  if (!book) return; // a checkout without the data build
  const ev = evidence();
  let valued = 0, called = 0, medChecked = 0, medExact = 0;
  for (const lot of book) {
    const f = lotFace(lot);
    const v = lot.value as (NonNullable<AuctionLot['value']> & { expectedHammerUsd?: number; houseFactor?: number }) | null | undefined;

    // THE CALL: the build stamp IS the engine's flag, and every surface's
    // token is the face's
    const eng = engineFlagOf(lot);
    assert.deepEqual(lot.signal ?? null, eng, `${lot.id}: stamped signal ≠ engine flag`);
    if (eng) {
      called++;
      assert.equal(f.call!.text, signalMagnitude(eng.label, eng.pct), lot.id);
    } else assert.equal(f.call, null, lot.id);

    // THE COMPS MEDIAN: the stamp's pool and median
    const ep = enginePoolOf(lot.value);
    if (ep) {
      assert.equal(f.comps!.med, ep.med, lot.id);
      assert.deepEqual(f.comps!.ids, ep.ids, lot.id);
      assert.equal(f.comps!.text, fmtFace(ep.med), lot.id);
      // a weighted median is one of the pool's own sales
      const rows = ev?.[lot.id];
      if (rows && ep.ids.every(id => rows.some(r => r.i === id))) {
        medChecked++;
        const pool = rows.filter(r => ep.ids.includes(r.i));
        if (pool.some(r => Math.round(r.p) === Math.round(ep.med))) medExact++;
        // a row re-priced since the engine read it (FX / premium re-crawl)
        // is still the median's row — within 5%, and medianRowId names it
        assert.ok(medianRowId(pool.map(r => ({ id: r.i, priceUsd: r.p })), ep.med) != null,
          `${lot.id}: comps median ${ep.med} is not one of the pool's sales ${pool.map(r => r.p).join(',')}`);
      }
    }

    // THE RATIO is computed from the printed comps median
    if (f.call && f.call.ratio != null && f.call.compsHammer != null && f.call.askAdj) {
      assert.equal(f.call.compsHammer, Math.round(lotHammerFromAllIn(lot, f.comps!.med)), lot.id);
      const r = f.call.compsHammer / f.call.askAdj;
      assert.ok(Math.abs(r / f.call.ratio - 1) < 0.01, `${lot.id}: ${r.toFixed(3)} from printed numbers vs flag ratio ${f.call.ratio}`);
    }

    // THE VALUE: the engine's expected hammer and band, one format
    const ab = (lot.value as { abstain?: string | null } | null | undefined)?.abstain;
    const vd = typeof ab === 'string' && ab.startsWith('card:') ? null : lotVerdict(lot);
    if (vd) {
      valued++;
      assert.equal(f.value!.hammer, vd.expected, lot.id);
      if (v?.expectedHammerUsd) assert.equal(f.value!.hammer, v.expectedHammerUsd, lot.id);
      assert.equal(f.value!.text, fmtFace(vd.expected), lot.id);
      assert.equal(f.value!.range, `${fmtFace(vd.bandLo)}–${fmtFace(vd.bandHi)}`, lot.id);
    } else assert.equal(f.value, null, lot.id);
  }
  assert.ok(valued > 100, `valued ${valued}`);
  assert.ok(called > 10, `called ${called}`);
  assert.ok(medChecked > 50, `median-in-pool checked on ${medChecked}`);
  assert.ok(medExact / medChecked >= 0.95, `median exactly a pool sale on ${medExact} of ${medChecked}`);
});
