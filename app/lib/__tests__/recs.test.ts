/**
 * "Lots you may like" (app/lib/recs): the taste profile weighs owned > saved
 * > followed > searched, similarity needs a real tie (entity, card,
 * franchise, line, or a distinctive facet inside one sub), sports and
 * categories never cross, the desk never comes back as a pick, every pick
 * says why, and a reader with no signals gets no picks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaste, recommend, scoreLots, featOf, lotSim, bandText, recNote, shortTitle, idAliases, learnBands, bandFit, pickStrips, tonightEndMs, familyOf, ENGINE_NOTE, BAND_MIN, type RecLot, type Seed } from '../recs';
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
  assert.equal(rs[0].lot.id, 'z1');
  assert.equal(rs[0].reason, 'You follow Charizard');
  // the other Pokémon is no follow match — only the fallback ladder's
  // family rung reaches it, after the real tie, and it says so
  assert.equal(rs[1]?.tier, 2);
  assert.equal(rs[1].reason, 'Another Pokémon · you follow Charizard');
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

/* ── Oct 11: price bands, the engine's flag, freshness, the ladder, the return loop ── */

test('price band: median ± robust spread in log space, n-gated, owned counts twice', () => {
  const seed = (logA: number, kind: Seed['kind'] = 'saved'): Seed => ({ kind, w: 1, label: 'x', f: { ...featOf(card(`1955 Topps #${++seq} Test Player - PSA 5`, 'baseball', 100), NOW), logA } });
  assert.equal(learnBands([seed(2.3), seed(2.4)]).size, 0, `fewer than ${BAND_MIN} priced lots → no band`);
  const b = learnBands([seed(2.3), seed(2.4), seed(2.5), seed(5)]).get('sports-cards')!;
  assert.ok(b && b.n === 4);
  assert.ok(b.hi < 3.5, 'one $100K outlier on a $300 desk does not stretch the band');
  assert.ok(b.lo <= 2.3 && b.hi >= 2.5, 'the desk itself sits inside');
  const own = learnBands([seed(2, 'owned'), seed(3)]).get('sports-cards');
  assert.equal(own?.n, 3, 'an owned lot weighs twice');
  const fit = (logA: number | null) => bandFit({ cat: 'sports-cards', logA }, new Map([['sports-cards', b]]));
  assert.equal(fit(2.4).fit, 1);
  assert.ok(fit(2.4).inside);
  assert.ok(fit(5).fit >= 0.45 && fit(5).fit < 0.5, 'far outside: soft floor, never a filter');
  assert.equal(bandFit({ cat: 'fine-art', logA: 4 }, new Map()).fit, 1, 'no band → no effect');
});

test('price band: a budget desk ranks the in-band card first and cites the band only when true', () => {
  const saves = [120, 180, 260, 300].map((p, i) => card(`1956 Topps #${200 + i} Budget Player${i} - PSA 5`, 'baseball', p));
  const cheap = card('1957 Topps #44 Budget Player0 - PSA 5', 'baseball', 200);
  const dear = card('1952 Topps #12 Budget Player1 - PSA 8', 'baseball', 60000);
  const t = buildTaste({ saved: saves.map(l => ({ id: l.id, lot: l })), follows: [], nowMs: NOW });
  assert.ok(t.bands.get('sports-cards'));
  const rs = recommend([dear, cheap], t, { nowMs: NOW });
  assert.equal(rs[0].lot.id, cheap.id);
  assert.ok(rs[0].inBand);
  const d = rs.find(r => r.lot.id === dear.id);
  if (d) {
    assert.ok(!d.inBand);
    assert.ok(!/in your \$/.test(d.reason) && !d.why.some(w => /in your \$/.test(w)), 'an off-band pick never claims the band');
  }
  assert.ok(/\$/.test(recNote(rs[0])), 'the in-band pick prints a band');
});

test('engine: a flagged lot that truly ties is lifted and says so; a flagged stranger stays out', () => {
  const seed = print('andy-warhol', 'Flowers (F. & S. II.64)', 20000, 30000);
  const plain = print('andy-warhol', 'Cow (F. & S. II.11)', 20000, 30000, { signal: null });
  const flagged = print('andy-warhol', 'Mick Jagger (F. & S. II.138)', 20000, 30000, { signal: { label: 'Below Market' } });
  const stranger = card('1990 Fleer #1 Nobody - PSA 9', 'baseball', 25000, { signal: { label: 'Below Market' } });
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed }], follows: [], nowMs: NOW });
  const rs = recommend([plain, flagged, stranger], t, { nowMs: NOW });
  assert.deepEqual(ids(rs), [flagged.id, plain.id]);
  assert.ok(rs[0].flagged && rs[0].reason.endsWith(ENGINE_NOTE));
  assert.ok(!rs[1].flagged && !rs[1].reason.includes(ENGINE_NOTE), 'never on an unflagged lot');
});

