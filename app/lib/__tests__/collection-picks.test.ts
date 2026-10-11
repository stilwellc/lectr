/**
 * "For your collection" (N3) — identity precision. Every tie below is read
 * against its near misses: the same player in another set or year, the
 * parallel beside the base card, the 1st Edition beside Unlimited, a
 * 1969-70 card beside a 1970-71 one, Campbell's Soup I beside II, Flowers
 * beside Flowers (Hand-Colored), another maker's print "from" the same
 * name. Zero cross-identity matches is the bar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../types';
import {
  collectionPicks, seriesOf, seriesKeyEq, fsNumberOf, sameMember, tcgSetName, watchRefKey,
  type HeldInput, type CollectionPick,
} from '../collection-picks';

const NOW = Date.parse('2026-10-09T20:00:00Z');
const at = (days: number) => new Date(NOW + days * 864e5).toISOString();
let seq = 0;
function lot(o: Partial<AuctionLot> & { title: string; artist: string }): AuctionLot {
  return {
    id: `l-${++seq}`, category: 'object', imageUrl: '', auctionHouse: 'Goldin', saleName: 'Weekly',
    saleDate: at(3).slice(0, 10), saleDateTime: at(3), lotNumber: seq, currency: 'USD', status: 'upcoming', url: '',
    ...o,
  } as AuctionLot;
}
const card = (title: string, sport = 'baseball', o: Partial<AuctionLot> = {}) =>
  lot({ title, artist: 'sports-cards', subCat: 'cards', drill: sport, currentBid: 500, bidCount: 4, ...o, ...({ sport } as object) });
const poke = (title: string, o: Partial<AuctionLot> = {}) => lot({ title, artist: 'pokemon', subCat: 'pokemon-cards', drill: 'vintage', currentBid: 300, bidCount: 3, ...o });
const print = (artist: string, title: string, o: Partial<AuctionLot> = {}) =>
  lot({ title, artist, subCat: 'prints', auctionHouse: 'Phillips', estimateLow: 20000, estimateHigh: 30000, ...o });
const watch = (artist: string, title: string, o: Partial<AuctionLot> = {}) =>
  lot({ title, artist, subCat: 'wristwatches', objectClass: 'watch', auctionHouse: 'Phillips', estimateLow: 8000, estimateHigh: 12000, ...o });
const own = (l: AuctionLot): HeldInput => ({ id: `held-${l.id}`, owned: true, title: l.title, artist: l.artist, lot: { ...l, id: `held-${l.id}`, status: 'sold' } as AuctionLot });
const saved = (l: AuctionLot): HeldInput => ({ ...own(l), owned: false });
const titlesOf = (ps: CollectionPick[], kind?: CollectionPick['kind']) => ps.filter(p => !kind || p.kind === kind).map(p => p.lot.title);

/* ── (a) UPGRADE ─────────────────────────────────────────────────────── */

test('upgrade: the same card in a higher grade — never another set, year, parallel, a lower grade or a qualified slab', () => {
  const mine = card('1952 Topps #311 Mickey Mantle PSA VG-EX 4');
  const up = card('1952 Topps #311 Mickey Mantle - PSA EX-MT 6', 'baseball', { cardComps: { med: 1200, n: 4, lastSales: [], gradeLadder: [] } });
  const pool = [
    up,
    card('1952 Topps #311 Mickey Mantle - PSA VG 3'),                 // lower
    card('1952 Topps #311 Mickey Mantle - PSA NM 7 (OC)'),            // qualified
    card('1952 Topps #311 Mickey Mantle - PSA Authentic'),            // no grade
    card('1952 Bowman #101 Mickey Mantle - PSA NM-MT 8'),             // other set
    card('1953 Topps #82 Mickey Mantle - PSA NM-MT 8'),               // other year
    card('1952 Topps #312 Jackie Robinson - PSA NM-MT 8'),            // other card
  ];
  const r = collectionPicks([own(mine)], pool, { nowMs: NOW });
  assert.deepEqual(titlesOf(r.picks, 'upgrade'), [up.title]);
  assert.match(r.picks[0].reason, /^Upgrade: you own PSA 4 · this is PSA 6 · same-card PSA 6 \$1\.2K all-time median \(4 sales on file\)$/);
});

