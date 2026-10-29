/**
 * "Lots you may like" — the Oct 29 round (the owner: "a horrible job finding
 * interesting lots"): the DISCOVER lane deals a quarter of the seats to lots
 * no real tie reaches but the reader's cut does (same category · sub, their
 * price, a photo, closing inside two weeks), interleaved and honestly worded;
 * ROTATION moves near-equal rows by the day and holds them within it; a lot
 * this device saw the reader OPEN lately is not dealt back unless the engine
 * reads it below market.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaste, recommend, discoverLots, rotationOf, ENGINE_NOTE, DISCOVER_DAYS, type RecLot } from '../recs';
import { readSignals, recordSignal, signalsToTaste, VIEWED_DAYS, type KV } from '../recs-signals';
import { reasonKindOf } from '../pick-log';

// local noon: a day's rotation reads the reader's calendar
const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime();
const DAY = 864e5;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();
const PHOTO = 'https://img.example/lot.jpg';
let seq = 0;

/** a Hollywood autograph (entertainment · autographs): about WHO — only a
 *  name or a franchise ties two of them (no facet or price tie) */
function auto(title: string, est = 1000, o: Partial<RecLot> = {}): RecLot {
  return {
    id: `a-${++seq}`, artist: 'entertainment-memorabilia', title, subCat: 'autographs', drill: 'hollywood', auctionHouse: 'RR Auction',
    saleName: 'Hollywood', saleDate: at(4).slice(0, 10), saleDateTime: at(4), estimateLow: est * 0.8, estimateHigh: est * 1.2, currency: 'USD',
    status: 'upcoming', imageUrl: PHOTO, ...o,
  };
}
function card(title: string, sport: string, bid: number, o: Partial<RecLot> = {}): RecLot {
  return {
    id: `c-${++seq}`, artist: 'sports-cards', title, subCat: 'cards', drill: sport, auctionHouse: 'Goldin', saleName: 'Weekly',
    saleDate: at(5).slice(0, 10), saleDateTime: at(5), currentBid: bid, bidCount: 6, currency: 'USD', status: 'upcoming', imageUrl: PHOTO, ...o,
  };
}
const ids = (rs: { lot: RecLot }[]) => rs.map(r => r.lot.id);
/** scoreLots / discoverLots rows carry the lot as `l` */
const rids = (rs: { l: RecLot }[]) => rs.map(r => r.l.id);

/** three film signers on the desk (no one franchise), nine real ties live */
function filmDesk() {
  const desk = [
    auto('Mark Hamill Signed Luke Skywalker Photograph from Star Wars'),
    auto('Tom Hanks Signed Forrest Gump Photograph'),
    auto('Harrison Ford Signed Indiana Jones Photograph'),
  ];
  const ties = [
    auto('Carrie Fisher Signed Princess Leia Photograph from Star Wars'),
    auto('Anthony Daniels Signed C-3PO Photograph from Star Wars'),
    auto('Peter Mayhew Signed Chewbacca Photograph from Star Wars'),
    auto('Billy Dee Williams Signed Lando Photograph from Star Wars'),
    auto('Tom Hanks Signed Cast Away Photograph'),
    auto('Tom Hanks Signed Big Photograph'),
    auto('Tom Hanks Signed Apollo 13 Photograph'),
    auto('Harrison Ford Signed Blade Runner Photograph'),
    auto('Harrison Ford Signed Witness Photograph'),
  ];
  return { desk, ties, taste: buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l, savedAt: at(-3) })), follows: [], nowMs: NOW }) };
}

