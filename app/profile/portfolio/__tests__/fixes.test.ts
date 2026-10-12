/**
 * Portfolio — the Oct 11 2026 /profile review fixes on fixtures (X4):
 * the paid baseline under the marked line, the one engine column with its
 * "as of" clock, one growth label per row, the headline law, the Mantle
 * ghost's entity, and the chart's gutter (the tick labels never sit over
 * the line's end). The clock is pinned.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinClock } from '../../../lib/__tests__/helpers/pin-clock';
import type { AuctionLot } from '../../../types';
import type { EntityDetail } from '../../../lib/entity/model';
import {
  abstainWhy, asOfText, collectionIndex, engineReadOf, followEntityOf, ghostEntityOf, growthOf, headlineOf, levelKindOf, pieceEntityOf, pieceOf, pieceRow, totalsOf, yearOfNow,
  FOLD_N, SETTLED_MONTHS, type EntityRead,
} from '../portfolio';
import { chartGeometry, gutterFor, niceTicks, yearLabelIdx } from '../chart';
import { portfolioCsv, CSV_COLUMNS } from '../csv';

pinClock('2026-10-11T20:00:00Z');
const NOW = Date.now();
const YEAR = yearOfNow(NOW);

function lot(over: Partial<AuctionLot> & { id: string }): AuctionLot {
  return {
    artist: 'andy-warhol', title: 'Cow (F. & S. II.11)', auctionHouse: "Sotheby's", saleName: 'Prints', currency: 'USD',
    saleDate: '2024-06-12', lotNumber: '1', imageUrl: '', url: 'https://example.test/lot/1', category: 'print',
    estimateLow: 10000, estimateHigh: 15000, hammerPrice: 20000, priceUsd: 25400, status: 'sold', bidCount: null, currentBid: null,
    ...over,
  } as unknown as AuctionLot;
}
const yearly = (rows: [number, number | null, number][], partial?: number): EntityDetail['yearly'] =>
  rows.map(([y, med, n]) => (y === partial ? { y, med, n, partial: true as const } : { y, med, n }));
const detail = (y: EntityDetail['yearly']): EntityDetail => ({ yearly: y, houses: [], cats: [], top: [], recent: [] });
const WARHOL = detail(yearly([[2022, 40000, 600], [2023, 41000, 580], [2024, 30000, 590], [2025, 33000, 550], [2026, 27000, 360]], 2026));
const ROLEX = detail(yearly([[2022, 27720, 1328], [2023, 26857, 1263], [2024, 27635, 1275], [2025, 27940, 1011], [2026, 28160, 683]], 2026));

/** a W31 settled stamp: today's value on a hammered row, no call on it */
const SETTLED_VALUE = {
  poolIds: ['x', 'y'], n: 14, compValueUsd: 31000, low: 25000, high: 38000, compRatio: 1.1, signal: null, estimateUsd: 12500, vsBid: null,
  confidence: 'medium' as const, exact: null, expectedHammerUsd: 24800, bandLowUsd: 20000, bandHighUsd: 30400, premiumFactor: 1.25,
};

/* ── 1 · the line: paid baseline under marked (R1#11) ───────────────── */

test('collectionIndex: every axis year carries the PAID step — pieces join at cost, the marked line is read against it', () => {
  const ents = new Map<string, EntityRead | null>([
    ['mk:andy-warhol', { detail: WARHOL, summary: null }],
    ['mk:rolex', { detail: ROLEX, summary: null }],
  ]);
  const a = pieceOf(lot({ id: 'a', saleDate: '2023-12-15' }), { paidUsd: 41000 });            // warhol, joins 2023
  const b = pieceOf(lot({ id: 'b', artist: 'rolex', saleDate: '2024-12-17', priceUsd: 27635 }), null); // rolex, joins 2024
  const r = collectionIndex([a, b], ents, YEAR);
  assert.deepEqual(r.points.map(p => [p.year, p.paid, p.value]), [
    [2023, 41000, 41000],
    [2024, 41000 + 27635, 30000 + 27635],   // the step rises when b joins; marked moves with Warhol's median
    [2025, 41000 + 27635, 33000 + 27940],
    [2026, 41000 + 27635, 27000 + 28160],
  ]);
  // in a gap year the paid step still stands (joining needs a price; marking does not follow)
  const thin = detail(yearly([[2023, 41000, 580], [2024, 30000, 590], [2025, 33000, 3], [2026, 27000, 360]], 2026));
  const g = collectionIndex([a], new Map([['mk:andy-warhol', { detail: thin, summary: null }]]), YEAR);
  assert.deepEqual(g.points.map(p => [p.year, p.paid, p.value]), [[2023, 41000, 41000], [2024, 41000, 30000], [2025, 41000, null], [2026, 41000, 27000]]);
});