test('upgrade reason names its card-sale window like the lot page: last year with n, else all-time with years — never a bare median', () => {
  const mine = card('1951 Bowman #253 Mickey Mantle - SGC 2');
  const cc = (o: object) => ({ med: 10000, n: 11, lastSales: [], gradeLadder: [], ...o });
  const year = card('1951 Bowman #253 Mickey Mantle - SGC VG 3', 'baseball', { cardComps: cc({ r: { med: 19000, n: 2 }, s: { y0: 2021, y1: 2026, m0: 2021, m1: 2023 } }) } as Partial<AuctionLot>);
  let r = collectionPicks([own(mine)], [year], { nowMs: NOW });
  assert.match(r.picks[0].reason, /· same-card SGC 3 \$19K median \(2 sales in the last year\)$/);
  const one = card('1951 Bowman #253 Mickey Mantle - SGC VG 3', 'baseball', { cardComps: cc({ r: { med: 19000, n: 1 } }) } as Partial<AuctionLot>);
  r = collectionPicks([own(mine)], [one], { nowMs: NOW });
  assert.match(r.picks[0].reason, /· same-card SGC 3 \$19K \(1 sale in the last year\)$/);
  const all = card('1951 Bowman #253 Mickey Mantle - SGC VG 3', 'baseball', { cardComps: cc({ r: { med: null, n: 0 }, s: { y0: 2021, y1: 2024, m0: 2021, m1: 2023 } }) } as Partial<AuctionLot>);
  r = collectionPicks([own(mine)], [all], { nowMs: NOW });
  assert.match(r.picks[0].reason, /· same-card SGC 3 \$10K all-time median \(since 2021 · 11 sales, most 2021–23, none in the last year\)$/);
  const thin = card('1951 Bowman #253 Mickey Mantle - SGC VG 3', 'baseball', { cardComps: cc({ n: 2, r: { med: null, n: 0 } }) } as Partial<AuctionLot>);
  r = collectionPicks([own(mine)], [thin], { nowMs: NOW });
  assert.equal(r.picks[0].reason, 'Upgrade: you own SGC 2 · this is SGC 3', 'an all-time record under 3 sales prints no figure');
  for (const l of [year, one, all]) assert.doesNotMatch(collectionPicks([own(mine)], [l], { nowMs: NOW }).picks[0].reason, /median \$|\(\d+\)$/);
});

test('upgrade: a parallel is not the base card; a raw card is not "upgraded" by a slab', () => {
  const base = card('2018 Topps Chrome #193 Shohei Ohtani Rookie Card - PSA MINT 9');
  const pool = [
    card('2018 Topps Chrome Gold Refractor #193 Shohei Ohtani Rookie Card (#12/50) - PSA GEM MT 10'),
    card('2018 Topps Chrome #193 Shohei Ohtani Rookie Card - PSA GEM MT 10'),
  ];
  const r = collectionPicks([own(base)], pool, { nowMs: NOW });
  assert.deepEqual(titlesOf(r.picks, 'upgrade'), ['2018 Topps Chrome #193 Shohei Ohtani Rookie Card - PSA GEM MT 10']);
  const raw = card('2018 Topps Chrome #193 Shohei Ohtani Rookie Card');
  assert.equal(collectionPicks([own(raw)], pool, { nowMs: NOW }).picks.filter(p => p.kind === 'upgrade').length, 0);
});

test('upgrade: a Pokémon card by year · set · number — 1st Edition, Shadowless and Unlimited are different cards', () => {
  const mine = poke('1999 Pokemon Base Set Holo #4 Charizard - PSA NM-MT 8');
  const pool = [
    poke('1999 Pokemon Base Set Holo #4 Charizard - PSA GEM MT 10'),
    poke('1999 Pokemon Base Set 1st Edition Holo #4 Charizard - PSA MINT 9'),
    poke('1999 Pokemon Base Set Shadowless Holo #4 Charizard - PSA MINT 9'),
    poke('2002 Pokemon Legendary Collection Holo #3 Charizard - PSA MINT 9'),
    poke('1999 Pokemon Base Set Holo #2 Blastoise - PSA MINT 9'),
  ];
  const r = collectionPicks([own(mine)], pool, { nowMs: NOW });
  assert.deepEqual(titlesOf(r.picks, 'upgrade'), ['1999 Pokemon Base Set Holo #4 Charizard - PSA GEM MT 10']);
});

