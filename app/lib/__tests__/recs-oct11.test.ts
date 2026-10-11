/**
 * "Lots you may like" — the Oct 11 review round (R1 picks on prod, R3 the
 * algorithm audit): a category follow reaches only the kind of object it
 * names; a stated floor binds the fallback and sinks far-off real ties with
 * a reason that says so; a broad follow takes fewer seats than a name and is
 * read through the names; the device's signals keep a few seats; "Not for me"
 * quiets the seed that explained the pick; a searched term is an entity +
 * facets, not loose words; a quick-start market with no names still deals;
 * a followed name with no band leans to its own prices; a band is printed
 * only on a lot inside it; features follow the clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaste, recommend, scoreLots, featOf, termMatcherOf, recNote, REC_DEAL, type RecLot } from '../recs';
import { kindFits } from '../object-kind';
import { affinityOf, catFollow, entityFollow, makerFollow } from '../follows';

const NOW = Date.parse('2026-10-09T20:00:00Z');
const at = (days: number) => new Date(NOW + days * 864e5).toISOString();
let seq = 0;
function card(title: string, sport: string, bid: number, o: Partial<RecLot> = {}): RecLot {
  return {
    id: `c-${++seq}`, artist: 'sports-cards', title, subCat: 'cards', drill: sport, auctionHouse: 'Goldin', saleName: 'Weekly',
    saleDate: at(3).slice(0, 10), saleDateTime: at(3), currentBid: bid, bidCount: 6, currency: 'USD', status: 'upcoming', ...o,
  };
}
function watch(artist: string, title: string, lo: number, o: Partial<RecLot> = {}): RecLot {
  return {
    id: `w-${++seq}`, artist, title, subCat: 'wristwatches', objectClass: 'watch', auctionHouse: 'Phillips', saleName: 'Watches',
    saleDate: at(4).slice(0, 10), estimateLow: lo, estimateHigh: lo * 1.5, currency: 'USD', status: 'upcoming', ...o,
  };
}
function print(artist: string, title: string, lo: number, o: Partial<RecLot> = {}): RecLot {
  return {
    id: `p-${++seq}`, artist, title, subCat: 'prints', auctionHouse: 'Phillips', saleName: 'Editions',
    saleDate: at(5).slice(0, 10), estimateLow: lo, estimateHigh: lo * 1.5, currency: 'USD', status: 'upcoming', ...o,
  };
}
const ids = (rs: { lot: RecLot }[]) => rs.map(r => r.lot.id);

/* ── object kind ── */

test('object kind: a guitar is not a single, a menu or a necklace is not a watch, Moonwalk is not Apollo', () => {
  assert.equal(kindFits({ artist: 'sports-cards', title: '2000s Gibson Custom Shop Les Paul - Dale Earnhardt (#35/333) - Includes Gibson Hardshell Case', subCat: 'cards', drill: 'racing' }), false);
  assert.equal(kindFits({ artist: 'sports-cards', title: '2024 Panini Prizm WNBA Gold Vinyl Prizm #147 Angel Reese Rookie Card (#1/1) - PSA 8', subCat: 'cards', drill: 'basketball' }), true, 'a "Gold Vinyl" parallel is a card');
  assert.equal(kindFits({ artist: 'pokemon', title: 'Pokemon - Pokemon "Remix Inedit" - Vinyl In Sleeve - Edel - 2000', subCat: 'pokemon-cards', drill: 'vintage' }), false);
  assert.equal(kindFits({ artist: 'omega', title: 'Omega Apollo Astronaut Appreciation Dinner Menu', subCat: 'wristwatches', objectClass: 'object' }), false);
  assert.equal(kindFits({ artist: 'cartier', title: 'CARTIER: COLLIER MAILLONS "PANTHÈRE"', subCat: 'wristwatches', objectClass: 'watch' }), false);
  assert.equal(kindFits({ artist: 'omega', title: 'Mir Flown Omega Speedmaster Professional Chronograph', subCat: 'wristwatches', objectClass: 'object' }), true);
  assert.equal(kindFits({ artist: 'space-exploration', title: 'Michael Jackson Twice-Signed 1st Edition Moonwalk Autobiography', subCat: 'space', drill: 'apollo', ek: 'sj:culture|p:michael-jackson' }), false);
  assert.equal(kindFits({ artist: 'space-exploration', title: 'Neil Armstrong Signed Photograph', subCat: 'space', drill: 'apollo', ek: 'sj:science|p:neil-armstrong' }), true);
});

