/**
 * (Oct 9) catalogue-neighbour culture domains: a culture lot no rule and no
 * learned name could domain takes the domain of its sale's numbered section.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbourDomains, lotNumberOf, domainFamily, NEIGHBOUR_GATE, type NeighbourEntry } from '../lib/neighbour-domain';
import { stampSubCats } from '../lib/corpus-normalize';
import { taxonOf } from '../../app/lib/taxonomy';

type L = Record<string, unknown>;
const SALE = { auctionHouse: 'RR Auction', saleName: 'Fine Autographs and Artifacts', saleDate: '2024-05-16' };
const lot = (id: string, n: number | string | null, title: string, o: L = {}): L =>
  ({ id, artist: 'entertainment-memorabilia', title, lotNumber: n, ...SALE, ...o });
/** a run of lots the RULES domain political (each a different governor) */
const political = (from: number, count: number, o: L = {}): L[] =>
  Array.from({ length: count }, (_, i) => lot(`pol${from + i}`, from + i, `Signed Document as Governor of State ${from + i}`, o));
const music = (from: number, count: number): L[] =>
  Array.from({ length: count }, (_, i) => lot(`mus${from + i}`, from + i, `Concert Ticket Stub ${from + i}`));
const drillOf = (lots: L[], id: string) => (lots.find(l => l.id === id) as { drill?: string }).drill;

test('lotNumberOf · numbers, numeric strings, suffixed lots; nothing else', () => {
  assert.equal(lotNumberOf(12), 12);
  assert.equal(lotNumberOf('12'), 12);
  assert.equal(lotNumberOf('12A'), 12);
  assert.equal(lotNumberOf(' 7 '), 7);
  assert.equal(lotNumberOf('12.5'), null);
  assert.equal(lotNumberOf(null), null);
  assert.equal(lotNumberOf('A12'), null);
  assert.equal(lotNumberOf(Number.NaN), null);
  assert.equal(domainFamily('apollo'), 'space-science');
  assert.equal(domainFamily('music'), 'music');
});

test('stampSubCats · a bare lot inside a political run takes the run’s domain', () => {
  const lots: L[] = [...political(100, 4), lot('bare', 104, 'Bobby Lennox Signature'), ...political(105, 4)];
  const r = stampSubCats(lots as never);
  assert.equal(drillOf(lots, 'pol100'), 'political');
  assert.equal(drillOf(lots, 'bare'), 'political');
  assert.equal(r.neighbourDomains, 1);
  assert.equal(taxonOf(lots.find(l => l.id === 'bare') as never).cat, 'historical');
});

test('stampSubCats · below the evidence gate (too few voters, too far, another sale) → no domain', () => {
  // three domained neighbours inside ±8 (the gate wants 4)
  const few: L[] = [...political(200, 2), lot('few', 202, 'Bobby Lennox Signature'), ...political(203, 1), ...political(220, 6)];
  // the voters sit beyond ±8
  const far: L[] = [...political(300, 5), lot('far', 314, 'Bobby Lennox Signature'), ...political(323, 5)];
  // the voters belong to another sale (same lot numbers)
  const other: L[] = [...political(400, 5, { saleName: 'Remarkable Rarities' }), lot('other', 405, 'Bobby Lennox Signature')];
  // no lot number at all
  const nonum: L[] = [...political(500, 5), lot('nonum', null, 'Bobby Lennox Signature')];
  for (const lots of [few, far, other, nonum]) stampSubCats(lots as never);
  assert.equal(drillOf(few, 'few'), undefined);
  assert.equal(drillOf(far, 'far'), undefined);
  assert.equal(drillOf(other, 'other'), undefined);
  assert.equal(drillOf(nonum, 'nonum'), undefined);
});

test('stampSubCats · a section boundary (mixed neighbours under the purity gate) → no domain', () => {
  // 4 political + 3 music within ±8: top share 57% < 90%
  const lots: L[] = [...political(600, 4), lot('edge', 604, 'Bobby Lennox Signature'), ...music(605, 3)];
  const r = stampSubCats(lots as never);
  assert.equal(drillOf(lots, 'edge'), undefined);
  assert.equal(r.neighbourDomains, 0);
  // 9 political + 1 music (90%) clears it
  const lots2: L[] = [...political(700, 5), lot('edge2', 705, 'Bobby Lennox Signature'), ...political(706, 4), ...music(707 + 4, 1)];
  stampSubCats(lots2 as never);
  assert.equal(drillOf(lots2, 'edge2'), 'political');
});

