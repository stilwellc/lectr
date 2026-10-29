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
import { buildTaste, recommend, discoverLots, scoreLots, featOf, rotationOf, ENGINE_NOTE, DISCOVER_DAYS, type RecLot } from '../recs';
import { readSignals, recordSignal, signalsToTaste, VIEWED_DAYS, type KV } from '../recs-signals';
import { reasonKindOf } from '../pick-log';
import { kindFits } from '../object-kind';
import { catFollow } from '../follows';

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
  // (pass 3) a raw, undated single of the same sport at the price is the SPORT CUT's — a real tie now, not the lane's
  assert.deepEqual(rids(disc), [], 'the sport cut reaches the raw single; nothing is left for the lane');
  const raw = recommend([zion, ja, rawNoYear, football], t, { nowMs: NOW }).find(r => r.lot.id === rawNoYear.id)!;
  assert.match(raw.reason, /^More basketball cards near your save’s price/);
  assert.ok(!ids(recommend([zion, ja, rawNoYear, football], t, { nowMs: NOW })).includes(football.id), 'sports never cross');
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

/* ── pass 2: the ladder's anchor law ──────────────────────────────────── */

test('ladder: a Karloff desk never gets a politician — another person needs a shared anchor, and the rung says which', () => {
  // no photos: only the ladder speaks here (the discover lane needs a picture)
  const cut = (title: string, o: Partial<RecLot> = {}) => auto(title, 1000, { imageUrl: null, ...o });
  const desk = [
    cut('Boris Karloff Signed Cut - JSA LOA'),
    cut('Basil Rathbone, Nigel Bruce Dual-Signed Cut - JSA LOA'),
    cut('Audrey Hepburn Signed Film Document for Charade'),
  ];
  const newsom = cut('Gavin Newsom Signed Cut - PSA/DNA Authentic', { drill: null });
  const burney = cut('Charles Burney Autograph Letter Signed to Samuel Wesley, 1789', { drill: null });
  const lugosi = cut('Bela Lugosi Signed Dracula Program (Belfast, 1951)');
  const chaney = cut('Lon Chaney Jr. Signed Wolf Man Photograph');
  const holiday = cut('Billie Holiday Signed Cut - JSA LOA', { drill: 'music' });
  const pool = [...desk, newsom, burney, lugosi, chaney, holiday];
  const t = buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l, savedAt: at(-3) })), follows: [], nowMs: NOW });
  const rows = scoreLots(pool, t, { nowMs: NOW });
  assert.ok(rows.every(r => r.best.ladder), 'nothing ties by name or franchise: every row is the ladder’s');
  const rs = recommend(pool, t, { nowMs: NOW, n: 12 });
  const got = ids(rs);
  assert.ok(!got.includes(newsom.id) && !got.includes(burney.id), `a politician’s cut and an 18th-century letter share nothing but the sub: ${rs.map(r => r.reason).join(' | ')}`);
  assert.ok(!got.includes(holiday.id), 'a music signer’s cut is another domain — the shared paper does not count');
  assert.ok(got.includes(lugosi.id) && got.includes(chaney.id), 'the Universal-monsters pieces come');
  for (const id of [lugosi.id, chaney.id]) {
    const r = rs.find(x => x.lot.id === id)!;
    assert.equal(r.tier, 2);
    assert.match(r.reason, /^Another film & TV figure · you saved /, r.reason);
    assert.ok(r.why.includes('same domain · film & TV'), r.why.join());
  }
});