test('chart: the plot stops short of a gutter that holds the tick labels; years are all labelled when they fit, every other when not; paid is a true step', () => {
  const ents = new Map<string, EntityRead | null>([['mk:andy-warhol', { detail: WARHOL, summary: null }], ['mk:rolex', { detail: ROLEX, summary: null }]]);
  const a = pieceOf(lot({ id: 'a', saleDate: '2022-06-01' }), { paidUsd: 160000 });
  const b = pieceOf(lot({ id: 'b', artist: 'rolex', saleDate: '2024-12-17', priceUsd: 27635 }), null);
  const idx = collectionIndex([a, b], ents, YEAR);
  const g = chartGeometry(idx.points, 600, 180);
  assert.ok(g.gutter >= 40 && g.gutter <= 80, `gutter ${g.gutter}`);
  assert.equal(g.plotW, 600 - g.gutter);
  // the marked line's end and the paid step's end sit inside the plot, left of every tick label
  assert.ok(g.markedEnd!.x <= g.plotW + 0.01);
  assert.ok(g.paidEnd!.x <= g.plotW + 0.01);
  for (const t of g.ticks) assert.match(t.label, /^\$\d/);
  // five axis years at 600px: all labelled
  assert.deepEqual(g.years.map(y => y.label), ['2022', '2023', '2024', '2025', '2026']);
  assert.equal(g.years[0].anchor, 'start');
  assert.equal(g.years[g.years.length - 1].anchor, 'end');
  // the paid path: H (flat) and V (a piece joins) only — never a diagonal
  assert.match(g.paidPath, /^M[\d.]+,[\d.]+(?:H[\d.]+(?:V[\d.]+)?)+$/);
  assert.equal((g.paidPath.match(/V/g) || []).length, 1, 'one piece joins after the first year → one riser');
  // one marked run, no dots (no gap)
  assert.equal(g.runs.length, 1);
  assert.equal(g.dots.length, 0);
  // narrow: 12 years in 300px → every other year, first and last always
  assert.deepEqual(yearLabelIdx(12, 300), [0, 2, 4, 6, 8, 11]);
  assert.deepEqual(yearLabelIdx(5, 400), [0, 1, 2, 3, 4]);
  assert.deepEqual(niceTicks(0, 100, 3), [0, 25, 50, 75, 100]);
  assert.ok(gutterFor(['$200K']) > gutterFor(['$9K']));
});

test('chart: a gap splits the marked line into runs; a lone marked year is a dot', () => {
  const thin = detail(yearly([[2022, 40000, 600], [2023, 41000, 2], [2024, 30000, 590], [2025, 33000, 3], [2026, 27000, 360]], 2026));
  const a = pieceOf(lot({ id: 'a', saleDate: '2022-06-01' }), { paidUsd: 40000 });
  const idx = collectionIndex([a], new Map([['mk:andy-warhol', { detail: thin, summary: null }]]), YEAR);
  const g = chartGeometry(idx.points, 500, 160);
  assert.equal(g.runs.length, 0);
  assert.deepEqual(g.dots.map(d => d.i), [0, 2, 4]);
  assert.equal(g.markedEnd!.x, g.x(4));
});

/* ── 2 · the one engine column (R1#12 / W31) ────────────────────────── */

