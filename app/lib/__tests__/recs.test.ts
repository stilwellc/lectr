/**
 * "Lots you may like" (app/lib/recs): the taste profile weighs owned > saved
 * > followed > searched, similarity needs a real tie (entity, card,
 * franchise, line, or a distinctive facet inside one sub), sports and
 * categories never cross, the desk never comes back as a pick, every pick
 * says why, and a reader with no signals gets no picks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaste, recommend, scoreLots, featOf, lotSim, bandText, recNote, shortTitle, idAliases, type RecLot } from '../recs';
import { entityFollow, houseFollow, catFollow } from '../follows';

const NOW = Date.parse('2026-10-09T20:00:00Z');
const at = (days: number) => new Date(NOW + days * 864e5).toISOString();
let seq = 0;
function card(title: string, sport: string, bid: number, o: Partial<RecLot> = {}): RecLot {
  const id = `t-${++seq}`;
  return {
    id, artist: 'sports-cards', title, subCat: 'cards', drill: sport, auctionHouse: 'Goldin', saleName: 'Weekly',
    saleDate: at(3).slice(0, 10), saleDateTime: at(3), currentBid: bid, bidCount: 6, currency: 'USD', status: 'upcoming', ...o,
  };
}
function print(artist: string, title: string, lo: number, hi: number, o: Partial<RecLot> = {}): RecLot {
  const id = `p-${++seq}`;
  return {
    id, artist, title, subCat: 'prints', auctionHouse: 'Phillips', saleName: 'Editions',
    saleDate: at(5).slice(0, 10), estimateLow: lo, estimateHigh: hi, currency: 'USD', status: 'upcoming', ...o,
  };
}
const ids = (rs: { lot: RecLot }[]) => rs.map(r => r.lot.id);

test('cold start: no seeds → no picks (never filler)', () => {
  const pool = [card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 90000)];
  const t = buildTaste({ saved: [], follows: [], nowMs: NOW });
  assert.equal(t.seeds.length, 0);
  assert.deepEqual(recommend(pool, t, { nowMs: NOW }), []);
});

test('same player beats a stranger; sports never cross; the save never comes back', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA VG 3', 'baseball', 60000);
  const mantle = card('1956 Topps #135 Mickey Mantle - PSA EX 5', 'baseball', 9000);
  const otherBb = card('1956 Topps #79 Sandy Koufax - PSA EX 5', 'baseball', 900);
  const hoops = card('1961 Fleer #8 Wilt Chamberlain Rookie Card - PSA EX 5', 'basketball', 9000);
  const pool = [seed, mantle, otherBb, hoops];
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-2) }], follows: [], nowMs: NOW });
  const rs = recommend(pool, t, { nowMs: NOW });
  assert.equal(rs[0].lot.id, mantle.id);
  assert.ok(!ids(rs).includes(seed.id), 'a saved lot is never recommended back');
  assert.ok(!ids(rs).includes(hoops.id), 'a basketball card never answers a baseball save');
  assert.match(rs[0].reason, /^Because you saved 1952 Topps #311 Mickey Mantle/);
  assert.ok(rs[0].why.includes('same player'));
});

test('owned outweighs saved; recency decays a stale save', () => {
  const ownSeed = card('2003 Topps Chrome #111 LeBron James Rookie - PSA 10', 'basketball', 5000);
  const saveSeed = card('2009 Topps Chrome #101 Stephen Curry Rookie - PSA 10', 'basketball', 5000);
  const lebron = card('2003 Upper Deck #1 LeBron James Rookie - PSA 10', 'basketball', 5000, { saleDateTime: at(3), auctionHouse: 'Goldin' });
  const curry = card('2009 Upper Deck #234 Stephen Curry Rookie - PSA 10', 'basketball', 5000, { saleDateTime: at(3), auctionHouse: 'Goldin' });
  const t = buildTaste({
    saved: [{ id: ownSeed.id, lot: ownSeed, owned: true, savedAt: at(-200) }, { id: saveSeed.id, lot: saveSeed, savedAt: at(-1) }],
    follows: [], nowMs: NOW,
  });
  const owned = t.seeds.find(s => s.kind === 'owned')!, saved = t.seeds.find(s => s.kind === 'saved')!;
  assert.ok(owned.w < 1 && owned.w >= 0.4, 'a 200-day-old seed decays but keeps its floor');
  const fresh = buildTaste({ saved: [{ id: ownSeed.id, lot: ownSeed, owned: true, savedAt: at(-1) }, { id: saveSeed.id, lot: saveSeed, savedAt: at(-1) }], follows: [], nowMs: NOW });
  const rs = recommend([lebron, curry], fresh, { nowMs: NOW });
  assert.equal(rs[0].lot.id, lebron.id, 'the owned piece speaks louder than a save');
  assert.match(rs[0].reason, /^Because you own /);
  assert.ok(saved.w > 0);
});

test('memorabilia ties only on WHO: "signed" + same sub is not a match', () => {
  const mk = (title: string, artist = 'entertainment-memorabilia', subCat = 'autographs') => ({
    id: `m-${++seq}`, artist, title, subCat, drill: 'hollywood', auctionHouse: 'RR Auction', saleDate: at(4).slice(0, 10),
    estimateLow: 800, estimateHigh: 1200, currency: 'USD', status: 'upcoming',
  } as RecLot);
  const seed = mk('Ray Park Signed Darth Maul Photograph from Star Wars');
  const sw = mk('Mark Hamill Signed Luke Skywalker Photograph from Star Wars');
  const houdini = mk('Harry Houdini Signed Photograph');
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed }], follows: [], nowMs: NOW });
  const rs = recommend([seed, sw, houdini], t, { nowMs: NOW });
  assert.ok(ids(rs).includes(sw.id), 'the franchise ties');
  assert.ok(!ids(rs).includes(houdini.id), 'a stranger who merely signed does not');
});

test('the desk grammar: "Like your Andy Warhol prints · band", maker named on art saves', () => {
  const s1 = print('andy-warhol', 'Flowers (F. & S. II.64)', 20000, 30000);
  const s2 = print('andy-warhol', 'Cow (F. & S. II.11)', 30000, 40000);
  const cand = print('andy-warhol', 'Mick Jagger (F. & S. II.138)', 25000, 35000);
  const t = buildTaste({ saved: [{ id: s1.id, lot: s1 }, { id: s2.id, lot: s2 }], follows: [], nowMs: NOW });
  const rs = recommend([cand], t, { nowMs: NOW });
  assert.equal(rs.length, 1);
  assert.equal(rs[0].reason, 'Like your Andy Warhol prints · $25K–35K');
  const one = buildTaste({ saved: [{ id: s1.id, lot: s1 }], follows: [], nowMs: NOW });
  const r1 = recommend([cand], one, { nowMs: NOW });
  assert.match(r1[0].reason, /^Because you saved Andy Warhol · Flowers/);
});

test('follows and searches seed picks with their own reasons; houses reach only their house', () => {
  const zard = { id: 'z1', artist: 'pokemon', title: '1999 Pokemon Base Set Holo #4 Charizard - PSA NM-MT 8', subCat: 'pokemon-cards', drill: 'vintage', auctionHouse: 'Goldin', saleDate: at(2).slice(0, 10), saleDateTime: at(2), currentBid: 3000, bidCount: 12, currency: 'USD', status: 'upcoming' } as RecLot;
  const pika = { ...zard, id: 'z2', title: '1999 Pokemon Base Set Holo #58 Pikachu - PSA 9', auctionHouse: 'Heritage' } as RecLot;
  const t = buildTaste({ saved: [], follows: [entityFollow('sj:tcg|k:charizard', 'Charizard')], nowMs: NOW });
  const rs = recommend([zard, pika], t, { nowMs: NOW });
  assert.deepEqual(ids(rs), ['z1']);
  assert.equal(rs[0].reason, 'You follow Charizard');
  const th = buildTaste({ saved: [], follows: [houseFollow('Heritage')], nowMs: NOW });
  assert.deepEqual(ids(recommend([zard, pika], th, { nowMs: NOW })), ['z2']);
  const tc = buildTaste({ saved: [], follows: [catFollow('tcg', 'vintage')], nowMs: NOW });
  assert.equal(recommend([zard, pika], tc, { nowMs: NOW }).length, 2);
  const ts = buildTaste({ saved: [], follows: [], searches: [{ name: 'pikachu', query: { text: 'pikachu' } }], nowMs: NOW });
  const rq = recommend([zard, pika], ts, { nowMs: NOW });
  assert.deepEqual(ids(rq), ['z2']);
  assert.equal(rq[0].reason, 'Matches your search “pikachu”');
});

test('exclusions: id aliases, a cross-house twin, closed lots; maxDays', () => {
  const seed = card('1954 Topps #128 Hank Aaron Rookie Card - PSA GD 2', 'baseball', 600, { id: 'goldin-1', crossLive: [{ id: 'rea-9', house: 'REA', bid: 500 }] });
  const twin = card('1954 Topps #128 Hank Aaron Rookie Card - PSA 2', 'baseball', 500, { id: 'rea-9', auctionHouse: 'REA' });
  const alias = card('1954 Topps #128 Hank Aaron Rookie Card - PSA GD 2', 'baseball', 600, { id: 'goldin-1~' });
  const closed = card('1955 Topps #47 Hank Aaron - PSA 5', 'baseball', 700, { saleDateTime: at(-1), saleDate: at(-1).slice(0, 10) });
  const late = card('1956 Topps #31 Hank Aaron - PSA 5', 'baseball', 700, { saleDateTime: at(20), saleDate: at(20).slice(0, 10) });
  const ok = card('1957 Topps #20 Hank Aaron - PSA 5', 'baseball', 700);
  const t = buildTaste({ saved: [{ id: 'goldin-1', lot: seed }], follows: [], nowMs: NOW });
  assert.ok(idAliases('goldin-1').includes('goldin-1~'));
  const got = ids(recommend([seed, twin, alias, closed, late, ok], t, { nowMs: NOW }));
  assert.ok(!got.includes('rea-9') && !got.includes('goldin-1~') && !got.includes(closed.id));
  assert.ok(got.includes(ok.id) && got.includes(late.id));
  assert.ok(!ids(recommend([late, ok], t, { nowMs: NOW, maxDays: 7 })).includes(late.id));
});

test('one seat per card identity; a settled save still seeds from its snapshot', () => {
  const g8 = card('1986 Fleer #57 Michael Jordan Rookie Card - PSA NM-MT 8', 'basketball', 4000);
  const g7 = card('1986 Fleer #57 Michael Jordan Rookie Card - PSA NM 7', 'basketball', 2500, { auctionHouse: 'REA' });
  const other = card('1987 Fleer #59 Michael Jordan - PSA 8', 'basketball', 600);
  const t = buildTaste({ saved: [{ id: 'gone', title: '1990 Fleer #26 Michael Jordan - PSA 9', artist: 'sports-cards', estMid: 300, savedAt: at(-30) }], follows: [], nowMs: NOW });
  assert.equal(t.seeds.length, 1, 'the snapshot seeds');
  const rs = recommend([g8, g7, other], t, { nowMs: NOW });
  const fleer86 = rs.filter(r => /1986 Fleer #57/.test(r.lot.title));
  assert.equal(fleer86.length, 1, 'two grades of one card take one seat');
  assert.match(rs[0].reason, /^Because you watched /, 'a settled save is a watch');
});

test('diversity: a single strong entity cannot wall a mixed desk', () => {
  const a = card('2003 Topps #221 LeBron James Rookie - PSA 9', 'basketball', 3000);
  const b = card('2009 Topps #321 Stephen Curry Rookie - PSA 9', 'basketball', 3000);
  const pool: RecLot[] = [];
  for (let i = 0; i < 10; i++) pool.push(card(`2005 Topps #${10 + i} LeBron James - PSA 9`, 'basketball', 3000));
  for (let i = 0; i < 3; i++) pool.push(card(`2012 Panini #${30 + i} Stephen Curry - PSA 9`, 'basketball', 3000));
  const t = buildTaste({ saved: [{ id: a.id, lot: a }, { id: b.id, lot: b }], follows: [], nowMs: NOW });
  const rs = recommend(pool, t, { nowMs: NOW, n: 8 });
  assert.ok(rs.filter(r => /Curry/.test(r.lot.title)).length >= 2, 'the second player keeps seats');
  assert.ok(rs.filter(r => /LeBron/.test(r.lot.title)).length <= 5);
  assert.equal(scoreLots(pool, t, { nowMs: NOW }).length, 13, 'the unranked scoring keeps everyone');
});

test('a tie by cut speaks about the cut; phone rows lead with the fact', () => {
  const s1 = card('1952 Topps #198 Phil Haugstad Rookie Card - PSA NM-MT 8', 'baseball', 250);
  const s2 = card('1952 Topps #387 Billy Meyer - PSA EX-MT 6', 'baseball', 110);
  const s3 = card('1952 Topps #88 Bob Feller - PSA NM 7', 'baseball', 600);
  const robinson = card('1956 Topps #30 Jackie Robinson - PSA NM-MT 8', 'baseball', 180);
  const feller = card('1949 Bowman #27 Bob Feller - PSA EX-MT 6', 'baseball', 300);
  const t = buildTaste({ saved: [s1, s2, s3].map(l => ({ id: l.id, lot: l })), follows: [], nowMs: NOW });
  const rs = recommend([robinson, feller], t, { nowMs: NOW });
  const rob = rs.find(r => r.lot.id === robinson.id)!;
  assert.match(rob.reason, /^More vintage PSA baseball cards like yours/);
  const fel = rs.find(r => r.lot.id === feller.id)!;
  assert.match(fel.reason, /^Because you saved 1952 Topps #88 Bob Feller/);
  assert.match(recNote(fel, { short: true }), /^Same player · you saved 1952 Topps #88/);
});

test('lotSim gates, bandText, notes, short titles', () => {
  const x = featOf(card('1952 Topps #311 Mickey Mantle - PSA 3', 'baseball', 50000), NOW);
  const y = featOf(card('1952 Topps #311 Mickey Mantle - PSA 1', 'baseball', 20000), NOW);
  const z = featOf(card('2020 Prizm #1 Mike Trout - PSA 10', 'baseball', 500), NOW);
  const s = lotSim(x, y);
  assert.ok(s.card && s.entity && s.sim > 0.7);
  assert.equal(lotSim(x, z).sim, 0, 'a modern stranger at a different price is no tie');
  assert.equal(bandText(20000, 40000), '$20K–40K');
  assert.equal(bandText(800, 1200), '$800–1.2K');
  assert.equal(bandText(2300, 4100), '$2.3K–4.1K');
  assert.equal(bandText(1_500_000, 2_000_000), '$1.5M–2M');
  assert.equal(recNote({ reason: 'Because you saved X', why: ['same player', 'PSA'] }), 'Because you saved X · same player');
  assert.equal(recNote({ reason: 'You follow Charizard', why: ['followed subject'] }), 'You follow Charizard');
  assert.ok(shortTitle('2017 Panini Prizm Silver Prizm #4 Patrick Mahomes II Rookie Card - PSA GEM MT 10').length <= 47);
});