test('ladder: with no domain to read, an era within 25 years or the same form of object anchors a person; nothing shared deals nothing', () => {
  const doc = (title: string) => auto(title, 1000, { imageUrl: null, drill: null });
  const desk = [doc('Orson Welles Signed Letter to Irving Lazar, 1946'), doc('Orson Welles Typed Letter Signed, 1949')];
  const hemingway = doc('Ernest Hemingway Typed Letter Signed, 1952');
  const dickens = doc('Charles Dickens Autograph Letter Signed, 1855');
  const photo = doc('Ernest Hemingway Signed Photograph');
  const newsom = doc('Gavin Newsom Signed Cut - PSA/DNA Authentic');
  const pool = [...desk, hemingway, dickens, photo, newsom];
  const t = buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l, savedAt: at(-3) })), follows: [], nowMs: NOW });
  const rs = recommend(pool, t, { nowMs: NOW, n: 12 });
  const by = new Map(rs.map(r => [r.lot.id, r]));
  assert.match(by.get(hemingway.id)!.reason, /^Another figure of the 1950s · you saved Orson Welles/, 'dated within 25 years of the desk’s letters');
  assert.match(by.get(dickens.id)!.reason, /^Another signed letter · you saved Orson Welles/, 'a century apart, but a letter like theirs');
  assert.ok(!by.has(photo.id), 'an undated photograph shares neither era nor form');
  assert.ok(!by.has(newsom.id), 'an undated cut from no domain shares nothing');
});

test('ladder: the price-only rung in cards needs an era too — a 2021 raw card is not "more baseball cards at your prices" for a 1952 desk', () => {
  const seed = card('1952 Topps #311 Mickey Mantle - PSA 3', 'baseball', 5000, { imageUrl: null });
  const modern = card('2021 Topps Chrome #44 Joe Nobody', 'baseball', 4000, { imageUrl: null });
  const vintage = card('1958 Topps #47 Hank Aaron', 'baseball', 4500, { imageUrl: null });
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-3) }], follows: [], nowMs: NOW });
  const rows = scoreLots([seed, modern, vintage], t, { nowMs: NOW });
  assert.ok(!rows.some(r => r.l.id === modern.id && r.best.ladder), 'no rung reaches it');
  // (pass 3) the SPORT CUT reaches it as a weak real tie — last, and saying only the cut
  const rs = recommend([seed, modern, vintage], t, { nowMs: NOW, n: 12 });
  assert.deepEqual(ids(rs), [vintage.id, modern.id]);
  assert.match(rs[0].reason, /^More vintage baseball cards like yours/);
  assert.equal(rs[1].reason, 'More baseball cards near your save’s price');
  assert.ok(!/at your save/.test(rs[1].reason), 'never the ladder’s price-level claim');
});

test('discover: a cut with a sport asks for that sport — a card the taxonomy cannot place is not "baseball cards"', () => {
  const seed = card('1960 Topps #350 Mickey Mantle - PSA 4', 'baseball', 300);
  const nowhere = card('Jeremiah Smith Signed Custom Trading Card - Beckett', 'racing', 280, { drill: null, subCat: 'cards' });
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-3) }], follows: [], nowMs: NOW });
  const f = featOf(nowhere, NOW);
  if (f.sport == null) assert.ok(!rids(discoverLots([seed, nowhere], t, { nowMs: NOW })).includes(nowhere.id), 'no sport read: not the baseball cut’s');
  else assert.ok(f.sport !== 'baseball');
});

/* ── pass 3: the kind gate, the sport cut ─────────────────────────────── */