test('a category follow never reaches the wrong kind of object (recs and affinityOf); a named follow still does', () => {
  const gibson = card('2000s Gibson Custom Shop Les Paul - Dale Earnhardt (#35/333) - Includes Gibson Hardshell Case', 'racing', 1800);
  const real = card('2020 Topps Chrome F1 Refractor #6 Max Verstappen Rookie - PSA 10', 'racing', 1800);
  const singles = catFollow('sports-cards', 'singles');
  const rs = recommend([gibson, real], buildTaste({ saved: [], follows: [singles], nowMs: NOW }), { nowMs: NOW });
  assert.deepEqual(ids(rs), [real.id]);
  assert.equal(affinityOf(gibson, [singles]), 0);
  assert.ok(affinityOf(real, [singles]) > 0);
  const menu = watch('omega', 'Omega Apollo Astronaut Appreciation Dinner Menu', 1000, { objectClass: 'object' });
  assert.equal(affinityOf(menu, [catFollow('watches', 'wristwatches')]), 0);
  assert.equal(affinityOf(menu, [makerFollow('omega', 'Omega')]), 1, 'an Omega menu is still Omega’s');
});

test('the fallback ladder never deals the wrong kind of object ("Another maker’s watches" was two dinner menus)', () => {
  const patek = watch('patek-philippe', 'Patek Philippe Calatrava Ref. 96', 20000);
  const menu = watch('omega', 'Omega Apollo Astronaut Appreciation Dinner Menu', 15000, { objectClass: 'object' });
  const necklace = watch('cartier', 'CARTIER: COLLIER MAILLONS "PANTHÈRE"', 18000);
  const omega = watch('omega', 'Omega Speedmaster Professional Ref. 145.022', 16000);
  const rs = recommend([patek, menu, necklace, omega], buildTaste({ saved: [], follows: [makerFollow('patek-philippe', 'Patek Philippe')], nowMs: NOW }), { nowMs: NOW });
  assert.ok(ids(rs).includes(omega.id) && !ids(rs).includes(menu.id) && !ids(rs).includes(necklace.id), rs.map(r => r.lot.title).join(' | '));
});

/* ── a stated range ── */

test('a stated floor binds the ladder; real ties far below it come after, saying so', () => {
  const cheap = [8000, 6000, 12000].map((p, i) => watch('patek-philippe', `Patek Philippe Ref. 24${i}0`, p));
  const inRange = watch('rolex', 'Rolex Daytona Ref. 6265', 90000);
  const cheapKin = watch('omega', 'Omega Seamaster Ref. 2531', 900);
  const t = buildTaste({ saved: [], follows: [makerFollow('patek-philippe', 'Patek Philippe')], price: { minUsd: 50000, maxUsd: null }, nowMs: NOW });
  const rs = recommend([...cheap, inRange, cheapKin], t, { nowMs: NOW });
  assert.equal(rs[0].lot.id, inRange.id, 'the in-range kin leads the far-below follows');
  assert.ok(!ids(rs).includes(cheapKin.id), 'the ladder deals inside the stated range only');
  const below = rs.filter(r => r.outOfRange === 'below');
  assert.equal(below.length, 3);
  for (const r of below) assert.match(r.reason, /below your \$50K floor/);
});

/* ── broad follows ── */

test('a broad category follow takes fewer seats than a name and is read through the names (no F1 for a Wembanyama reader)', () => {
  const pool: RecLot[] = [];
  for (let i = 0; i < 30; i++) pool.push(card(`2024 Panini Prizm #${i + 1} Victor Wembanyama Rookie - PSA ${8 + (i % 3)}`, 'basketball', 400 + i * 10, { playerSlug: 'victor-wembanyama', saleName: `S${i % 5}` }));
  for (let i = 0; i < 30; i++) pool.push(card(`2023 Panini Prizm #${i + 101} Joel Embiid - PSA 10`, 'basketball', 400 + i * 10, { playerSlug: 'joel-embiid', saleName: `T${i % 5}` }));
  for (let i = 0; i < 30; i++) pool.push(card(`2020 Topps Chrome F1 Refractor #${i + 1} Max Verstappen Rookie - PSA 10`, 'racing', 400 + i * 10, { playerSlug: 'max-verstappen', saleName: `U${i % 5}` }));
  const t = buildTaste({ saved: [], follows: [makerFollow('victor-wembanyama', 'Victor Wembanyama'), catFollow('sports-cards', 'singles')], nowMs: NOW });
  const rs = recommend(pool, t, { nowMs: NOW, n: REC_DEAL });
  const broad = rs.filter(r => r.seed.follow?.kind === 'cat');
  assert.ok(broad.length <= Math.ceil(REC_DEAL * 0.2), `${broad.length} broad seats`);
  assert.ok(broad.every(r => /basketball/.test(String(r.lot.drill))), 'the category follow reads as modern basketball, not F1');
});

