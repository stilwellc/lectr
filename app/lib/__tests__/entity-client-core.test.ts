/**
 * makers overhaul P1 — client core: the one flag predicate, the id helpers,
 * the KIND registry's row policy, the live join, the fail-soft summary
 * adapters and the /makers URL codec.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isFlagged, isAppraised, countFlagged } from '../flags';
import { makerId, kindOfId, makerSlugOf, subPartsOf, subjectPartsOf } from '../entity/model';
import { rowPolicy, rowKindOf, restId, followKeyOf, pageHrefOf, KIND, DISCIPLINE } from '../entity/kinds';
import { entityIdOf, groupByMaker, groupByName, groupByCat, stabilize, nameBucketOf, mattersOf } from '../entity/live';
import { makerBundle, subBundle, nameBundle, completeQuarters, currentQuarter } from '../../hooks/useEntities';
import {
  decodeView, encodeView, viewSearch, patchView, idFromParam, idToParam, VIEW_DEFAULTS, DEFAULT_COLS, COMPARE_MAX,
} from '../entity/view-state';
import { TRIAGE_DEFAULTS } from '../feed-filters';
import { MAKER_DISCIPLINE } from '../../constants';
import type { AuctionLot, MarketStats } from '../../types';

const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${artist}-${title}`.slice(0, 48), artist, title, status: 'upcoming', saleDate: '2026-10-20', auctionHouse: 'Goldin', ...extra }) as unknown as AuctionLot;

/* ── flags ── */

test('flags: one predicate — the crawl-time comp signal, else the value engine read', () => {
  assert.equal(isFlagged({ signal: { label: 'Below Market' } }), true);
  assert.equal(isFlagged({ signal: { label: 'Above Market' } }), false);
  // a lot that carries `signal` (null included) is decided by it alone
  assert.equal(isFlagged({ signal: null, value: { signal: { label: 'below comparable market' } } }), false);
  assert.equal(isFlagged({ value: { signal: { label: 'below comparable market' } } }), true);
  assert.equal(isFlagged({ value: { signal: null } }), false);
  assert.equal(isFlagged({}), false);
  assert.equal(countFlagged([{ signal: { label: 'Below Market' } }, {}, { value: { signal: { label: 'below comparable market' } } }]), 2);
  // an abstention (value read, signal null) is not appraised
  assert.equal(isAppraised({ value: { signal: null } }), false);
  assert.equal(isAppraised({ value: { signal: { label: 'at market' } } }), true);
});

test('flags: the three old surfaces agree with isFlagged on the served live book', () => {
  const f = path.join(process.cwd(), 'public/data/ray/upcoming.json');
  if (!fs.existsSync(f)) return; // a data-less checkout
  const lots = (JSON.parse(fs.readFileSync(f, 'utf8')).lots || []) as { signal?: { label?: string } | null; value?: { signal?: { label?: string } | null } }[];
  let rows = 0, page = 0, browser = 0, one = 0;
  for (const l of lots) {
    if (l.signal?.label === 'Below Market') rows++;                         // /makers rows (old)
    if (l.value?.signal?.label === 'below comparable market') page++;       // maker page (old)
    if (l.signal !== undefined && l.signal?.label === 'Below Market') browser++; // LotBrowser lotSignal on a stamped lot
    if (isFlagged(l)) one++;
  }
  assert.equal(one, rows);
  assert.equal(one, page);
  assert.equal(one, browser);
});

/* ── model ids ── */

test('model: id helpers', () => {
  assert.equal(makerId('rolex'), 'mk:rolex');
  assert.equal(kindOfId('pl:mickey-mantle'), 'player');
  assert.equal(kindOfId('st:sports|s:1986-fleer-basketball'), 'set');
  assert.equal(kindOfId('nope'), null);
  assert.equal(makerSlugOf('mk:kaws'), 'kaws');
  assert.equal(makerSlugOf('pl:kaws'), null);
  assert.deepEqual(subPartsOf('cs:sports-cards:singles'), { cat: 'sports-cards', sub: 'singles' });
  assert.deepEqual(subjectPartsOf('sj:tcg|k:charizard'), { market: 'tcg', key: 'k:charizard' });
});

/* ── kinds ── */