test('object kind: a Type I photo, a replica jersey or a painted shikishi under a card sub is not a card; the parallels named after them are', () => {
  const c = (title: string, drill = 'baseball', artist = 'sports-cards', subCat = 'cards') => ({ artist, title, subCat, drill });
  assert.equal(kindFits(c('Roy Campanella Original Type I News Service Photo by I.N.P. - As Seen on His 1952 Topps Card')), false);
  assert.equal(kindFits(c('1957 Jim Brown Rookie Card-Used Type I Original Photo by Noted Photographer Henry Barr', 'football')), false);
  assert.equal(kindFits(c('96 Michael Jordan Signed Type I Original Photo - Stunning Silver Signature', 'basketball')), false);
  assert.equal(kindFits(c('2024 Caitlin Clark Signed & Inscribed Iowa Hawkeyes Final Four Replica Jersey (#17/122) - Panini', 'basketball')), false);
  assert.equal(kindFits(c('Mitsuhiro Arita Painted, Signed Charizard Shikishi - Ink, Marker on Washi Paper Art Board', 'modern', 'pokemon', 'pokemon-cards')), false);
  assert.equal(kindFits(c('1989 Topps Secondary Offering Poster')), false);
  // cards named after the things they are not
  assert.equal(kindFits(c('1948 Topps Magic Photo #6K Babe Ruth (HOF) - PSA VG-EX 4')), true);
  assert.equal(kindFits(c('2020 Panini Contenders Rookie Ticket Autographs Gold #RRT-TTA Tua Tagovailoa - PSA 10', 'football')), true);
  assert.equal(kindFits(c('2018 Panini Flawless #1 Tom Brady (#12/15) Jersey Number Card - BGS GEM MINT 9.5', 'football')), true);
  assert.equal(kindFits(c('00 Upper Deck Game Jersey #GJ37 Grant Hill Game-Used Patch Card - PSA NM-MT 8', 'basketball')), true);
  assert.equal(kindFits(c('1968 Topps #492 Jeff Torborg (No Ink at Upper Left of Photo) - PSA MINT 9')), true);
  // and the lane / the cut never sell a photo as "baseball cards"
  const seed = card('1960 Topps #350 Mickey Mantle - PSA 4', 'baseball', 300);
  const photo = card('Roy Campanella Original Type I News Service Photo by I.N.P. - As Seen on His 1952 Topps Card', 'baseball', 320);
  const t = buildTaste({ saved: [{ id: seed.id, lot: seed, savedAt: at(-3) }], follows: [], nowMs: NOW });
  assert.deepEqual(ids(recommend([seed, photo], t, { nowMs: NOW })), []);
});

test('the sport cut: a one-card desk in any sport gets its sport’s singles near its price, honestly worded — hockey, football, a Pokémon single', () => {
  const hockey = card('1980 O-Pee-Chee #18 Wayne Gretzky Rookie Card - PSA VG 3', 'hockey', 560);
  const celebrini = card('2024 Upper Deck #451 Macklin Celebrini - PSA MINT 9', 'hockey', 813);
  const mcdavid = card('2021 Upper Deck Allure Red Rainbow Autographs #50 Connor McDavid - PSA 10', 'hockey', 347);
  const howe = card('1955 Topps #8 Gordie Howe - PSA VG-EX 4', 'hockey', 126);
  const bird = card('1981 Topps Scoring Leader Bird/Erving/Johnson - PSA 8', 'basketball', 600);
  const th = buildTaste({ saved: [{ id: hockey.id, lot: hockey, savedAt: at(-3) }], follows: [], nowMs: NOW });
  const rh = recommend([hockey, celebrini, mcdavid, howe, bird], th, { nowMs: NOW });
  assert.deepEqual(ids(rh).sort(), [celebrini.id, mcdavid.id].sort(), `the two hockey singles near $560; a $126 Howe is not near, basketball never: ${rh.map(r => r.reason).join(' | ')}`);
  for (const r of rh) { assert.equal(r.reason, 'More hockey cards near your save’s price'); assert.equal(r.tier, 1); }
  const brady = card('2000 Playoff Contenders #144 Tom Brady Rookie Ticket - PSA 6', 'football', 9000);
  // another era, no shared facet (the save is PSA, this is raw): only the sport cut reaches it
  const mahomes = card('1998 Playoff Contenders #87 Peyton Manning Rookie Ticket - raw', 'football', 7000);
  const tf = buildTaste({ saved: [{ id: brady.id, lot: brady, savedAt: at(-3) }], follows: [], nowMs: NOW });
  const rf = recommend([brady, mahomes, bird], tf, { nowMs: NOW });
  assert.deepEqual(ids(rf), [mahomes.id]);
  assert.match(rf[0].reason, /^More football cards near your save’s price/);
  const zard = { id: 'pz1', artist: 'pokemon', title: '1999 Pokemon Base Set Holo #4 Charizard - PSA 8', subCat: 'pokemon-cards', drill: 'vintage', auctionHouse: 'Goldin', saleDate: at(2).slice(0, 10), saleDateTime: at(2), currentBid: 3000, bidCount: 12, currency: 'USD', status: 'upcoming', imageUrl: PHOTO } as RecLot;
  const pika = { ...zard, id: 'pz2', title: '1999 Pokemon Base Set Holo #58 Pikachu', currentBid: 2200 } as RecLot;
  const modern = { ...zard, id: 'pz3', title: '2023 Pokemon Obsidian Flames #223 Charizard ex - PSA 10', drill: 'modern', currentBid: 2500 } as RecLot;
  const tp = buildTaste({ saved: [{ id: zard.id, lot: zard, savedAt: at(-3) }], follows: [], nowMs: NOW });
  const rp = recommend([zard, pika, modern], tp, { nowMs: NOW });
  const pk = rp.find(r => r.lot.id === pika.id)!;
  assert.ok(pk, 'a raw Base Set single of the same sub at the price ties');
  assert.match(pk.reason, /^More Pokémon cards near your save’s price/);
  assert.ok(rp.find(r => r.lot.id === modern.id)?.why.includes('same Pokémon'), 'the modern Charizard ties by name, not by the cut');
});