test('discover: a sibling in the cut at your price, with a photo, closing soon — no name shared — is dealt, says "New to you", and claims no tie', () => {
  const { desk, ties, taste } = filmDesk();
  const houdini = auto('Harry Houdini Signed Photograph');
  const ball = auto('Lucille Ball Signed Photograph');
  const bogart = auto('Humphrey Bogart Signed Photograph');
  const noPhoto = auto('Bette Davis Signed Photograph', 1000, { imageUrl: null });
  const farOff = auto('Cary Grant Signed Photograph', 1000, { saleDate: at(DISCOVER_DAYS + 6).slice(0, 10), saleDateTime: at(DISCOVER_DAYS + 6) });
  const dear = auto('Marilyn Monroe Signed Photograph', 40000);
  const elvis = auto('Elvis Presley Signed Photograph', 1000, { drill: 'music' });
  const pool = [...desk, ...ties, houdini, ball, bogart, noPhoto, farOff, dear, elvis];
  const disc = discoverLots(pool, taste, { nowMs: NOW });
  assert.deepEqual(rids(disc).sort(), [houdini.id, ball.id, bogart.id].sort(), 'only the priced, pictured, soon-closing film siblings');
  const rs = recommend(pool, taste, { nowMs: NOW, n: 12 });
  const lanes = rs.map(r => r.lane ?? 'tie');
  assert.deepEqual([lanes[2], lanes[6], lanes[10]], ['discover', 'discover', 'discover'], `every fourth seat from the third: ${lanes.join(' ')}`);
  assert.equal(lanes.filter(x => x === 'discover').length, 3, 'a quarter of 12');
  for (const r of rs.filter(r => r.lane === 'discover')) {
    assert.match(r.reason, /^New to you · film & TV pieces (?:near your saves’ prices|in your \$[\d.]+K?–\$?[\d.]+K? range)$/, r.reason);
    assert.doesNotMatch(r.reason, /Because you|Like your|You follow/, 'never a tie that is not there');
    assert.equal(r.why[0], 'new to you');
    assert.equal(reasonKindOf(r), 'discover');
  }
  for (const r of rs.filter(r => r.lane !== 'discover')) assert.doesNotMatch(r.reason, /^New to you/);
  assert.ok(!ids(rs).some(id => [noPhoto.id, farOff.id, dear.id, elvis.id].includes(id)), 'no photo, three weeks out, forty times the price, or another domain: not dealt');
  // the engine's read rides on the lane's reason, as on every pick
  const flaggedPool = [...desk, ...ties, { ...houdini, signal: { label: 'Below Market' } }];
  const f = recommend(flaggedPool, taste, { nowMs: NOW, n: 12 }).find(r => r.lot.id === houdini.id)!;
  assert.ok(f && f.lane === 'discover' && f.flagged && f.reason.endsWith(ENGINE_NOTE), f?.reason);
  // the lane is a quarter, never more: at n = 24 with the ties run dry it closes the list
  const r24 = recommend(pool, taste, { nowMs: NOW, n: 24 });
  assert.equal(r24.filter(r => r.lane === 'discover').length, 3);
  // shut by the eval's knob
  assert.ok(recommend(pool, taste, { nowMs: NOW, n: 12, tune: { discover: 0 } }).every(r => r.lane !== 'discover'));
});

test('discover: never a lot a real tie already reaches, never one "Not for me" quieted, never across sports', () => {
  const zion = card('2019 Panini Prizm #248 Zion Williamson Rookie - PSA 10', 'basketball', 300);
  const ja = card('2019 Panini Prizm #249 Ja Morant Rookie - PSA 10', 'basketball', 280);
  const rawNoYear = card('Panini Prizm Silver Luka Doncic', 'basketball', 300);
  const football = card('Panini Prizm Silver Joe Burrow', 'football', 300);
  const t = buildTaste({ saved: [{ id: zion.id, lot: zion }], follows: [], nowMs: NOW });
  const disc = discoverLots([zion, ja, rawNoYear, football], t, { nowMs: NOW });
  assert.ok(!rids(disc).includes(ja.id), 'a same-era PSA rookie is a real tie (the cut tie), not a discovery');
  assert.deepEqual(rids(disc), [rawNoYear.id], 'a raw, undated single of the same sport at the price is the lane’s');
  assert.ok(!rids(disc).includes(football.id), 'sports never cross');
  const quiet = buildTaste({ saved: [{ id: zion.id, lot: zion }], follows: [], negative: { lots: [rawNoYear], ids: [] }, nowMs: NOW });
  const key = Array.from(quiet.down!.keys()).find(k => k.startsWith('cut:'));
  assert.ok(key, 'a nameless pass quiets its cut');
  // a pass on the discovered lot's own name shuts the lane for that name
  const named = buildTaste({ saved: [{ id: zion.id, lot: zion }], follows: [], negative: { keys: ['pl:luka-doncic'], ids: [] }, nowMs: NOW });
  assert.ok(discoverLots([zion, ja, rawNoYear], named, { nowMs: NOW }).every(r => r.l.id !== rawNoYear.id || !r.f.ek || r.f.ek !== 'pl:luka-doncic'));
});