test('freshness: closed and results-pending-past-close lots never come back, day over day', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA 3', 'baseball', 50000);
  const today = card('1956 Topps #135 Mickey Mantle - PSA 5', 'baseball', 9000, { saleDateTime: at(0.5), saleDate: at(0.5).slice(0, 10) });
  const later = card('1957 Topps #95 Mickey Mantle - PSA 5', 'baseball', 9000, { saleDateTime: at(4), saleDate: at(4).slice(0, 10) });
  const pend = card('1958 Topps #150 Mickey Mantle - PSA 5', 'baseball', 9000, { saleDateTime: at(-0.2), saleDate: at(-0.2).slice(0, 10), resultsPending: true } as Partial<RecLot>);
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed }], follows: [], nowMs: NOW });
  const d0 = ids(recommend([today, later, pend], t, { nowMs: NOW }));
  assert.ok(d0.includes(today.id) && d0.includes(later.id) && !d0.includes(pend.id));
  const d1 = ids(recommend([today, later, pend], t, { nowMs: NOW + 864e5 }));
  assert.deepEqual(d1, [later.id], 'the lot that closed overnight rotates out');
});

test('fallback ladder: a thin follow fills by family after the real tie, saying its rung; never across sports', () => {
  const ewing = card('1986 Fleer #32 Patrick Ewing Rookie - PSA 8', 'basketball', 300);
  const olajuwon = card('1986 Fleer #82 Hakeem Olajuwon Rookie - PSA 8', 'basketball', 250);
  const baseball = card('1986 Fleer #1 Wade Boggs - PSA 8', 'baseball', 250);
  const t = buildTaste({ saved: [], follows: [{ kind: 'maker', key: 'patrick-ewing', label: 'Patrick Ewing' }], nowMs: NOW });
  const rs = recommend([olajuwon, ewing, baseball], t, { nowMs: NOW });
  assert.equal(rs[0].lot.id, ewing.id);
  assert.equal(rs[0].tier, 1);
  const h = rs.find(r => r.lot.id === olajuwon.id)!;
  assert.equal(h.tier, 2);
  assert.match(h.reason, /^Another .*basketball player · you follow Patrick Ewing$/);
  assert.ok(!ids(rs).includes(baseball.id), 'the ladder never crosses sports');
  assert.equal(familyOf(featOf(ewing, NOW)), familyOf(featOf(olajuwon, NOW)));
  // a taste with plenty of real ties never opens the ladder
  const many: RecLot[] = [];
  for (let i = 0; i < 60; i++) many.push(card(`19${60 + (i % 30)} Topps #${i} Patrick Ewing - PSA 8`, 'basketball', 300));
  assert.ok(scoreLots([...many, olajuwon], t, { nowMs: NOW }).every(r => !r.best.ladder));
});

test('return loop: closing tonight soonest first, new-since-last-visit without repeats, honest empties', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA 3', 'baseball', 50000);
  const soon = card('1956 Topps #135 Mickey Mantle - PSA 5', 'baseball', 9000, { saleDateTime: at(0.1), saleDate: at(0.1).slice(0, 10) });
  const fresh = card('1957 Topps #95 Mickey Mantle - PSA 5', 'baseball', 9000, { saleDateTime: at(4), saleDate: at(4).slice(0, 10) });
  const old = card('1958 Topps #150 Mickey Mantle - PSA 5', 'baseball', 9000, { saleDateTime: at(5), saleDate: at(5).slice(0, 10) });
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed }], follows: [], nowMs: NOW });
  const rs = recommend([soon, fresh, old], t, { nowMs: NOW });
  const isNew = (l: RecLot) => l.id === fresh.id || l.id === soon.id;
  const s = pickStrips(rs, { isNew, nowMs: NOW, closesBy: NOW + 6 * 3_600_000 });
  assert.deepEqual(ids(s.closing), [soon.id]);
  assert.deepEqual(ids(s.fresh), [fresh.id], 'a pick closing tonight is not repeated under new');
  const none = pickStrips(rs, { isNew: () => false, nowMs: NOW, closesBy: NOW + 60_000 });
  assert.equal(none.fresh.length + none.closing.length, 0);
  const end = tonightEndMs(NOW);
  assert.ok(end > NOW && end - NOW <= 24 * 3_600_000 && new Date(end).getHours() === 4);
});