/* ── on-device signals ── */

test('what the device learned keeps a few seats on a deep desk (it used to get none)', () => {
  const desk: RecLot[] = [], pool: RecLot[] = [], seen: RecLot[] = [];
  for (let i = 0; i < 8; i++) desk.push(card(`19${55 + i} Topps #${i + 1} Player${i} Smith - PSA 6`, 'baseball', 300, { saleName: 'REA' }));
  for (let i = 0; i < 60; i++) pool.push(card(`19${55 + (i % 8)} Topps #${i + 50} Other${i} Jones - PSA 6`, 'baseball', 300, { saleName: `R${i % 6}` }));
  for (let i = 0; i < 20; i++) pool.push({ ...card(`1999 Pokemon Base Set Holo #${i + 1} Mon${i} - PSA 8`, 'tcg', 300), artist: 'pokemon', subCat: 'pokemon-cards', drill: 'vintage' });
  for (let i = 0; i < 5; i++) seen.push({ ...card(`1999 Pokemon Base Set Holo #${i + 40} Seen${i} - PSA 8`, 'tcg', 300), artist: 'pokemon', subCat: 'pokemon-cards', drill: 'vintage' });
  const saved = desk.map((l, i) => ({ id: l.id, lot: l, owned: i === 0 }));
  const quiet = recommend(pool, buildTaste({ saved, follows: [], nowMs: NOW }), { nowMs: NOW, n: 24 });
  assert.equal(quiet.filter(r => r.seed.kind === 'signal').length, 0);
  const t = buildTaste({ saved, follows: [], extra: seen.map(l => ({ lot: l, weight: 0.25, reason: 'looked at' })), nowMs: NOW });
  const rs = recommend(pool, t, { nowMs: NOW, n: 24 });
  const sig = rs.filter(r => r.seed.kind === 'signal');
  assert.ok(sig.length >= 3 && sig.length <= 8, `${sig.length} seats`);
  for (const r of sig) assert.match(r.reason, /^Because you looked at /);
  // home (20) is still the profile's prefix
  assert.deepEqual(ids(recommend(pool, t, { nowMs: NOW, n: 20 })), ids(rs).slice(0, 20));
});

test('"Not for me" quiets the seed that explained the pick, and a nameless lot its cut', () => {
  const a = card('1952 Topps #1 Andy Pafko - PSA 5', 'baseball', 900, { playerSlug: 'andy-pafko' });
  const b = card('1986 Fleer #57 Michael Jordan Rookie - PSA 8', 'basketball', 900, { playerSlug: 'michael-jordan' });
  const pool: RecLot[] = [];
  for (let i = 0; i < 12; i++) pool.push(card(`195${i % 10} Topps #${i + 2} Andy Pafko - PSA ${3 + (i % 5)}`, 'baseball', 900 + i, { playerSlug: 'andy-pafko', saleName: `A${i % 4}` }));
  for (let i = 0; i < 12; i++) pool.push(card(`198${i % 10} Fleer #${i + 60} Michael Jordan - PSA ${6 + (i % 4)}`, 'basketball', 900 + i, { playerSlug: 'michael-jordan', saleName: `B${i % 4}` }));
  const saved = [{ id: a.id, lot: a }, { id: b.id, lot: b }];
  const r0 = recommend(pool, buildTaste({ saved, follows: [], nowMs: NOW }), { nowMs: NOW, n: 12 });
  const pafko0 = r0.filter(r => r.seed.lotId === a.id).length;
  const passed = r0.filter(r => r.seed.lotId === a.id).slice(0, 3).map(r => r.lot);
  const t = buildTaste({ saved, follows: [], negative: { ids: passed.map(l => l.id), keys: [], lots: passed }, nowMs: NOW });
  const pafkoSeed = t.seeds.find(s => s.lotId === a.id)!;
  assert.ok(pafkoSeed.w < 0.75 * 0.5 && pafkoSeed.w >= 0.75 * 0.3 - 1e-9, `${pafkoSeed.w}`);
  const r1 = recommend(pool, t, { nowMs: NOW, n: 12 });
  assert.ok(r1.filter(r => r.seed.lotId === a.id).length < pafko0, 'the seed behind the passes speaks less');
  for (const l of passed) assert.ok(!ids(r1).includes(l.id), 'a passed lot never comes back');
  // a lot with no named entity: its cut (category · sub · sport · era) is quieted
  const bucket = card('1960s Baseball Card Lot - Mixed', 'baseball', 200, { ek: 'cs:sports-cards:singles' });
  const t2 = buildTaste({ saved: [], follows: [], negative: { ids: [bucket.id], keys: [], lots: [bucket] }, nowMs: NOW });
  assert.ok(Array.from(t2.down?.keys() ?? []).some(k => k.startsWith('cut:sports-cards|singles|baseball')));
});