test('engineReadOf: a settled row stamped tonight prints the appraisal with its clock — "as of Oct 12"', () => {
  const p = pieceOf(lot({ id: 'a', value: SETTLED_VALUE as AuctionLot['value'], valueAsOf: '2026-10-12' }), { paidUsd: 20000 });
  assert.equal(p.appraisal?.asOf, '2026-10-12');
  const e = engineReadOf(p, YEAR);
  assert.equal(e.kind, 'value');
  if (e.kind !== 'value') return;
  assert.equal(e.asOfText, 'as of Oct 12');
  assert.equal(e.appraisal.allIn, 31000);
  assert.equal(e.appraisal.hammer, 24800);
  assert.equal(e.appraisal.compN, 14);
  // if sold now rides the same column: Sotheby's = estimate tier, 10% off the expected hammer
  assert.deepEqual(e.soldNow, { net: 22320, commission: 2480, rate: 0.10, tier: 'estimate', house: "Sotheby's" });
  // a stamp from another year names it
  assert.equal(asOfText('2025-12-31', YEAR), 'as of Dec 31, 2025');
  assert.equal(asOfText(null, YEAR), null);
  assert.equal(asOfText('garbage', YEAR), null);
});

test('engineReadOf: a live lot with a value is read nightly (no as-of); a row the engine declined says why in its own code; a row never reached says when it fills', () => {
  const live = pieceOf(lot({ id: 'l', status: 'upcoming', priceUsd: null, value: SETTLED_VALUE as AuctionLot['value'] }), null);
  const el = engineReadOf(live, YEAR);
  assert.equal(el.kind, 'value');
  if (el.kind === 'value') assert.equal(el.asOfText, null);

  const declined = pieceOf({ ...lot({ id: 'd' }), abstain: 'noest:gate-accuracy' } as unknown as AuctionLot, null);
  assert.equal(declined.abstain, 'noest:gate-accuracy');
  const ed = engineReadOf(declined, YEAR);
  assert.equal(ed.kind, 'abstain');
  if (ed.kind === 'abstain') { assert.equal(ed.code, 'noest:gate-accuracy'); assert.equal(ed.why, 'its market cell is below the engine’s publish bar'); }
  assert.equal(abstainWhy('pool<3'), 'too few comparable sales to read it');
  assert.equal(abstainWhy('card:player-tier'), 'only a player-level median exists — no read on this card');
  assert.equal(abstainWhy('stale'), 'every comparable sale is too old');
  assert.match(abstainWhy('something-new'), /declined \(something-new\)/);

  const none = pieceOf(lot({ id: 'n' }), null);
  const en = engineReadOf(none, YEAR);
  assert.equal(en.kind, 'none');
  if (en.kind === 'none') { assert.equal(en.live, false); assert.match(en.why, new RegExp(`within ${SETTLED_MONTHS} months`)); }
  const liveNone = pieceOf(lot({ id: 'ln', status: 'upcoming', priceUsd: null }), null);
  const eln = engineReadOf(liveNone, YEAR);
  if (eln.kind === 'none') { assert.equal(eln.live, true); assert.match(eln.why, /on the block/); }
  // a stamp that carries an abstain AND a value is a value (the partial abstention rides the value, not the row)
  const both = pieceOf({ ...lot({ id: 'b', value: SETTLED_VALUE as AuctionLot['value'], valueAsOf: '2026-10-12' }), abstain: 'card:player-tier' } as unknown as AuctionLot, null);
  assert.equal(both.abstain, null);
});