test('kinds: one discipline copy shared with the build', () => {
  assert.equal(DISCIPLINE, MAKER_DISCIPLINE);
  assert.equal(DISCIPLINE.rolex, 'Watchmaker');
});

test('kinds: the phase-1 row policy reproduces the old per-kind rules', () => {
  const mk = rowPolicy('mk:andy-warhol');
  assert.deepEqual([mk.page, mk.lands, mk.compare, mk.inline, mk.follow], ['/makers/andy-warhol', false, true, false, 'andy-warhol']);
  const sub = rowPolicy('cs:sports-cards:singles');
  assert.equal(sub.page, '/?cat=sports-cards&sub=singles&tab=all');
  assert.deepEqual([sub.lands, sub.compare, sub.inline, sub.follow], [true, true, false, 'cs:sports-cards:singles']);
  // an athlete with a dossier: the dossier, a follow; without: the scoped feed, no follow
  const pl = rowPolicy('pl:mickey-mantle', { playerDossier: true });
  assert.deepEqual([pl.page, pl.dossierHref, pl.follow, pl.compare, pl.inline], ['/player?id=mickey-mantle', '/player?id=mickey-mantle', 'mickey-mantle', false, true]);
  const pl2 = rowPolicy('pl:nobody-known');
  assert.deepEqual([pl2.page, pl2.dossierHref, pl2.follow], ['/sports?subj=p%3Anobody-known&tab=all', null, null]);
  const sj = rowPolicy('sj:tcg|k:charizard');
  assert.deepEqual([sj.page, sj.follow, sj.compare], ['/tcg?subj=k%3Acharizard&tab=all', null, false]);
  const rest = rowPolicy(restId('sports'));
  assert.equal(rowKindOf(restId('sports')), 'rest');
  assert.equal(rest.page, '/sports?subj=%7E&tab=all');
  assert.equal(KIND.rest.compare, false);
  assert.equal(followKeyOf('st:sports|s:x'), null);
  assert.equal(pageHrefOf('st:sports|s:1986-fleer-basketball'), '/sports?subj=s%3A1986-fleer-basketball&tab=all');
});

/* ── live join ── */