/* ── searched terms ── */

test('a searched term is an entity + facets: "signed album" seeds nothing; "psa 7 mays" needs the grade and the name', () => {
  assert.equal(termMatcherOf('signed album'), null);
  const m = termMatcherOf('psa 7 mays')!;
  assert.ok(m);
  const hit = card('1956 Topps #130 Willie Mays - PSA NM 7', 'baseball', 900, { playerSlug: 'willie-mays' });
  const wrongGrade = card('1956 Topps #130 Willie Mays - PSA 4', 'baseball', 900, { playerSlug: 'willie-mays' });
  const set = card('1961 Topps Baseball Complete Set (587) - Featuring Mays, PSA 7 Mantle', 'baseball', 900);
  assert.equal(m(hit, featOf(hit, NOW)), true);
  assert.equal(m(wrongGrade, featOf(wrongGrade, NOW)), false);
  assert.equal(m(set, featOf(set, NOW)), false, 'a set that names him in its title is not his card');
  const jp = termMatcherOf('japanese base set psa')!;
  const ja = { ...card('1996 Pokemon Japanese Base Set Holo #6 Charizard - PSA 9', 'tcg', 900), artist: 'pokemon', subCat: 'pokemon-cards', drill: 'vintage' };
  const en = { ...card('1999 Pokemon Base Set Holo #4 Charizard - PSA 9', 'tcg', 900), artist: 'pokemon', subCat: 'pokemon-cards', drill: 'vintage' };
  assert.equal(jp(ja, featOf(ja, NOW)), true);
  assert.equal(jp(en, featOf(en, NOW)), false);
});

/* ── quick-start markets ── */

test('a quick-start market with no names still deals its picks; a market a name covers stays quiet', () => {
  const poke = [1, 2, 3].map(i => ({ ...card(`1999 Pokemon Base Set Holo #${i} Mon${i} - PSA 8`, 'tcg', 500), artist: 'pokemon', subCat: 'pokemon-cards', drill: 'vintage' }));
  const jordan = card('1986 Fleer #57 Michael Jordan Rookie - PSA 8', 'basketball', 9000, { playerSlug: 'michael-jordan' });
  const jersey = { ...card('Game-Worn Jersey', 'basketball', 2000), artist: 'sports-memorabilia', subCat: 'game-used' };
  const only = recommend([...poke, jordan], buildTaste({ saved: [], follows: [], markets: ['tcg'], nowMs: NOW }), { nowMs: NOW });
  assert.deepEqual(ids(only).sort(), poke.map(l => l.id).sort());
  assert.match(only[0].reason, /^You picked TCG/);
  const named = recommend([...poke, jordan, jersey], buildTaste({ saved: [], follows: [makerFollow('michael-jordan', 'Michael Jordan')], markets: ['sports'], nowMs: NOW }), { nowMs: NOW });
  assert.deepEqual(ids(named), [jordan.id], 'Sports is covered by the Jordan follow: no game-worn jersey "because you picked Sports"');
});

/* ── price ── */

test('a followed name with no band leans to its own price level (not its grails)', () => {
  const pool: RecLot[] = [];
  const prices = [3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000, 250000, 400000, 600000, 900000];
  prices.forEach((p, i) => pool.push(print('andy-warhol', `Warhol Print ${i}`, p, { saleName: `E${i % 6}` })));
  const rs = recommend(pool, buildTaste({ saved: [], follows: [makerFollow('andy-warhol', 'Andy Warhol')], nowMs: NOW }), { nowMs: NOW, n: 6 });
  const top = rs.map(r => Number(r.lot.estimateLow));
  assert.ok(top.filter(p => p < 100000).length >= 5, top.join(','));
});

