/**
 * makers overhaul P2 — the ledger's row model: one row shape for every kind,
 * the kind tag, the n-gated trend, the one search over names AND lots (a
 * lot-only match rescopes the row), the seven orders with thin rows sunk,
 * and the view codec's new keys (body, lots scope, lot order) + legacy links.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, tagOf, searchRow, sortRows, compareRows, needleOf, lotMatches, nameMatches, gradePlusOf, fold, fmtPct, lastQuarterOf, guaranteedMove, type Row } from '../entity/ledger';
import { mattersOf } from '../entity/live';
import { decodeView, viewSearch, VIEW_DEFAULTS, DEFAULT_COLS } from '../entity/view-state';
import type { EntitySummary } from '../entity/model';
import type { EntityBundle } from '../../hooks/useEntities';
import type { AuctionLot } from '../../types';

const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${artist}-${title}`.slice(0, 48), artist, title, status: 'upcoming', saleDate: '2026-10-20', auctionHouse: 'Goldin', ...extra }) as unknown as AuctionLot;

const summary = (id: string, over: Partial<EntitySummary> = {}): EntitySummary => ({
  id, kind: 'player', market: 'sports', label: 'Mickey Mantle', subKind: 'player', discipline: 'Baseball', face: null,
  page: '/player?id=mickey-mantle', sold: 11331, sold12m: 1701, med12m: 978, med12mN: 1257, medScope: 'Sports Cards · Singles',
  record: { p: 1830000, d: '2026-06-20' }, spark: [1, 2, null, 3, 4, 5], sparkN: null,
  yoy: { pct: 22, n: 2400, basis: 'median' }, verified: null, thin: false,
  caps: { compare: true, follow: 'mickey-mantle', dossier: true }, ...over,
});
const bundle = (s: EntitySummary, sparkQ?: string[]): EntityBundle => ({ s, detail: null, sparkQ });
const entry = (lots: AuctionLot[], flags = 0) => ({ lots, flags, score: lots.length ? mattersOf(lots) : -1 });

test('ledger: one row shape — page, compare and follow for every kind', () => {
  const mantle = buildRow('pl:mickey-mantle', bundle(summary('pl:mickey-mantle')), undefined, new Set());
  assert.equal(mantle.kind, 'player');
  assert.equal(mantle.page, '/player?id=mickey-mantle');   // every player has a dossier now
  assert.equal(mantle.canCompare, true);                      // P2: players compare
  assert.equal(mantle.follow, 'mickey-mantle');
  assert.equal(mantle.median, 978);
  assert.equal(mantle.medianN, 1257);
  assert.equal(mantle.live, 0);
  const pika = buildRow('sj:tcg|k:pikachu', bundle(summary('sj:tcg|k:pikachu', { kind: 'subject', market: 'tcg', label: 'Pikachu', subKind: 'pokemon', discipline: 'Vintage (1996–2003)', caps: { compare: true, follow: null, dossier: true } })), undefined, new Set());
  assert.equal(pika.page, '/entity?id=sj%3Atcg%7Ck%3Apikachu');
  assert.equal(pika.canCompare, true);
  assert.equal(pika.tag, 'Pokémon · Vintage');
  // the remainder row is a feed list, not an entity
  const rest = buildRow('~:sports', bundle(summary('~:sports', { kind: 'subject', label: 'Other lots', subKind: null, discipline: 'no player named', spark: null })), entry([lot('graded-cards', 'Lot of 50')]), new Set());
  assert.equal(rest.kind, 'rest');
  assert.equal(rest.page, null);
  assert.ok(rest.feed);
  assert.equal(rest.canCompare, false);
});

test('ledger: the kind tag reads kind · the discipline\'s own word', () => {
  const s = summary('st:sports|s:1956-topps-baseball', { kind: 'set', discipline: 'Sports Cards · Lots & Sets' });
  assert.equal(tagOf('set', s), 'Set · Lots & Sets');
  assert.equal(tagOf('maker', summary('mk:rolex', { kind: 'maker', discipline: 'Watchmaker' })), 'Watchmaker');
  assert.equal(tagOf('player', summary('pl:x', { discipline: null })), 'Player');
  assert.equal(tagOf('subject', summary('sj:culture|f:jaws', { kind: 'subject', subKind: 'film', discipline: 'Film & TV' })), 'Film · Film & TV');
});

test('ledger: a trend needs four printed quarters; gaps stay gaps', () => {
  const thin = buildRow('pl:a', bundle(summary('pl:a', { spark: [null, 3, null, 4, null, 5] })), undefined, new Set());
  assert.equal(thin.spark, null);
  const ok = buildRow('pl:b', bundle(summary('pl:b', { spark: [1, null, 2, 3, 4] })), undefined, new Set());
  assert.deepEqual(ok.spark, [1, null, 2, 3, 4]);
});

test('ledger: the last complete quarter, never the one in progress', () => {
  const q = ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'];
  const r = buildRow('pl:c', bundle(summary('pl:c', { spark: [1, 2, 3, 4] }), q), undefined, new Set());
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.deepEqual(lastQuarterOf(r, now), { q: '2026-Q3', v: 3 });
});

test('search: names and lots, accents folded, every word', () => {
  // a number stays with the word before it
  assert.deepEqual(needleOf('  Mantle  PSA 8 '), ['mantle', 'psa 8']);
  assert.deepEqual(needleOf('apollo 11 flown'), ['apollo 11', 'flown']);
  assert.deepEqual(needleOf('1986 fleer'), ['1986', 'fleer']);
  const m8 = lot('graded-cards', '1958 Topps #150 Mickey Mantle PSA 8');
  const m85 = lot('graded-cards', '1958 Topps #150 Mickey Mantle PSA 8.5');
  const m5 = lot('graded-cards', '1958 Topps #150 Mickey Mantle PSA 5');
  assert.equal(lotMatches(m8, needleOf('mantle psa 8')), true);
  assert.equal(lotMatches(m85, needleOf('mantle psa 8')), false);   // not inside 8.5
  assert.equal(lotMatches(m5, needleOf('mantle psa 8')), false);    // the 8 of 1958 is not a grade
  assert.equal(lotMatches(m5, needleOf('mantle 195')), false);      // a number never matches inside a longer one
  // "psa 7+": that grade and up
  assert.deepEqual(needleOf('mantle psa 7+'), ['mantle', 'psa 7+']);
  assert.equal(lotMatches(m8, needleOf('mantle psa 7+')), true);
  assert.equal(lotMatches(m85, needleOf('mantle psa 7+')), true);
  assert.equal(lotMatches(m5, needleOf('mantle psa 7+')), false);
  assert.equal(lotMatches(lot('graded-cards', '1952 Topps Mickey Mantle PSA 10'), needleOf('mantle psa 7+')), true);
  assert.equal(fold('Jean Prouvé'), 'jean prouve');
  assert.equal(nameMatches({ label: 'Jean Prouvé', tag: 'Modernist metalwork' }, needleOf('prouve')), true);
  const l = lot('graded-cards', '1952 Topps #311 Mickey Mantle PSA 8');
  assert.equal(lotMatches(l, needleOf('mantle 1952')), true);   // any order
  assert.equal(lotMatches(l, needleOf('mantle 1953')), false);
});

test('search: a name match keeps the row whole; a lot-only match rescopes it', () => {
  const a = lot('graded-cards', '1956 Topps #135 Mickey Mantle', { signal: { label: 'Below Market' } });
  const b = lot('graded-cards', '1956 Topps #79 Jackie Robinson');
  const c = lot('graded-cards', '1956 Topps #30 Jackie Robinson');
  const set = buildRow('st:sports|s:1956-topps-baseball',
    bundle(summary('st:sports|s:1956-topps-baseball', { kind: 'set', label: '1956 Topps Baseball', subKind: 'set', discipline: 'Sports Cards · Lots & Sets' })),
    entry([a, b, c], 1), new Set());
  assert.equal(searchRow(set, needleOf('1956 topps')), set);           // the name: whole
  const m = searchRow(set, needleOf('mantle'))!;
  assert.equal(m.live, 1);                                              // only the Mantle lot
  assert.equal(m.flags, 1);
  assert.equal(m.scoped, true);
  assert.equal(searchRow(set, needleOf('wagner')), null);
  // a sold-only row matches by name only
  const sold = buildRow('pl:honus-wagner', bundle(summary('pl:honus-wagner', { label: 'Honus Wagner' })), undefined, new Set());
  assert.equal(searchRow(sold, needleOf('t206')), null);
  assert.equal(searchRow(sold, needleOf('wagner')), sold);
});

test('order: thin rows sink; Movers ranks gated moves by size, either way', () => {
  const mk = (id: string, o: Partial<Row>): Row => ({ ...buildRow(id, bundle(summary(id)), undefined, new Set()), ...o });
  const rows = [
    mk('pl:a', { label: 'A', median: 900, thin: true, yoy: { pct: 300, n: 12, basis: 'median' } }),
    mk('pl:b', { label: 'B', median: 500, yoy: { pct: -40, n: 500, basis: 'median' } }),
    mk('pl:c', { label: 'C', median: 700, yoy: null }),
    mk('pl:d', { label: 'D', median: 600, yoy: { pct: 10, n: 60, basis: 'median' } }),
  ];
  assert.deepEqual(sortRows([...rows], 'median').map(r => r.label), ['C', 'D', 'B', 'A']);
  assert.deepEqual(sortRows([...rows], 'movers').map(r => r.label), ['B', 'D', 'C', 'A']);
  // a gated read on a small sample ranks after the well-supported ones
  const small = mk('pl:e', { label: 'E', yoy: { pct: 4204, n: 16, basis: 'median' } });
  assert.deepEqual(sortRows([...rows, small], 'movers').map(r => r.label), ['B', 'D', 'E', 'C', 'A']);
  // (P3) like-for-like reads lead, well supported on their PAIRS (n counts
  // identities); a thin matched read sorts with the thin gated reads
  const matched = mk('pl:f', { label: 'F', yoy: { pct: 45, n: 40, basis: 'matched' } });
  const fewPairs = mk('pl:g', { label: 'G', yoy: { pct: 90, n: 22, basis: 'matched' } });
  assert.deepEqual(sortRows([...rows, matched, fewPairs, small], 'movers').map(r => r.label), ['F', 'B', 'D', 'E', 'G', 'C', 'A']);
  // (R7) reads with an interval: a clear like-for-like move (interval
  // excludes 0) leads, ranked by the move its interval GUARANTEES — never by
  // the point read — in log terms (−26% guaranteed outranks +30%); then a
  // clear pooled-median move (blind to a change in what sold); then reads
  // bounded around flat
  const noisy = mk('pl:h', { label: 'H', yoy: { pct: 200, n: 6, basis: 'matched', lo: 5, hi: 400 } });
  const solid = mk('pl:i', { label: 'I', yoy: { pct: 40, n: 80, basis: 'matched', lo: 30, hi: 52 } });
  const down = mk('pl:j', { label: 'J', yoy: { pct: -45, n: 50, basis: 'matched', lo: -55, hi: -26 } });
  const flat = mk('pl:k', { label: 'K', yoy: { pct: 18, n: 30, basis: 'median', lo: -4, hi: 45 } });
  const medMove = mk('st:sports|s:x', { label: 'M', yoy: { pct: -77, n: 26, basis: 'median', lo: -82, hi: -68 } });
  assert.deepEqual(sortRows([flat, noisy, medMove, solid, down, mk('pl:c', { label: 'C', yoy: null })], 'movers').map(r => r.label), ['J', 'I', 'H', 'M', 'K', 'C']);
  assert.equal(guaranteedMove(down.yoy), -26);
  assert.equal(guaranteedMove(flat.yoy), 0);
  assert.equal(guaranteedMove(matched.yoy), null);
  assert.deepEqual(sortRows([...rows], 'name').map(r => r.label), ['A', 'B', 'C', 'D']);
  // Matters / Live: thin only breaks a tie
  const t = [mk('pl:x', { label: 'X', live: 5, topScore: 3, thin: true }), mk('pl:y', { label: 'Y', live: 5, topScore: 3, thin: false }), mk('pl:z', { label: 'Z', live: 9, topScore: 9, thin: true })];
  assert.deepEqual(sortRows([...t], 'matters').map(r => r.label), ['Z', 'Y', 'X']);
  assert.deepEqual(sortRows([...t], 'live').map(r => r.label), ['Z', 'Y', 'X']);
  // the remainder row always closes its group
  const rest = { ...mk('~:sports', { label: 'Other lots', live: 99, topScore: 99 }), kind: 'rest' as const };
  assert.equal(sortRows([rest, ...t], 'live').at(-1)!.id, '~:sports');
  assert.equal(typeof compareRows('sold12'), 'function');
});

test('format: the signed percent uses a true minus', () => {
  assert.equal(fmtPct(22.4), '+22%');
  assert.equal(fmtPct(-8.6), '−9%');
});

test('view-state P2: body, lots scope and lot order round-trip; legacy sorts/columns map', () => {
  const v = { ...VIEW_DEFAULTS, vw: 'lots' as const, lk: ['pl:mickey-mantle', 'mk:andy-warhol'], lo: 'soonest' as const, sort: 'movers' as const, cols: ['live', 'yoy'] as typeof DEFAULT_COLS };
  const back = decodeView(new URLSearchParams(viewSearch(v)));
  assert.deepEqual(back, v);
  assert.match(viewSearch(v), /lk=pl%3Amickey-mantle%2Candy-warhol/);
  // the lots scope + order belong to the lots body
  assert.equal(viewSearch({ ...v, vw: 'names' }).includes('lk='), false);
  // pre-P2 links: sort=sold → Sold 12 mo, sort=delta → Movers, cols=velocity → sold12, any order → print order
  assert.equal(decodeView(new URLSearchParams('sort=sold')).sort, 'sold12');
  assert.equal(decodeView(new URLSearchParams('sort=delta')).sort, 'movers');
  assert.deepEqual(decodeView(new URLSearchParams('cols=velocity.curve.median')).cols, ['median', 'sold12', 'curve']);
  assert.equal(decodeView(new URLSearchParams('vw=bogus')).vw, 'names');
});

test('grade search: an exact grade offers its "and up" form, in the reader\'s own words', () => {
  const g = gradePlusOf(needleOf('Mantle PSA 7'))!;
  assert.deepEqual(g.plus, ['mantle', 'psa 7+']);
  assert.equal(g.label, 'PSA 7+');
  assert.equal(g.q('Mantle PSA 7'), 'Mantle PSA 7+');
  assert.equal(g.q('apollo 11 Mantle psa  7'), 'apollo 11 Mantle psa  7+');
  // already widened, a 10, a mission number, a year: nothing to offer
  assert.equal(gradePlusOf(needleOf('Mantle PSA 7+')), null);
  assert.equal(gradePlusOf(needleOf('Charizard PSA 10')), null);
  assert.equal(gradePlusOf(needleOf('Apollo 11')), null);
  assert.equal(gradePlusOf(needleOf('1952 Topps')), null);
  assert.equal(gradePlusOf(needleOf('BGS 9.5'))!.label, 'BGS 9.5+');
});