test('rotation: near-equal rows move from one day to the next and hold within a day; off, the list never moves', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA 3', 'baseball', 5000);
  const houses = ['Goldin', 'Heritage', 'PWCC', 'REA'];
  // two dozen near-equal cut ties (vintage PSA baseball at the save's price)
  const pool: RecLot[] = [];
  for (let i = 0; i < 24; i++) pool.push(card(`19${55 + i} Topps #${i + 1} Ty Player${i} - PSA 5`, 'baseball', 3000 + i, { auctionHouse: houses[i % 4], saleName: `S${i % 6}` }));
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-1) }], follows: [], nowMs: NOW });
  // the whole pool is dealt, so the days differ only in their seats (a
  // shorter deal rightly also swaps near-equal lots at its edge)
  const dealt = (nowMs: number, rotate?: number) => ids(recommend(pool, t, { nowMs, n: 24, tune: rotate == null ? undefined : { rotate } }));
  const today = dealt(NOW), later = dealt(NOW + 3 * 3600e3), tomorrow = dealt(NOW + DAY);
  assert.deepEqual(later, today, 'the same local day deals the same list');
  assert.notDeepEqual(tomorrow, today, 'the next day deals it differently');
  assert.deepEqual(new Set(tomorrow), new Set(today), 'the same lots — only their seats move');
  assert.deepEqual(dealt(NOW + DAY, 0), dealt(NOW, 0), 'with rotation off the two days agree');
  // the shuffle is seeded by the date and the taste, not the clock or the object
  const spin = rotationOf(NOW, t), again = rotationOf(NOW + 3600e3, buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-1) }], follows: [], nowMs: NOW }));
  assert.equal(spin('x'), again('x'));
  assert.notEqual(rotationOf(NOW + DAY, t)('x'), spin('x'));
  const u = pool.map(l => spin(l.id));
  assert.ok(u.every(x => x >= 0 && x < 1));
  // a clear winner (the save's own card in another grade) keeps its seat whatever the day
  const big = card('1952 Topps #311 Mickey Mantle - PSA 5', 'baseball', 9000, { auctionHouse: 'Heritage' });
  for (const d of [0, 1, 2, 3]) assert.equal(recommend([...pool, big], t, { nowMs: NOW + d * DAY, n: 24 })[0].lot.id, big.id);
});

test('viewed: a lot this device saw the reader open in the last 7 days stays out — unless the engine now reads it below market', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA 3', 'baseball', 5000);
  const seen = card('1956 Topps #135 Mickey Mantle - PSA 5', 'baseball', 3000);
  const stale = card('1957 Topps #95 Mickey Mantle - PSA 5', 'baseball', 3000);
  const other = card('1958 Topps #150 Mickey Mantle - PSA 5', 'baseball', 3000);
  const m = new Map<string, string>();
  const kv: KV = { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
  recordSignal('lot', seen.id, { lot: seen }, kv, NOW - 2 * DAY);
  recordSignal('comps', stale.id, { lot: stale }, kv, NOW - (VIEWED_DAYS + 1) * DAY);
  const { extra, negative } = signalsToTaste(readSignals(kv, NOW), NOW);
  assert.deepEqual(Array.from(negative.viewed ?? []), [seen.id], 'only the recent open is handed over as seen');
  const saved = [{ id: seed.id, lot: seed, savedAt: at(-1) }];
  const t = buildTaste({ saved, follows: [], extra, negative, nowMs: NOW });
  assert.ok(t.viewed?.has(seen.id));
  const got = ids(recommend([seen, stale, other], t, { nowMs: NOW }));
  assert.ok(!got.includes(seen.id), 'opened two days ago: not dealt back');
  assert.ok(got.includes(stale.id) && got.includes(other.id), 'an eight-day-old open comes back');
  // below market now: it earns its seat back, and says so
  const flagged = { ...seen, signal: { label: 'Below Market' } };
  const back = recommend([flagged, stale, other], t, { nowMs: NOW }).find(r => r.lot.id === seen.id);
  assert.ok(back && back.reason.endsWith(ENGINE_NOTE), back?.reason);
  // the plain input works without the store
  const direct = buildTaste({ saved, follows: [], negative: { viewed: [other.id] }, nowMs: NOW });
  assert.ok(!ids(recommend([seen, stale, other], direct, { nowMs: NOW })).includes(other.id));
});