test('upgrade: the matched grade ladder adds its premium, n-labelled, only between PSA rungs it prints', () => {
  const mine = card('1959 Topps #10 Mickey Mantle - PSA NM-MT 8');
  const up = card('1959 Topps #10 Mickey Mantle - PSA MINT 9', 'baseball', { playerSlug: 'mickey-mantle', playerName: 'Mickey Mantle' });
  const r0 = collectionPicks([own(mine)], [up], { nowMs: NOW });
  assert.equal(r0.picks.length >= 1, true);
  const ek = r0.picks[0].ek!;
  assert.ok(ek && r0.ladderIds.includes(ek));
  const ladders = new Map([[ek, { basis: 'matched' as const, cards: 28, rows: [
    { key: 'raw', label: 'Raw', n12: 5, med12m: 229 }, { key: 'psa-8', label: 'PSA 8', n12: 28, med12m: 3027 },
    { key: 'psa-9', label: 'PSA 9', n12: 24, med12m: 16531 }, { key: 'psa-10', label: 'PSA 10', n12: 1, med12m: null },
  ] }]]);
  const r = collectionPicks([own(mine)], [up], { nowMs: NOW, ladders });
  assert.match(r.picks[0].reason, /PSA 9 ≈ 5\.5× PSA 8 on .*matched ladder \(28 cards\)/);
  // an unpriced rung prints nothing
  const r10 = collectionPicks([own(card('1959 Topps #10 Mickey Mantle - PSA MINT 9'))], [card('1959 Topps #10 Mickey Mantle - PSA GEM MT 10')], { nowMs: NOW, ladders });
  assert.doesNotMatch(r10.picks[0]?.reason ?? '', /matched ladder/);
});

test('upgrade (watches): the same numeric reference — never a neighbour reference or a model name', () => {
  const mine = watch('rolex', 'Rolex Submariner, Ref. 16610, stainless steel, circa 1999');
  const same = watch('rolex', 'A stainless steel automatic wristwatch with date, Ref. 16610', { reference: '16610' });
  const pool = [same, watch('rolex', 'Rolex Submariner, Ref. 16600 Sea-Dweller', { reference: '16600' }), watch('rolex', 'Rolex Submariner wristwatch')];
  const r = collectionPicks([own(mine)], pool, { nowMs: NOW });
  assert.deepEqual(titlesOf(r.picks, 'upgrade'), [same.title]);
  assert.match(r.picks[0].reason, /^Same reference: you own ref\. 16610 · this is ref\. 16610/);
  assert.equal(watchRefKey({ artist: 'rolex', title: 'Rolex Submariner wristwatch' }), null);
});

/* ── (b) COMPLETE THE SET ───────────────────────────────────────────── */

test('set: two singles of a set → live numbers you do not hold, with N of M only for a known set size', () => {
  const held = [own(card('1952 Topps #1 Andy Pafko - PSA EX 5')), own(card('1952 Topps #2 Pete Runnels - PSA NM 7'))];
  const mantle = card('1952 Topps #311 Mickey Mantle - PSA VG 3');
  const pool = [
    mantle,
    card('1952 Topps #2 Pete Runnels - PSA NM-MT 8'),          // a number you hold (and an upgrade)
    card('1952 Bowman #101 Mickey Mantle - PSA NM-MT 8'),        // another set
    card('1953 Topps #82 Mickey Mantle - PSA NM-MT 8'),          // another year
    card('1952 Topps Football #1 Someone Else - PSA 5', 'football'),
  ];
  const r = collectionPicks(held, pool, { nowMs: NOW });
  assert.deepEqual(titlesOf(r.picks, 'set'), [mantle.title]);
  assert.equal(r.picks.find(p => p.kind === 'set')!.reason, 'Complete the set: you own 2 of 407 in 1952 Topps · this is #311, one you don’t have');
  assert.deepEqual(titlesOf(r.picks, 'upgrade'), ['1952 Topps #2 Pete Runnels - PSA NM-MT 8']);
});