test('a desk band is printed only on a lot inside it ("near your …" just outside)', () => {
  const kobe = (t: string, p: number) => card(t, 'basketball', p, { playerSlug: 'kobe-bryant' });
  const desk = [kobe('1996 Topps #138 Kobe Bryant Rookie - PSA 8', 200), kobe('1997 Topps #1 Kobe Bryant - PSA 9', 380)];
  const pool = [kobe('1998 Topps #2 Kobe Bryant - PSA 9', 260), kobe('1999 Topps #3 Kobe Bryant - PSA 9', 560), kobe('2000 Topps #4 Kobe Bryant - PSA 9', 5000)];
  const rs = recommend(pool, buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l })), follows: [], nowMs: NOW }), { nowMs: NOW });
  for (const r of rs) {
    const a = Math.pow(10, featOf(r.lot, NOW).logA ?? 0);
    const note = recNote(r);
    const m = note.match(/· \$([\d.]+)(K)?–([\d.]+)(K)?(?! range)/);
    if (m && !/near your/.test(note)) {
      const lo = Number(m[1]) * (m[2] ? 1e3 : 1), hi = Number(m[3]) * (m[4] ? 1e3 : 1);
      assert.ok(a >= lo * 0.95 && a <= hi * 1.05, `${note} on a $${Math.round(a)} lot`);
    }
  }
});

test('features follow the clock: a tab left open reads tomorrow’s anchor, not yesterday’s', () => {
  const l = card('1952 Topps #311 Mickey Mantle - PSA 3', 'baseball', 5000, { saleDateTime: at(10), saleDate: at(10).slice(0, 10) });
  const a = featOf(l, NOW);
  assert.equal(featOf(l, NOW + 3600e3), a, 'memoized inside one day');
  l.currentBid = 50000;
  assert.notEqual(featOf(l, NOW + 2 * 864e5).logA, a.logA, 'a new day reads the lot again');
});

test('one sale never fills the generic seats; a named tie is never capped by its sale', () => {
  const desk = [card('1955 Topps #1 Al Pha - PSA 6', 'baseball', 300, { saleName: 'X' }), card('1956 Topps #2 Bo Ta - PSA 6', 'baseball', 300, { saleName: 'X' })];
  const pool: RecLot[] = [];
  for (let i = 0; i < 30; i++) pool.push(card(`195${i % 10} Topps #${i + 10} Gen${i} Eric - PSA 6`, 'baseball', 300, { auctionHouse: 'REA', saleName: 'Big', saleDateTime: at(6), saleDate: at(6).slice(0, 10) }));
  for (let i = 0; i < 30; i++) pool.push(card(`195${i % 10} Topps #${i + 50} Oth${i} Erson - PSA 6`, 'baseball', 290, { auctionHouse: `H${i % 6}`, saleName: `S${i % 6}`, saleDateTime: at(5 + (i % 6)), saleDate: at(5 + (i % 6)).slice(0, 10) }));
  const rs = recommend(pool, buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l })), follows: [], nowMs: NOW }), { nowMs: NOW, n: 24 });
  assert.ok(rs.filter(r => r.lot.auctionHouse === 'REA').length <= Math.ceil(24 / 6), `${rs.filter(r => r.lot.auctionHouse === 'REA').length} from one sale`);
  // the reader's own name may fill from one sale
  const named: RecLot[] = [];
  for (let i = 0; i < 20; i++) named.push(card(`195${i % 10} Topps #${i + 200} Mickey Mantle - PSA ${2 + (i % 6)}`, 'baseball', 3000 + i, { playerSlug: 'mickey-mantle', auctionHouse: 'REA', saleName: 'Big', saleDateTime: at(6), saleDate: at(6).slice(0, 10) }));
  const rn = recommend([...named, ...pool], buildTaste({ saved: [], follows: [makerFollow('mickey-mantle', 'Mickey Mantle')], nowMs: NOW }), { nowMs: NOW, n: 24 });
  assert.ok(rn.filter(r => /Mantle/.test(r.lot.title)).length >= 18, `${rn.filter(r => /Mantle/.test(r.lot.title)).length}`);
});

test('scoreLots puts real ties far outside a stated range after the ladder', () => {
  const patek = [5000, 6000].map((p, i) => watch('patek-philippe', `Patek Philippe Ref. 5${i}`, p));
  const kin = watch('rolex', 'Rolex Daytona Ref. 6263', 80000);
  const rows = scoreLots([...patek, kin], buildTaste({ saved: [], follows: [makerFollow('patek-philippe', 'Patek Philippe')], price: { minUsd: 50000, maxUsd: null }, nowMs: NOW }), { nowMs: NOW });
  assert.equal(rows[0].l.id, kin.id);
  assert.ok(rows.slice(1).every(r => r.out === 'below'));
  void entityFollow;
});
