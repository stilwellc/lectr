/* (r8, Oct 10) entity data — one person per public figure, one entity per
   artist and per team, a spark that reads the YoY's year, n beside every
   median, the sport a player plays, and no Movers where nothing resells.
   Titles are the corpus's own. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityKeyOf } from '../entity/key';
import { publicFigureCanon, publicFigureHome } from '../player-name';
import { teamSeasonOf } from '../subject-groups';
import { entityFigures, sparkYoyOff, withLeadQuarters, completeQuarters, type SoldPoint } from '../entity/stats';
import { encodeEntities, decodeEntities, LENS_LABELS } from '../entity/wire';
import { buildRow, sortRows, NO_MOVERS, type Row } from '../entity/ledger';
import { makerBundle, type EntityBundle } from '../../hooks/useEntities';
import { sportOf } from '../../utils';
import type { EntitySummary } from '../entity/model';
import type { MarketStats } from '../../types';

const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${artist}-${title}`.slice(0, 48), artist, title, status: 'upcoming', saleDate: '2026-10-20', ...extra });
const key = (artist: string, title: string, extra: Record<string, unknown> = {}) => entityKeyOf(lot(artist, title, extra));

test('r8: a famous non-athlete files under ONE person in their home market — never a sports person', () => {
  // sports desks → Pop Culture / Science, the same id the culture / science desks use
  assert.equal(key('autographs', 'Ronald Reagan Signed Baseball'), 'sj:culture|p:ronald-reagan');
  assert.equal(key('entertainment-memorabilia', 'Ronald Reagan Signed Photograph'), 'sj:culture|p:ronald-reagan');
  assert.equal(key('autographs', 'Neil Armstrong Signed Baseball'), 'sj:science|p:neil-armstrong');
  assert.equal(key('autographs', '1929 Thomas Edison Signed Check'), 'sj:science|p:thomas-edison');
  // a culture desk's scientist joins the science desk's (Einstein was two entities)
  assert.equal(key('entertainment-memorabilia', 'Albert Einstein Signed Letter With Original Envelope - PSA/DNA LOA'), 'sj:science|p:albert-einstein');
  // MJ's Moonwalk on a space desk is Michael Jackson's, not a mission's
  assert.equal(key('space-exploration', 'Michael Jackson Twice-Signed 1st Edition Moonwalk Autobiography - Grad Authentication Digital LOA'), 'sj:culture|p:michael-jackson');
  // one spelling per figure
  assert.equal(key('entertainment-memorabilia', 'Harry Truman Signed Photograph'), key('entertainment-memorabilia', 'Harry S. Truman Signed Photograph'));
  assert.equal(publicFigureHome('Buzz Aldrin'), 'science');
  assert.equal(publicFigureHome('Marilyn Monroe'), 'culture');
});

test('r8: the strict public-figure read never completes or truncates a name', () => {
  assert.equal(publicFigureCanon('Martin Luther', true), null);
  assert.equal(publicFigureCanon('George Washington Carver', true), null);
  assert.equal(publicFigureCanon('Dwight D. Eisenhower Hand-Corrected', true), 'Dwight D. Eisenhower');
  assert.equal(publicFigureCanon('Abraham Lincoln Albumen', true), 'Abraham Lincoln');
  assert.equal(key('entertainment-memorabilia', 'Martin Luther Autograph Manuscript Signed'), 'sj:culture|p:martin-luther');
  assert.notEqual(key('entertainment-memorabilia', 'George Washington Carver Autograph Letter Signed'), 'sj:culture|p:george-washington');
});

test('r8: one entity per tracked artist — works, ephemera and sports-desk pieces all file under the maker', () => {
  for (const [artist, t] of [
    ['entertainment-memorabilia', 'Andy Warhol Signed Photograph'],
    ['autographs', 'Andy Warhol Signed Poster of Muhammad Ali'],
    ['autographs', 'Andy Warhol Single-Signed Baseball'],
    ['entertainment-memorabilia', 'Pablo Picasso Signed Photograph'],
  ] as const) assert.equal(key(artist, t), artist === 'entertainment-memorabilia' && t.startsWith('Pablo') ? 'mk:pablo-picasso' : 'mk:andy-warhol', t);
});

test('r8: one team entity, every season — the season is its facet', () => {
  for (const t of ['1961 New York Yankees Team-Signed Ball', '1998 New York Yankees World Champions Team-Signed Bat', '1928 New York Yankees Team-Signed Ball with Ruth and Gehrig']) {
    assert.equal(key('autographs', t), 'sj:sports|t:new-york-yankees', t);
  }
  assert.equal(key('graded-cards', '1961 Topps #228 New York Yankees Team PSA 8'), 'sj:sports|t:new-york-yankees');
  assert.equal(teamSeasonOf('1986-87 Boston Celtics Team-Signed Ball'), '1986-87');
});

test('r8: a player\'s sport never reads off a bare first name or surname', () => {
  assert.equal(sportOf('2020 Panini Mosaic Red Mosaic #211 Jordan Love Rookie Card - PSA GEM MT 10'), null);
  assert.equal(sportOf('2023 Bowman Chrome #BCP-1 Jordan Walker PSA 10'), null);
  assert.equal(sportOf('1986 Fleer #57 Michael Jordan Rookie PSA 8'), 'Basketball');
  assert.equal(sportOf('Nike Air Jordan 1 Game-Worn Sneakers'), 'Basketball');
  assert.equal(sportOf('1952 Topps #311 Mickey Mantle PSA 8'), 'Baseball');
  assert.equal(sportOf('Antique Fireplace Mantle Clock'), null);
  assert.equal(sportOf('Masters of the Universe He-Man Production Cel'), null);
  assert.equal(sportOf('2019 Masters Tournament Flag Signed by Tiger Woods'), 'Golf');
});

/* ── the spark reads the YoY's year ── */
const TODAY = '2026-10-10';
const dayOf = (q: string) => `${q.slice(0, 4)}-${String((Number(q.slice(6)) - 1) * 3 + 2).padStart(2, '0')}-15`;
const pt = (p: number, d: string, k: string | null = null): SoldPoint => ({ p, d, h: 'H', lens: 'entertainment:other', coarse: 'entertainment', id: `${d}-${p}-${k}`, t: '', img: null, k });