test('stampSubCats · never overwrites a domain, never re-files film / music artist lots or non-culture lots', () => {
  const lots: L[] = [
    ...political(800, 4),
    // a rule-domained music lot inside the political run keeps its own domain
    lot('ruled', 804, 'Concert Ticket Stub'),
    // a film-artist lot already carries its domain in the taxonomy
    lot('film', 805, 'Bobby Lennox Signature', { artist: 'movie-tv' }),
    // a non-culture lot is never touched
    lot('art', 806, 'Bobby Lennox Signature', { artist: 'andy-warhol' }),
    ...political(807, 4),
  ];
  stampSubCats(lots as never);
  assert.equal(drillOf(lots, 'ruled'), 'music');
  assert.equal(drillOf(lots, 'film'), undefined);
  assert.equal(drillOf(lots, 'art'), undefined);
});

test('stampSubCats · idempotent: neighbour-learned stamps never vote, so a re-run converges', () => {
  // the run's two bare lots fill; a bare lot whose window reaches only the
  // FILLED lots (plus too few rule-domained ones) must stay undomained on every run
  const lots: L[] = [
    ...political(900, 4),
    lot('b1', 904, 'Bobby Lennox Signature'),
    lot('b2', 905, 'Jimmy Johnstone Signature'),
    ...political(906, 1),
    lot('b3', 913, 'Tommy Gemmell Signature'),
  ];
  const r1 = stampSubCats(lots as never);
  const snap1 = lots.map(l => (l as { drill?: string }).drill);
  const r2 = stampSubCats(lots as never);
  const snap2 = lots.map(l => (l as { drill?: string }).drill);
  assert.deepEqual(snap2, snap1);
  assert.equal(r1.neighbourDomains, r2.neighbourDomains);
  assert.equal(drillOf(lots, 'b1'), 'political');
  assert.equal(drillOf(lots, 'b2'), 'political');
  assert.equal(drillOf(lots, 'b3'), undefined);
});

test('neighbourDomains · space programs vote as one family; a sports run routes to sports memorabilia', () => {
  const e = (lotN: number, vote: string | null, target = false): NeighbourEntry => ({ sale: 's', lot: lotN, vote, target });
  const space = [e(1, 'apollo'), e(2, 'mercury-gemini'), e(3, 'apollo'), e(4, 'shuttle-iss'), e(5, null, true)];
  assert.equal(neighbourDomains(space).get(4), 'space-science');
  // the stamp re-reads the lot's own text for the program
  const lots: L[] = [
    ...[1, 2, 3, 4].map(i => lot(`sp${i}`, i, `Apollo ${10 + i} Flown Crew Signed Cover`)),
    lot('gem', 5, 'Bobby Lennox Gemini Signature'),
    lot('bare', 6, 'Bobby Lennox Signature'),
    // the sports section (the curated subjects domain its lots 'sports')
    ...[21, 22, 23, 24].map(i => lot(`spo${i}`, i, `Ty Cobb Signed Check ${i}`, { subjectKeys: ['ty cobb'] })),
    lot('sport', 25, 'Bobby Lennox Signature'),
  ];
  stampSubCats(lots as never);
  assert.equal(drillOf(lots, 'sp1'), 'apollo');
  assert.equal(drillOf(lots, 'gem'), 'mercury-gemini');
  assert.equal(drillOf(lots, 'bare'), 'space-science');
  assert.equal(taxonOf(lots.find(l => l.id === 'bare') as never).cat, 'space-science');
  assert.equal(drillOf(lots, 'spo21'), 'sports');
  assert.equal(drillOf(lots, 'sport'), 'sports');
  assert.equal(taxonOf(lots.find(l => l.id === 'sport') as never).cat, 'sports-memorabilia');
});

test('NEIGHBOUR_GATE · the measured gate', () => {
  assert.deepEqual(NEIGHBOUR_GATE, { k: 8, minN: 4, purity: 0.9 });
});