test('totalsOf + headlineOf: the engine column counts N of M and the newest as-of; its delta compares only the appraised pieces that also have a cost', () => {
  const a = pieceOf(lot({ id: 'a', value: SETTLED_VALUE as AuctionLot['value'], valueAsOf: '2026-10-12' }), { paidUsd: 20000 });   // appraised 31,000 vs 20,000 paid
  const b = pieceOf(lot({ id: 'b', value: SETTLED_VALUE as AuctionLot['value'], valueAsOf: '2026-10-11', priceUsd: null, saleDate: '' }), null); // appraised, no cost
  const c = pieceOf(lot({ id: 'c' }), null);  // bought at realized 25,400, no stamp
  const t = totalsOf([a, b, c]);
  assert.equal(t.appraisedN, 2);
  assert.equal(t.appraised, 62000);
  assert.equal(t.appraisedPaidN, 1);
  assert.equal(t.appraisedPaid, 31000);
  assert.equal(t.appraisedPaidBought, 20000);
  assert.equal(t.asOf, '2026-10-12');
  assert.equal(t.soldNowN, 2);
  const idx = collectionIndex([a, b, c], new Map(), YEAR);
  const h = headlineOf(t, idx, YEAR, false);
  assert.equal(h.engine.k, 'Engine read · 2 of 3');
  assert.equal(h.engine.v, '$62K');
  assert.equal(h.engine.sub, 'as of Oct 12 · $45K if sold now');
  assert.equal(h.engine.delta, '+55% vs paid on that piece');
  assert.equal(h.engine.deltaPct, 55);
  // nothing appraised: the column says when it fills, never a cost dressed as a value
  const h0 = headlineOf(totalsOf([c]), collectionIndex([c], new Map(), YEAR), YEAR, false);
  assert.equal(h0.engine.v, null);
  assert.match(h0.engine.empty, /fills when the nightly reads your pieces/);
  assert.equal(h0.bought?.k, 'Bought · at the realized price');
});

test('headlineOf: "+30%" says what it is against — the paid sum of the indexed pieces, with their count (R4#9)', () => {
  const ents = new Map<string, EntityRead | null>([['mk:andy-warhol', { detail: WARHOL, summary: null }]]);
  const a = pieceOf(lot({ id: 'a', saleDate: '2024-06-12' }), { paidUsd: 30000 });   // marked 2026: 27,000
  const b = pieceOf(lot({ id: 'b', saleDate: '2023-03-01' }), { paidUsd: 50000 });   // marked 2026: 50,000 × 27/41 ≈ 32,927
  const c = pieceOf(lot({ id: 'c', priceUsd: null, saleDate: '' }), null);          // no index, no cost
  const idx = collectionIndex([a, b, c], ents, YEAR);
  const h = headlineOf(totalsOf([a, b, c]), idx, YEAR, false);
  assert.equal(h.marked.k, 'Marked now · 2 of 3 indexed');
  assert.equal(h.marked.v, '$60K');
  assert.equal(h.marked.deltaPct, -25);
  assert.equal(h.marked.delta, '−25% vs $80K paid for these 2');
  // one indexed piece: "this piece"
  const h1 = headlineOf(totalsOf([a]), collectionIndex([a], ents, YEAR), YEAR, false);
  assert.equal(h1.marked.delta, '−10% vs $30K paid for this piece');
  // nothing marked yet: the empty line names the state
  const hp = headlineOf(totalsOf([a]), collectionIndex([a], new Map(), YEAR), YEAR, true);
  assert.equal(hp.marked.v, null);
  assert.equal(hp.marked.empty, 'reading the makers’ record…');
});

/* ── 3 · one growth label per row ───────────────────────────────────── */

test('growthOf: a marked row carries ONE growth figure — the mark vs paid; the maker YoY moves to its title; a row with no mark falls back to the YoY', () => {
  const ent: EntityRead = { detail: WARHOL, summary: { id: 'mk:andy-warhol', kind: 'maker', market: 'art', label: 'Andy Warhol', discipline: null, face: null, page: null, sold: 100, sold12m: 41, med12m: 26000, med12mN: 360, medScope: null, record: null, spark: null, sparkN: null, yoy: { pct: -8, n: 300, basis: 'matched', lo: -12, hi: -4 }, verified: null, thin: false, caps: { compare: true, follow: null, dossier: true } } };
  const a = pieceOf(lot({ id: 'a', saleDate: '2024-06-12' }), { paidUsd: 30000 });
  const row = pieceRow(a, ent, YEAR);
  const g = growthOf(row)!;
  assert.equal(g.source, 'mark');
  assert.equal(g.text, '−10%');
  assert.equal(g.basis, 'vs $30K paid');
  assert.equal(g.dir, 'down');
  assert.match(g.title, /Maker YoY −8% · same items, both years · 300 matched/);
  assert.match(g.title, /not an appraisal of this piece/);
  // the trend read itself still exists for the CSV
  assert.equal(row.trend?.text, '−8%');
  // no mark (bought year under five sales) → the YoY is the row's one growth label
  const late = detail(yearly([[2025, 33000, 550], [2026, 27000, 360]], 2026));
  const row2 = pieceRow(a, { detail: late, summary: ent.summary }, YEAR);
  const g2 = growthOf(row2)!;
  assert.equal(g2.source, 'yoy');
  assert.equal(g2.text, '−8%');
  assert.equal(g2.basis, 'maker YoY · same items, both years · 300 matched');
  // neither
  assert.equal(growthOf(pieceRow(a, null, YEAR)), null);
});