test('r8: the median spark is the trailing year at each quarter — four points apart IS the median YoY', () => {
  const Q = completeQuarters(TODAY, 15);
  const rows: SoldPoint[] = [];
  // a quarter-to-quarter mix swing (cheap, dear, cheap…) over a steady year-on-year level
  Q.forEach((q, i) => { for (let j = 0; j < 12; j++) rows.push(pt(Math.round((i % 2 ? 130 : 100) * (1 + j / 11) * (i >= 11 ? 1.2 : 1)), dayOf(q))); });
  const f = entityFigures(rows, TODAY, LENS_LABELS);
  assert.equal(f.sparkBasis, 'median');
  assert.ok(f.yoy && f.yoy.basis === 'median', JSON.stringify(f.yoy));
  const sp = f.spark!;
  const lineYoy = Math.round((sp[11]! / sp[7]! - 1) * 1000) / 10;
  assert.equal(lineYoy, f.yoy!.pct);
  assert.equal(f.sparkYoyOff, null);
  assert.deepEqual(withLeadQuarters(['2026-Q1', '2026-Q2'], 3), ['2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2']);
});

test('r8: a line whose year falls outside the YoY interval says so, on the wire too', () => {
  const y = { pct: 105, n: 220, basis: 'matched' as const, lo: 87, hi: 119 };
  assert.equal(sparkYoyOff([1, 1, 1, 1, 1374, 1, 1, 1, 3372], y), 145.4);
  assert.equal(sparkYoyOff([1, 1, 1, 1, 1000, 1, 1, 1, 2050], y), null);
  assert.equal(sparkYoyOff([1, 2, 3], y), null);
  const base: EntitySummary = {
    id: 'pl:michael-jordan', kind: 'player', market: 'sports', label: 'Michael Jordan', subKind: 'player', discipline: 'Basketball', face: null, page: null,
    sold: 100, sold12m: 50, med12m: 2000, med12mN: 50, medScope: null, record: null,
    spark: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], sparkN: Array(12).fill(5), sparkBasis: 'matched', sparkYoyOff: 145.4, yoy: null, verified: null, thin: false,
    caps: { compare: true, follow: 'michael-jordan', dossier: true },
  };
  const Q = completeQuarters(TODAY, 12);
  const w = encodeEntities([base, { ...base, id: 'pl:kobe-bryant', label: 'Kobe Bryant', sparkYoyOff: null }], { tier: 'main', generatedAt: 'x', lastCrawl: 'x', sparkQ: Q, tailN: 0, keepFace: () => false });
  assert.deepEqual(decodeEntities(w).entities.map(e => e.sparkYoyOff), [145.4, null]);
  // a file where every line agrees carries no column
  const w2 = encodeEntities([{ ...base, sparkYoyOff: null }], { tier: 'main', generatedAt: 'x', lastCrawl: 'x', sparkQ: Q, tailN: 0, keepFace: () => false });
  assert.equal(w2.c.so, undefined);
});