test('set: one single is not a set; an unknown set size says "same set", never a number', () => {
  const one = [own(card('1964 Topps #125 Pete Rose - PSA 7'))];
  const pool = [card('1964 Topps #300 Hank Aaron - PSA MINT 9')];
  assert.equal(collectionPicks(one, pool, { nowMs: NOW }).picks.filter(p => p.kind === 'set').length, 0);
  const two = [...one, own(card('1964 Topps #243 Richie Allen Rookie - PSA 8'))];
  const r = collectionPicks(two, pool, { nowMs: NOW });
  assert.equal(r.picks[0].reason, 'Same set: you own 2 from 1964 Topps · this is #300, one you don’t have');
});

test('set: a season sport keys the season — 1970 Topps (1970-71) is never Goldin\'s "70 Topps" (1969-70)', () => {
  const held = [own(card('1970 Topps #123 Pete Maravich Rookie BVG 8 NM-MT', 'basketball')), own(card('1970 Topps #160 Jerry West PSA 9 MINT', 'basketball'))];
  const pool = [card('71 Topps #50 Wilt Chamberlain - PSA NM-MT 8', 'basketball'), card('70 Topps #25 Lew Alcindor Rookie Card - PSA NM 7', 'basketball'),
    card('1970 Topps #150 Lou Brock - PSA 8', 'baseball')];
  const r = collectionPicks(held, pool, { nowMs: NOW });
  assert.deepEqual(titlesOf(r.picks, 'set'), ['71 Topps #50 Wilt Chamberlain - PSA NM-MT 8']);
  assert.match(r.picks[0].reason, /from 1970-71 Topps/);
});

test('set: Pokémon sets read without per-card rarity words — 1st Edition is not Unlimited, Jungle is not Fossil', () => {
  const held = [own(poke('1999 Pokemon Jungle 1st Edition Holo #8 Pidgeot - PSA MINT 9')), saved(poke('1999 Pokemon Jungle 1st Edition #52 Eevee - PSA 9'))];
  const snorlax = poke('1999 Pokemon Jungle 1st Edition Holo #11 Snorlax - PSA EX-MT 6');
  const pool = [snorlax, poke('1999 Pokemon Jungle Holo #11 Snorlax - PSA 9'), poke('1999 Pokemon Fossil 1st Edition #16 Aerodactyl - PSA 10')];
  const r = collectionPicks(held, pool, { nowMs: NOW });
  assert.deepEqual(titlesOf(r.picks, 'set'), [snorlax.title]);
  assert.equal(r.picks[0].reason, 'Complete the set: you own 1 and saved 1 of 64 in 1999 Pokémon Jungle 1st Edition · this is #11, one you don’t have');
  assert.equal(tcgSetName('Pokemon Legendary Collection Reverse Holo'), tcgSetName('Pokemon Legendary Collection Reverse Foil'));
  assert.notEqual(tcgSetName('Pokemon Base Set 1st Edition Holo'), tcgSetName('Pokemon Base Set Holo'));
});

/* ── (c) SERIES / PORTFOLIO ─────────────────────────────────────────── */