test('levelKindOf: a maker’s medians are the maker’s; a player’s or a subject’s are a mix (the row says mix-driven)', () => {
  assert.equal(levelKindOf('mk:andy-warhol'), 'maker');
  assert.equal(levelKindOf('pl:mickey-mantle'), 'mix');
  assert.equal(levelKindOf('sj:tcg|k:charizard'), 'mix');
  assert.equal(levelKindOf('cs:sports-cards:singles'), null);
  assert.equal(levelKindOf(null), null);
  // the mark's title on a mix-driven row says so
  const mantle = detail(yearly([[2024, 1500, 900], [2025, 2600, 800], [2026, 3900, 500]], 2026));
  const p = pieceOf({ ...lot({ id: 'm', artist: 'sports-memorabilia', title: '1953 Stahl-Meyer Mickey Mantle - PSA GOOD+ 2.5', auctionHouse: 'Goldin', saleDate: '2024-10-26', priceUsd: 15860 }), ek: null, playerSlug: 'mickey-mantle', playerName: 'Mickey Mantle' } as unknown as AuctionLot, { paidUsd: 16000 });
  const g = growthOf(pieceRow(p, { detail: mantle, summary: null }, YEAR))!;
  assert.equal(g.text, '+160%');
  assert.match(g.title, /a mix of whatever sold under the name that year/);
});

/* ── 5 · the Mantle ghost (R1#16) ───────────────────────────────────── */

test('pieceEntityOf: an archive row served with ek null but the pipeline’s playerSlug files under the player; a stamped maker key wins; a title-only ghost stays unnamed', () => {
  const mantle = { ...lot({ id: 'm', artist: 'sports-memorabilia', title: '1953 Stahl-Meyer Mickey Mantle - PSA GOOD+ 2.5', auctionHouse: 'Goldin' }), ek: null, playerSlug: 'mickey-mantle', playerName: 'Mickey Mantle' } as unknown as AuctionLot;
  // ek null = "not stamped": the same key reader the build uses runs on the full row and reads the pipeline's athlete stamp itself
  assert.deepEqual(pieceEntityOf(mantle), { id: 'pl:mickey-mantle', derived: false });
  assert.equal(pieceOf(mantle, null).entityId, 'pl:mickey-mantle');
  // a stamped collection key with the athlete fields beside it: the fallback derives the player
  const stampedCs = { ...mantle, ek: 'cs:sports-memorabilia:memorabilia' } as unknown as AuctionLot;
  assert.deepEqual(pieceEntityOf(stampedCs), { id: 'pl:mickey-mantle', derived: true });
  assert.equal(pieceOf(stampedCs, null).entityDerived, true);
  // playerName alone, through the athlete test
  const byName = { ...lot({ id: 'n', artist: 'sports-cards', title: '1952 Topps Mickey Mantle' }), ek: 'cs:sports-cards:singles', playerName: 'Mickey Mantle' } as unknown as AuctionLot;
  assert.deepEqual(pieceEntityOf(byName), { id: 'pl:mickey-mantle', derived: true });
  // a stamped maker key is read as stamped
  assert.deepEqual(pieceEntityOf({ ...lot({ id: 'w' }), ek: 'mk:andy-warhol' } as unknown as AuctionLot), { id: 'mk:andy-warhol', derived: false });
  // no stamp at all: the same key function the build uses
  assert.deepEqual(pieceEntityOf(lot({ id: 'w2' })), { id: 'mk:andy-warhol', derived: false });
  // a title-only sports ghost (the archive orphan) is never guessed off its title
  const ghost = { id: 'g', title: '1953 Stahl-Meyer Mickey Mantle - PSA GOOD+ 2.5', artist: 'sports-cards', auctionHouse: 'archive', status: 'sold' } as unknown as AuctionLot;
  const e = pieceEntityOf(ghost);
  assert.equal(e.derived, false);
  assert.ok(e.id == null || e.id.startsWith('cs:'));
  assert.equal(ghostEntityOf({ artist: 'andy-warhol', title: 'Mickey Mantle', playerSlug: 'mickey-mantle', playerName: null }), null, 'an art lot never files under a player');
});