/* ── merge round (Oct 11): the stated price range + one seed's share ───── */

test('a stated price range is a strong band, not a filter: inside leads, outside sinks but stays', () => {
  const follow = entityFollow('pl:michael-jordan', 'Michael Jordan');
  const pool = [
    card('1986 Fleer #57 Michael Jordan Rookie - PSA 9', 'basketball', 40000, { playerSlug: 'michael-jordan' }),
    card('1990 Fleer #26 Michael Jordan - PSA 9', 'basketball', 400, { playerSlug: 'michael-jordan' }),
    card('1991 Upper Deck #44 Michael Jordan - PSA 9', 'basketball', 600, { playerSlug: 'michael-jordan' }),
  ];
  const free = recommend(pool, buildTaste({ saved: [], follows: [follow], nowMs: NOW }), { nowMs: NOW });
  const said = recommend(pool, buildTaste({ saved: [], follows: [follow], price: { minUsd: null, maxUsd: 5000 }, nowMs: NOW }), { nowMs: NOW });
  assert.equal(said.length, free.length, 'nothing is hidden by a stated range');
  assert.ok(said.slice(0, 2).every(r => Number(r.lot.currentBid) < 1000) /* anchors ~$1.7K–2.5K */, said.map(r => r.lot.title).join(' | '));
  assert.equal(Number(said[said.length - 1].lot.currentBid), 40000, 'the $40K rookie sinks to the bottom');
  assert.match(said[0].reason, /under your \$5K cap/);
});

test('one seed fills at most ~40% of the seats while another seed still has lots', () => {
  const a = card('1986 Fleer #57 Michael Jordan - PSA 8', 'basketball', 5000, { playerSlug: 'michael-jordan' });
  const b = card('1952 Topps #311 Mickey Mantle - PSA 3', 'baseball', 5000, { playerSlug: 'mickey-mantle' });
  const houses = ['Goldin', 'Heritage', 'PWCC'];
  const pool: RecLot[] = [];
  for (let i = 0; i < 30; i++) pool.push(card(`19${60 + i} Topps #${i + 1} Michael Jordan - PSA ${8 + (i % 2)}`, 'basketball', 4000 + i * 10, { playerSlug: 'michael-jordan', saleName: `Sale ${i % 6}`, auctionHouse: houses[i % 3] }));
  for (let i = 0; i < 30; i++) pool.push(card(`${1950 + i} Bowman #${i + 1} Mickey Mantle - PSA ${2 + (i % 3)}`, 'baseball', 4000 + i * 10, { playerSlug: 'mickey-mantle', saleName: `Sale ${i % 6}`, auctionHouse: houses[i % 3] }));
  // one "More like this" (.7) on Jordan, a weak looked-at (.25) on Mantle
  const t = buildTaste({ saved: [], follows: [], extra: [{ lot: a, weight: 0.7, reason: 'asked for more like' }, { lot: b, weight: 0.25, reason: 'looked at' }], nowMs: NOW });
  const rs = recommend(pool, t, { n: 24, nowMs: NOW });
  const jordan = rs.filter(r => /Jordan/.test(r.lot.title)).length;
  assert.ok(rs.length >= 20, `${rs.length}`);
  // the cap lifts one seat at a time once both seeds sit at it — the deal
  // stays near half-and-half, never 70/30
  const first20 = rs.slice(0, 20).filter(r => /Jordan/.test(r.lot.title)).length;
  assert.ok(first20 <= Math.ceil(24 * 0.4), `Jordan took ${first20} of the first 20`);
  assert.ok(jordan <= 13, `Jordan took ${jordan} of ${rs.length}`);
  assert.ok(rs.length - jordan >= 11, 'the other taste keeps its seats');
});

test('a one-seed taste still fills past the share cap (never a short list)', () => {
  const houses = ['Goldin', 'Heritage', 'PWCC'];
  const pool: RecLot[] = [];
  for (let i = 0; i < 30; i++) pool.push(card(`19${60 + i} Topps #${i + 1} Michael Jordan - PSA ${8 + (i % 2)}`, 'basketball', 4000 + i * 10, { playerSlug: 'michael-jordan', saleName: `Sale ${i % 6}`, auctionHouse: houses[i % 3] }));
  const t = buildTaste({ saved: [], follows: [entityFollow('pl:michael-jordan', 'Michael Jordan')], nowMs: NOW });
  const rs = recommend(pool, t, { n: 24, nowMs: NOW });
  assert.ok(rs.length > Math.ceil(24 * 0.4), `${rs.length}`);
});