test('price holds without a band: a grail far above two saves sinks below their peers; an unpriced lot does not lead; a bare category follow leans to the category’s level', () => {
  const tcg = (title: string, bid: number | null, o: Partial<RecLot> = {}): RecLot => ({
    id: `pk-${++seq}`, artist: 'pokemon', title, subCat: 'pokemon-cards', drill: 'vintage', auctionHouse: 'Goldin', saleName: 'Weekly', saleDate: at(3).slice(0, 10),
    saleDateTime: at(3), currentBid: bid, bidCount: bid ? 8 : 0, currency: 'USD', status: 'upcoming', imageUrl: PHOTO, ek: 'sj:tcg|k:venusaur', ...o,
  });
  // two saves: too few for a learned band — the span still holds price
  const desk = [tcg('1999 Pokemon Base Set Shadowless Holo #15 Venusaur - PSA 8', 2800), tcg('1999 Pokemon Base Set Holo #15 Venusaur - PSA 7', 2800)];
  const peer = tcg('2000 Pokemon Gym Challenge 1st Edition Holo #4 Erika\'s Venusaur - PSA 8', 2600);
  const grail = tcg('2000 Pokemon Black Star Promo Holo #13 Venusaur - PSA 10', 178000);
  const unpriced = tcg('1999 Pokemon Jungle Holo #15 Venusaur - PSA 8', null);
  const t = buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l, savedAt: at(-3) })), follows: [], nowMs: NOW });
  assert.equal(t.bands.size, 0, 'no learned band');
  const rs = recommend([...desk, peer, grail, unpriced], t, { nowMs: NOW });
  assert.equal(rs[0].lot.id, peer.id, `the peer at the desk’s price leads: ${rs.map(r => `${r.lot.title.slice(0, 30)} ${r.score}`).join(' | ')}`);
  assert.ok(rs.findIndex(r => r.lot.id === grail.id) > 0, 'a 60× grail of the same name is still dealt, below');
  assert.ok(rs.findIndex(r => r.lot.id === unpriced.id) > 0, 'no price yet: not first');
  // a bare Prints follow: the category's live level, not its grails
  const pr = (title: string, lo: number) => ({ id: `pr-${++seq}`, artist: 'misc-artist', title, subCat: 'prints', auctionHouse: 'Phillips', saleName: 'Editions', saleDate: at(5).slice(0, 10), estimateLow: lo, estimateHigh: lo * 1.4, currency: 'USD', status: 'upcoming', imageUrl: PHOTO } as RecLot);
  const prints = [150000, 69000, ...Array.from({ length: 14 }, (_, i) => 2000 + i * 500)].map((p, i) => pr(`Print ${i}`, p));
  const tf = buildTaste({ saved: [], follows: [catFollow('fine-art', 'prints')], nowMs: NOW });
  const rf = recommend(prints, tf, { nowMs: NOW, n: 6 });
  assert.ok(rf.every(r => Number(r.lot.estimateLow) < 50000), `the first six are at the category’s level: ${rf.map(r => r.lot.estimateLow).join(',')}`);
});