test('series: Warhol portfolio siblings by F&S range or "from" — never Campbell\'s Soup II for I, never the print you own', () => {
  const held = [own(print('andy-warhol', "Black Bean, from Campbell's Soup I (F. & S. II.44)"))];
  const onion = print('andy-warhol', "Onion, from Campbell's Soup I");
  const chicken = print('andy-warhol', 'Chicken Noodle (F. & S. II.45)');
  const pool = [
    onion, chicken,
    print('andy-warhol', "Golden Mushroom, from Campbell's Soup II"),
    print('andy-warhol', "Black Bean, from Campbell's Soup I"),          // the print you own
    print('roy-lichtenstein', "Soup Can, from Campbell's Soup I"),        // another maker
    print('andy-warhol', 'Kiku (see F. & S. 309)'),                       // a cross-reference
  ];
  const r = collectionPicks(held, pool, { nowMs: NOW });
  assert.deepEqual(titlesOf(r.picks, 'series').sort(), [chicken.title, onion.title].sort());
  for (const p of r.picks.filter(x => x.kind === 'series')) assert.match(p.reason, /^Complete the series: you own 1 of 10 in Campbell's Soup I · this is /);
});

test('series: Flowers (Hand-Colored) is its own portfolio; "see F. & S." is no membership', () => {
  assert.equal(seriesOf({ artist: 'andy-warhol', title: 'Pl. 10, from Flowers (Hand-Colored)' })!.label, 'Flowers (Hand-Colored)');
  assert.equal(seriesOf({ artist: 'andy-warhol', title: 'Flowers (F. & S. 67)' })!.label, 'Flowers');
  assert.equal(seriesOf({ artist: 'andy-warhol', title: 'Kiku (see F. & S. 309)' }), null);
  assert.equal(fsNumberOf('The Shadow (see F. & S. 269A)'), null);
  assert.equal(fsNumberOf('Apple, from Ads (F. & S. 359)'), 359);
  assert.equal(fsNumberOf('Mao (Feldman & Schellmann II.91)'), 91);
  // Teddy Roosevelt is II.386 — Cowboys and Indians runs 377–386
  assert.equal(seriesOf({ artist: 'andy-warhol', title: 'Teddy Roosevelt (F. & S. II.386)' })!.label, 'Cowboys and Indians');
  const r = collectionPicks([own(print('andy-warhol', 'Pl. 10, from Flowers (Hand-Colored)'))], [print('andy-warhol', 'Flowers (F. & S. 67)')], { nowMs: NOW });
  assert.equal(r.picks.filter(p => p.kind === 'series').length, 0);
});

test('series: names compare with a typo, never across a volume; members by F&S number', () => {
  assert.equal(seriesKeyEq('campell soup ii', 'campbell soup ii'), true);
  assert.equal(seriesKeyEq('campbell soup i', 'campbell soup ii'), false);
  assert.equal(seriesKeyEq('myth', 'mao'), false);
  assert.equal(sameMember('Marilyn, F&S II.28', 'Marilyn Monroe (Marilyn), F&S II.26'), false);
  assert.equal(sameMember('Marilyn', 'Marilyn, F&S II.26'), true);
  // Picasso: the suites print their settled size
  assert.equal(seriesOf({ artist: 'pablo-picasso', title: 'Minotaure aveugle guidé par une Fillette, III, from La Suite Vollard' })!.size, 100);
  assert.equal(seriesOf({ artist: 'pablo-picasso', title: 'Célestine, Maja et complice masculin (from La Serie 347)' })!.label, 'Série 347');
});

/* ── (d) MORE BY A NAME YOU HOLD ─────────────────────────────────────── */

test('maker: more by a maker or player you hold; a collection bucket is no name; owned leads saved', () => {
  const pool = [
    lot({ title: 'Mona Lisa (Reversal Series)', artist: 'andy-warhol', subCat: 'originals', auctionHouse: 'Phillips', estimateLow: 1e6, estimateHigh: 1.5e6 }),
    print('keith-haring', 'Pop Shop I'),
    card('1951 Bowman #253 Mickey Mantle Rookie Card - PSA 4', 'baseball', { playerSlug: 'mickey-mantle', playerName: 'Mickey Mantle' }),
  ];
  const held = [saved(print('andy-warhol', 'Cow (F. & S. II.11)')), own(card('1966 Topps #50 Mickey Mantle - PSA 7', 'baseball', { playerSlug: 'mickey-mantle', playerName: 'Mickey Mantle' }))];
  const r = collectionPicks(held, pool, { nowMs: NOW });
  const mk = r.picks.filter(p => p.kind === 'maker');
  assert.deepEqual(mk.map(p => p.lot.title), ['1951 Bowman #253 Mickey Mantle Rookie Card - PSA 4', 'Mona Lisa (Reversal Series)']);
  assert.equal(mk[0].reason, 'More Mickey Mantle · you own 1 card of this player');
  assert.equal(mk[1].reason, 'More Andy Warhol · you saved 1 piece by this maker');
  assert.ok(!titlesOf(r.picks).includes('Pop Shop I'));
});

test('nothing held, or nothing parseable, picks nothing; a held lot never comes back', () => {
  assert.equal(collectionPicks([], [card('1952 Topps #311 Mickey Mantle - PSA 6')], { nowMs: NOW }).picks.length, 0);
  const l = card('1952 Topps #311 Mickey Mantle - PSA 6');
  const r = collectionPicks([{ id: l.id, owned: true, title: l.title, artist: l.artist, lot: l }], [l], { nowMs: NOW });
  assert.equal(r.picks.length, 0);
});

/* ── zero cross-identity: a mixed desk over a mixed block ───────────── */

test('a mixed desk over a mixed block: every pick is its identity, none crosses', () => {
  const held = [
    own(card('1952 Topps #311 Mickey Mantle PSA 4')), own(card('1952 Topps #1 Andy Pafko PSA 5')),
    own(poke('1999 Pokemon Base Set Holo #4 Charizard - PSA 8')), own(poke('1999 Pokemon Base Set Holo #2 Blastoise - PSA 7')),
    own(print('andy-warhol', 'The Shadow, from Myths (F. & S. II.267)')),
    own(watch('rolex', 'Rolex GMT-Master, Ref. 1675')),
  ];
  const block = [
    card('1952 Topps #311 Mickey Mantle - PSA 6'), card('1952 Topps #312 Jackie Robinson - PSA 6'), card('1952 Bowman #101 Mickey Mantle - PSA 8'),
    card('1953 Topps #1 Jackie Robinson - PSA 6'), card('1952 Topps #311 Mickey Mantle - PSA 2'),
    poke('1999 Pokemon Base Set Holo #4 Charizard - PSA 9'), poke('1999 Pokemon Base Set Holo #15 Venusaur - PSA 9'),
    poke('1999 Pokemon Base Set 1st Edition Holo #15 Venusaur - PSA 9'), poke('2000 Pokemon Base Set 2 Holo #4 Charizard - PSA 10'),
    print('andy-warhol', 'The Star, from Myths'), print('andy-warhol', 'Grevy\'s Zebra, from Endangered Species'),
    watch('rolex', 'Rolex GMT-Master, Ref. 1675, circa 1972', { reference: '1675' }), watch('rolex', 'Rolex GMT-Master II, Ref. 16710', { reference: '16710' }),
  ];
  const r = collectionPicks(held, block, { nowMs: NOW, n: 50 });
  const got = new Map(r.picks.map(p => [p.lot.title, p.kind]));
  assert.equal(got.get('1952 Topps #311 Mickey Mantle - PSA 6'), 'upgrade');
  assert.equal(got.get('1952 Topps #312 Jackie Robinson - PSA 6'), 'set');
  assert.equal(got.get('1999 Pokemon Base Set Holo #4 Charizard - PSA 9'), 'upgrade');
  assert.equal(got.get('1999 Pokemon Base Set Holo #15 Venusaur - PSA 9'), 'set');
  assert.equal(got.get('The Star, from Myths'), 'series');
  assert.equal(got.get('Rolex GMT-Master, Ref. 1675, circa 1972'), 'upgrade');
  // the near misses are never an upgrade / set / series tie (a name you hold may still deal them as "More …")
  for (const t of ['1952 Bowman #101 Mickey Mantle - PSA 8', '1953 Topps #1 Jackie Robinson - PSA 6', '1952 Topps #311 Mickey Mantle - PSA 2',
    '1999 Pokemon Base Set 1st Edition Holo #15 Venusaur - PSA 9', '2000 Pokemon Base Set 2 Holo #4 Charizard - PSA 10',
    "Grevy's Zebra, from Endangered Species", 'Rolex GMT-Master II, Ref. 16710']) {
    const k = got.get(t);
    assert.ok(k === undefined || k === 'maker', `${t} → ${k}`);
  }
});