test('live: the build stamp wins; an unstamped lot keys through entityKeyOf', () => {
  assert.equal(entityIdOf(lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8', { ek: 'pl:stamped' })), 'pl:stamped');
  assert.equal(entityIdOf(lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8')), 'pl:mickey-mantle');
  assert.equal(entityIdOf(lot('andy-warhol', 'Marilyn')), 'mk:andy-warhol');
  // an explicit null stamp (the attribution guard) is no entity
  assert.equal(entityIdOf(lot('andy-warhol', 'Marilyn', { ek: null })), null);
});

test('live: makers, names and categories bucket the same pool; the unnamed fold into the remainder row', () => {
  const pool = [
    lot('andy-warhol', 'Marilyn', { signal: { label: 'Below Market' } }),
    lot('andy-warhol', 'Flowers'),
    lot('andy-warhol', 'After Warhol', { ek: null }),
    lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8'),
    lot('game-used', 'Mickey Mantle Game-Used Louisville Slugger Bat'),
    lot('graded-cards', 'Lot of 50 assorted commons', { ek: 'cs:sports-cards:lots' }),
  ];
  const mk = groupByMaker(pool);
  assert.equal(mk.get('mk:andy-warhol')?.lots.length, 2);       // the guarded lot is on no row
  assert.equal(mk.get('mk:andy-warhol')?.flags, 1);
  assert.equal(mk.has('mk:graded-cards'), false);                // collection lots never key to a maker
  const nm = groupByName(pool);
  assert.equal(nm.get('pl:mickey-mantle')?.lots.length, 2);
  assert.equal(nm.get('pl:mickey-mantle')?.name, 'Mickey Mantle');
  assert.equal(nm.get(restId('sports'))?.lots.length, 1);
  assert.equal(nameBucketOf('cs:sports-cards:lots', pool[5]), restId('sports'));
  const cat = groupByCat(pool);
  let n = 0; cat.forEach(e => { n += e.lots.length; });
  assert.equal(n, pool.length);                                  // By category: every lot, named or not
  assert.ok(mattersOf([]) === 0);
});

test('live: stabilize keeps an unchanged bucket\'s object (row memo identity)', () => {
  const a = lot('kaws', 'Companion'), b = lot('kaws', 'Chum'), c = lot('rolex', 'Daytona');
  const prev = groupByMaker([a, b, c]);
  const next = stabilize(prev, groupByMaker([a, b]));
  assert.equal(next.get('mk:kaws'), prev.get('mk:kaws'));
  assert.equal(next.has('mk:rolex'), false);
  const next2 = stabilize(prev, groupByMaker([a, c]));
  assert.notEqual(next2.get('mk:kaws'), prev.get('mk:kaws'));
  assert.equal(next2.get('mk:rolex'), prev.get('mk:rolex'));
});

/* ── fail-soft adapters ── */

const NOW = Date.parse('2026-10-09T16:00:00-04:00');

test('adapters: the quarter in progress is never a print', () => {
  assert.equal(currentQuarter(NOW), '2026-Q4');
  assert.deepEqual(completeQuarters([{ date: '2026-Q3' }, { date: '2026-Q4' }], NOW).map(p => p.date), ['2026-Q3']);
});

test('adapters: a maker from stats.json prints what the ledger printed', () => {
  const q = (date: string, med: number, n: number) => ({ date, medianPrice: med, avgPrice: med, totalSales: n, highPrice: med * 2 });
  const st = {
    totalSoldTracked: 40, medianPriceLast12Months: 5000, totalAuctionRevenue: 900000,
    recordPrice: 250000, recordTitle: 'Big one', recordDate: '2026-03-01', recordHouse: "Christie's",
    priceHistory: [q('2025-Q3', 1000, 3), q('2025-Q4', 1100, 4), q('2026-Q1', 1200, 5), q('2026-Q2', 1300, 6), q('2026-Q3', 1400, 7), q('2026-Q4', 99, 1)],
    houseDistribution: [{ house: "Christie's", count: 30, totalValue: 1 }],
  } as unknown as MarketStats;
  const { s, detail } = makerBundle('kaws', 'art', st, null, 'https://img/x.jpg', NOW);
  assert.equal(s.id, 'mk:kaws');
  assert.equal(s.discipline, 'Street & pop');
  assert.deepEqual(s.spark, [1000, 1100, 1200, 1300, 1400]);          // the partial Q4 dropped
  assert.equal(s.sold12m, 3 + 4 + 5 + 6 + 7 - 3);                       // last 4 complete quarters…
  assert.equal(s.sold12mSince, '2025');                                  // …printed with their span
  assert.equal(s.thin, true);                                            // the ledger's tag rule (n < 50)
  assert.deepEqual(s.record, { p: 250000, d: '2026-03-01', t: 'Big one', h: "Christie's" });
  assert.equal(s.revenue, 900000);
  assert.equal(detail?.quarters.length, 6);
  assert.deepEqual(detail?.houses, [{ h: "Christie's", n: 30 }]);
  // no stats: no detail, dashes
  const empty = makerBundle('kaws', 'art', null, null, null, NOW);
  assert.equal(empty.detail, null);
  assert.equal(empty.s.sold, null);
});

test('adapters: a sub row from cat-stats; an athlete from players.json', () => {
  const { s } = subBundle('sports-cards', 'singles', 'Cards · Singles', 'sports',
    { sold: 100, sold12m: 30, median12m: 250, revenue: 5000, record: { price: 9000, title: 'Rookie', date: '2026-01-02', house: 'Goldin' },
      q: [['2025-Q4', 200, 10], ['2026-Q1', 210, 10], ['2026-Q2', 220, 10], ['2026-Q3', 230, 10], ['2026-Q4', 1, 1]] }, null, NOW);
  assert.deepEqual([s.id, s.kind, s.sold, s.med12m, s.discipline], ['cs:sports-cards:singles', 'sub', 100, 250, 'Sports Cards']);
  assert.deepEqual(s.spark, [200, 210, 220, 230]);

  const pool = [lot('graded-cards', '1952 Topps #311 Mickey Mantle - PSA 8', { imageUrl: 'https://img/m.jpg' })];
  const g = groupByName(pool).get('pl:mickey-mantle')!;
  const players = new Map([['mickey-mantle', {
    slug: 'mickey-mantle', n: 6560, sport: 'Baseball',
    cats: { 'sports-cards': { n: 5000, medUsd: 900, ttmMedUsd: 1200 } },
    objects: [{ id: 'x', d: '2022-12-11', p: 1250000, t: '1952 Topps #311', cat: 'sports-cards' }],
  }]]);
  const b = nameBundle('pl:mickey-mantle', g, players, new Set(['mickey-mantle']));
  assert.equal(b.s.label, 'Mickey Mantle');
  assert.equal(b.s.sold, 6560);
  assert.equal(b.s.med12m, 1200);
  assert.ok(b.s.medScope);                                               // the median's scope rides the note
  assert.equal(b.s.record?.p, 1250000);
  assert.equal(b.s.caps.follow, 'mickey-mantle');
  assert.ok(b.detail);
  // no dossier, no players file: a live-only subject
  const b2 = nameBundle('pl:mickey-mantle', g, null, new Set());
  assert.equal(b2.s.sold, null);
  assert.equal(b2.detail, null);
  assert.equal(b2.s.caps.follow, null);
});

/* ── the URL codec ── */

test('view-state: defaults encode to an empty query', () => {
  assert.equal(viewSearch(VIEW_DEFAULTS), '');
  assert.deepEqual(decodeView(new URLSearchParams('')), VIEW_DEFAULTS);
});

test('view-state: every key round-trips, compare + display + live order included', () => {
  const v = {
    ...VIEW_DEFAULTS, q: 'mantle', on: true, vi: true, fl: true, fw: true, sort: 'live' as const,
    cols: ['curve', 'record'] as typeof DEFAULT_COLS, open: 'pl:mickey-mantle', ls: 'closing' as const, spk: 'baseball', by: 'cat' as const,
    cmp: ['mk:andy-warhol', 'cs:sports-cards:singles'],
    triage: { ...TRIAGE_DEFAULTS, win: 'week' as const, maxUsd: 100000 },
  };
  const back = decodeView(new URLSearchParams(viewSearch(v)));
  assert.deepEqual(back, v);
  // makers travel as their bare slug
  assert.match(viewSearch(v), /cmp=andy-warhol%2Ccs%3Asports-cards%3Asingles/);
});

test('view-state: encode clears only its own keys', () => {
  const p = new URLSearchParams('tab=all&foo=1&q=old&open=kaws');
  encodeView({ ...VIEW_DEFAULTS, q: 'new' }, p);
  assert.equal(p.toString(), 'tab=all&foo=1&q=new');
});

test('view-state: pre-overhaul row ids in shared links still resolve', () => {
  assert.equal(idFromParam('andy-warhol'), 'mk:andy-warhol');
  assert.equal(idFromParam('s:sports|p:mickey-mantle'), 'pl:mickey-mantle');
  assert.equal(idFromParam('s:tcg|k:charizard'), 'sj:tcg|k:charizard');
  assert.equal(idFromParam('s:sports|s:1986-fleer-basketball'), 'st:sports|s:1986-fleer-basketball');
  assert.equal(idFromParam('s:culture|~'), '~:culture');
  assert.equal(idFromParam('c:sports-cards:singles'), 'cs:sports-cards:singles');
  assert.equal(idFromParam('not-a-maker'), null);
  assert.equal(idToParam('mk:rolex'), 'rolex');
  assert.equal(idToParam('pl:x'), 'pl:x');
  // compare caps at four, de-duplicated
  const v = decodeView(new URLSearchParams('cmp=kaws,kaws,rolex,omega,cartier,andy-warhol'));
  assert.equal(v.cmp.length, COMPARE_MAX);
  assert.deepEqual(v.cmp, ['mk:kaws', 'mk:rolex', 'mk:omega', 'mk:cartier']);
});

test('view-state: patches keep identity when nothing changes; a new dossier resets its live order', () => {
  const v = { ...VIEW_DEFAULTS, open: 'mk:kaws', ls: 'est' as const };
  assert.equal(patchView(v, { q: '' }), v);
  const w = patchView(v, { open: 'mk:rolex' });
  assert.equal(w.ls, 'matters');
  assert.equal(w.cols, v.cols);                                          // untouched keys keep identity (row memo)
  assert.equal(patchView(v, { open: 'mk:rolex', ls: 'closing' }).ls, 'closing');
});