test('followEntityOf: the archive ghost files under a name the READER follows when the title spells it whole; a house or a category follow never names a piece', () => {
  const follows = [
    { kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' },
    { kind: 'entity', key: 'sj:tcg|k:charizard', label: 'Charizard' },
    { kind: 'cat', key: 'watches', label: 'Watches' },
    { kind: 'house', key: 'Goldin', label: 'Goldin' },
    { kind: 'maker', key: 'mickey-mantle', label: 'Mickey Mantle' },
    { kind: 'entity', key: 'pl:mickey-mantle', label: 'Mickey Mantle' },
  ];
  const ghost = { id: 'g', title: '1953 Stahl-Meyer Mickey Mantle - PSA GOOD+ 2.5', artist: 'sports-cards', auctionHouse: 'archive', status: 'sold' } as unknown as AuctionLot;
  assert.equal(followEntityOf(ghost, follows), 'pl:mickey-mantle');
  assert.deepEqual(pieceEntityOf(ghost, follows), { id: 'pl:mickey-mantle', derived: true });
  assert.equal(pieceOf(ghost, { paidUsd: 16000 }, [15860, '2024-10-26'], follows).entityId, 'pl:mickey-mantle');
  // the Alpha Playtest Charizard the key reader files as a collection: the followed Pokémon
  const alpha = { id: 'a', title: '1996 Pokemon Japanese Alpha Playtest Mounted on Card Charizard', artist: 'pokemon', auctionHouse: 'archive' } as unknown as AuctionLot;
  assert.equal(followEntityOf(alpha, follows), 'sj:tcg|k:charizard');
  // a maker follow on an art lot keys mk:; a word that is only part of a longer word does not match
  assert.equal(followEntityOf({ artist: 'andy-warhol', title: 'Andy Warhol, Cow' }, follows), 'mk:andy-warhol');
  assert.equal(followEntityOf({ artist: 'watches', title: 'Rolex Watchesman' }, follows), null);
  // a category or a house follow is never a name; no follows = nothing
  assert.equal(followEntityOf({ artist: 'rolex', title: 'Watches lot at Goldin' }, follows), null);
  assert.equal(followEntityOf(ghost, []), null);
  assert.equal(followEntityOf(ghost, null), null);
});

/* ── the fold, the CSV columns ──────────────────────────────────────── */

test('FOLD_N and the CSV carry the new engine columns (as of + the engine note)', () => {
  assert.equal(FOLD_N, 4);
  assert.ok(CSV_COLUMNS.includes('appraisal_as_of'));
  assert.ok(CSV_COLUMNS.includes('engine_note'));
  const a = pieceOf(lot({ id: 'a', value: SETTLED_VALUE as AuctionLot['value'], valueAsOf: '2026-10-12' }), { paidUsd: 20000 });
  const d = pieceOf({ ...lot({ id: 'd' }), abstain: 'pool<3' } as unknown as AuctionLot, null);
  const csv = portfolioCsv([pieceRow(a, null, YEAR), pieceRow(d, null, YEAR)]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0].split(',').length, CSV_COLUMNS.length);
  assert.match(lines[1], /,31000,24800,14,medium,2026-10-12,,22320,0.1,estimate,/);
  assert.match(lines[2], /,engine declined: too few comparable sales to read it \(pool<3\),/);
});