/* ── n beside every median ── */
test('r8: the fail-soft maker median prints only with its n, at n ≥ 5 (Fab 5 Freddy: $704 from one sale)', () => {
  const st = (sold12m: number) => ({ totalSoldTracked: 9, sold12m, sold12mWindow: { days: 365 }, medianPriceLast12Months: 704, priceHistory: [], houseDistribution: [] }) as unknown as MarketStats;
  const one = makerBundle('fab-5-freddy', 'art', st(1), null, null).s;
  assert.equal(one.med12m, null);
  assert.equal(one.med12mN, null);
  const six = makerBundle('fab-5-freddy', 'art', st(6), null, null).s;
  assert.equal(six.med12m, 704);
  assert.equal(six.med12mN, 6);
});

/* ── no Movers where nothing resells ── */
test('r8: Movers ranks no Pop Culture / Science row — those keep the Matters order', () => {
  assert.ok(NO_MOVERS.has('culture') && NO_MOVERS.has('science') && !NO_MOVERS.has('sports'));
  const summary = (id: string, market: EntitySummary['market'], over: Partial<EntitySummary> = {}): EntitySummary => ({
    id, kind: 'subject', market, label: id, subKind: 'person', discipline: null, face: null, page: null, sold: 100, sold12m: 50,
    med12m: 100, med12mN: 50, medScope: null, record: null, spark: null, sparkN: null, yoy: null, verified: null, thin: false,
    caps: { compare: false, follow: null, dossier: true }, ...over,
  });
  const row = (s: EntitySummary, o: Partial<Row> = {}): Row => ({ ...buildRow(s.id, { s, detail: null } as EntityBundle, undefined, new Set()), ...o });
  const rows = [
    row(summary('sj:culture|p:a', 'culture'), { label: 'A', topScore: 1, yoy: { pct: 200, n: 40, basis: 'median', lo: 50, hi: 300 } }),
    row(summary('sj:culture|p:b', 'culture'), { label: 'B', topScore: 9, yoy: null }),
    row(summary('pl:c', 'sports', { kind: 'player' }), { label: 'C', yoy: { pct: 10, n: 40, basis: 'matched', lo: 1, hi: 20 } }),
    row(summary('pl:d', 'sports', { kind: 'player' }), { label: 'D', yoy: { pct: 80, n: 40, basis: 'matched', lo: 40, hi: 120 } }),
  ];
  // sports by the guaranteed move; culture by Matters (B's live priority), never by A's pooled +200%
  assert.deepEqual(sortRows([...rows], 'movers').map(r => r.label), ['D', 'C', 'B', 'A']);
});
