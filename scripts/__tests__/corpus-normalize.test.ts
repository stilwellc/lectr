/**
 * scripts/lib/corpus-normalize.ts — the build-time hygiene passes NOT already
 * pinned by data-quality.test.ts (which owns the Sep 27 data-quality block:
 * stale upcoming, RR/Sotheby's/Bruun dedupes, compExclude, datePrecision,
 * set codes, foreign lead maker, family hammer, placeholder images).
 *
 * Each pass is a pure mutation of a lot array: build a tiny corpus, run the
 * pass, assert the outcome, the guards (what must NOT move) and idempotency.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampImpossibleYears, rerouteScienceMisroutes, rerouteRelicCards, reconcileSaleDates,
  dedupeWrightFamilyMirrors, deriveRRAuctionUrls, normalizeArtCategory, recoverPlayerSlug,
  guTeamOf, guUseClass, guGameKey, stampCultureAxes, nullDeadChristiesSsoUrls,
} from '../lib/corpus-normalize';

type R = Record<string, any>;
const L = (o: R): any => ({ id: 'x', artist: 'memorabilia', title: 't', category: 'object', auctionHouse: 'REA', saleDate: '2026-01-01', status: 'sold', ...o });
const ids = (xs: R[]) => xs.map(x => x.id).sort();

test('clampImpossibleYears: yearNum past next year is nulled (with its source/circa); real years kept; idempotent', () => {
  const next = new Date().getFullYear() + 1;
  const lots = [
    L({ id: 'ref-as-year', yearNum: 5711, yearSource: 'title', yearIsCirca: true }),
    L({ id: 'next-year', yearNum: next }),
    L({ id: 'old', yearNum: 1952 }),
    L({ id: 'none', yearNum: null }),
  ];
  assert.equal(clampImpossibleYears(lots), 1);
  assert.equal(lots[0].yearNum, null);
  assert.equal(lots[0].yearSource, null);
  assert.equal(lots[0].yearIsCirca, false);
  assert.equal(lots[1].yearNum, next);
  assert.equal(lots[2].yearNum, 1952);
  assert.equal(clampImpossibleYears(lots), 0);
});

test('rerouteScienceMisroutes: tracked watch/art maker → re-routed; untracked → evicted; genuine science pinned', () => {
  const lots = [
    L({ id: 'rolex', artist: 'meteorites', title: 'Rolex Daytona meteorite dial' }),              // science subject word → pinned
    L({ id: 'rolex2', artist: 'scientific-instruments', title: 'Rolex Submariner wristwatch' }),
    L({ id: 'mille', artist: 'scientific-instruments', title: 'Richard Mille RM 011 tourbillon' }),
    L({ id: 'warhol', artist: 'space-exploration', title: 'Andy Warhol Moonwalk screenprint' }),
    L({ id: 'hockney', artist: 'fossils', title: 'David Hockney lithograph' }),
    L({ id: 'trilo', artist: 'fossils', title: 'Large trilobite specimen' }),
    L({ id: 'art-slug', artist: 'andy-warhol', title: 'Rolex wristwatch' }),                   // not a science slug → untouched
  ];
  const r = rerouteScienceMisroutes(lots);
  assert.deepEqual(r, { total: 4, toArt: 1, toWatch: 1, evicted: 2 });
  assert.deepEqual(ids(lots), ['art-slug', 'rolex', 'rolex2', 'trilo', 'warhol']);
  const by = Object.fromEntries(lots.map(l => [l.id, l]));
  assert.equal(by.rolex.artist, 'meteorites');
  assert.equal(by.rolex2.artist, 'rolex');
  assert.equal(by.rolex2.makerSlug, 'rolex');
  assert.equal(by.warhol.artist, 'andy-warhol');
  assert.equal(by.trilo.artist, 'fossils');
  assert.equal(by['art-slug'].artist, 'andy-warhol');
  assert.equal(rerouteScienceMisroutes(lots).total, 0, 'idempotent');
});

test('rerouteRelicCards: a card carrying a game-used swatch moves to sports-cards; a real jersey stays', () => {
  const lots = [
    L({ id: 'relic', artist: 'game-used', title: '2021 Topps Dynasty Autograph Patch #DAP-SO Shohei Ohtani 1/5' }),
    L({ id: 'jersey', artist: 'game-used', title: '1998 Michael Jordan Game-Worn Chicago Bulls Jersey PSA/DNA' }),
    L({ id: 'card-already', artist: 'sports-cards', title: '2021 Topps Chrome #1 Ohtani' }),
  ];
  const r = rerouteRelicCards(lots);
  assert.equal(r.total, 1);
  assert.deepEqual(r.examples, ['2021 Topps Dynasty Autograph Patch #DAP-SO Shohei Ohtani 1/5']);
  assert.equal(lots[0].artist, 'sports-cards');
  assert.equal(lots[0].makerSlug, 'sports-cards');
  assert.equal(lots[1].artist, 'game-used');
  assert.equal(rerouteRelicCards(lots).total, 0, 'idempotent');
});

test('reconcileSaleDates: saleDate moves DOWN to an earlier parsed saleDateTime, never later', () => {
  const lots = [
    L({ id: 'crawl-day', saleDate: '2026-09-27', saleDateTime: '2014-05-20T15:00:00Z' }),
    L({ id: 'future', saleDate: '2026-10-01', saleDateTime: '2026-10-02T15:00:00Z' }),
    L({ id: 'same', saleDate: '2026-10-01', saleDateTime: '2026-10-01T23:00:00-04:00' }),
    L({ id: 'nodt', saleDate: '2026-10-01' }),
  ];
  assert.equal(reconcileSaleDates(lots), 1);
  assert.deepEqual(lots.map(l => l.saleDate), ['2014-05-20', '2026-10-01', '2026-10-01', '2026-10-01']);
  assert.equal(reconcileSaleDates(lots), 0);
});

test('dedupeWrightFamilyMirrors: one lot on Wright/Rago/LAMA mirrors → one row (sold > upcoming, Wright > Rago > LAMA)', () => {
  const lots = [
    L({ id: 'lama-301456', auctionHouse: 'LAMA', status: 'sold' }),
    L({ id: 'wright-301456', auctionHouse: 'Wright', status: 'sold' }),
    L({ id: 'rago-301456~', auctionHouse: 'Rago', status: 'upcoming' }),
    // two id schemes, same sale path on two domains
    L({ id: 'rago-413558', auctionHouse: 'Rago', status: 'upcoming', url: 'https://www.ragoarts.com/auctions/2026/06/design/112' }),
    L({ id: 'lama-299487', auctionHouse: 'LAMA', status: 'sold', url: 'https://www.lamodern.com/auctions/2026/06/design/112' }),
    // genuinely distinct: different id AND different slot
    L({ id: 'wright-500001', auctionHouse: 'Wright', url: 'https://www.wright20.com/auctions/2026/06/design/113' }),
    L({ id: 'wright-500002', auctionHouse: 'Wright', url: 'https://www.wright20.com/auctions/2026/06/design/114' }),
    // not in the family
    L({ id: 'bonhams-301456', auctionHouse: 'Bonhams' }),
  ];
  assert.equal(dedupeWrightFamilyMirrors(lots), 3);
  assert.deepEqual(ids(lots), ['bonhams-301456', 'lama-299487', 'wright-301456', 'wright-500001', 'wright-500002']);
  assert.equal(dedupeWrightFamilyMirrors(lots), 0, 'idempotent');
});

test('deriveRRAuctionUrls: fills only an empty url on an RR-shaped id', () => {
  const lots = [
    L({ id: 'rrauction-746-351547607463093', url: null }),
    L({ id: 'rrauction-746-351547607463094~', url: '' }),
    L({ id: 'rrauction-746-1', url: 'https://www.rrauction.com/own' }),
    L({ id: 'rrauction-271-0-x', url: null }),
    L({ id: 'goldin-1', url: null }),
  ];
  assert.equal(deriveRRAuctionUrls(lots), 2);
  assert.equal(lots[0].url, 'https://www.rrauction.com/auctions/lot-detail/351547607463093');
  assert.equal(lots[1].url, 'https://www.rrauction.com/auctions/lot-detail/351547607463094');
  assert.equal(lots[2].url, 'https://www.rrauction.com/own');
  assert.equal(lots[3].url, null);
  assert.equal(lots[4].url, null);
});

test("nullDeadChristiesSsoUrls: nulls the dead www /<lang>/sso links, keeps the live onlineonly sso permalinks", () => {
  const C = (id: string, url: string | null, house = "Christie's") => L({ id, url, auctionHouse: house });
  const lots = [
    C('christies-auc-5602497', 'https://www.christies.com/en/sso?ObjectID=4431.7&LotNumber=7&ldp_breadcrumb=back'),
    C('christies-auc-1', 'https://christies.com/sso?ObjectID=1.2'),
    C('christies-auc-2', '/en/sso'),
    C('christies-auc-3', 'http://www.christies.com/zh/sso#x'),
    C('christies-24969.26', 'https://onlineonly.christies.com/sso?ObjectID=24969.26&LotNumber=26'),
    C('christies-auc-6608607', 'https://www.christies.com/en/lot/lot-6608607?ldp_breadcrumb=back'),
    C('christies-auc-4', 'https://www.christies.com/en/ssot-sale'),
    C('christies-auc-5', null),
    C('bonhams-1', 'https://www.christies.com/en/sso?x', 'Bonhams'),
  ];
  assert.equal(nullDeadChristiesSsoUrls(lots), 4);
  assert.deepEqual(lots.slice(0, 4).map(l => l.url), [null, null, null, null]);
  assert.equal(lots[4].url, 'https://onlineonly.christies.com/sso?ObjectID=24969.26&LotNumber=26');
  assert.equal(lots[5].url, 'https://www.christies.com/en/lot/lot-6608607?ldp_breadcrumb=back');
  assert.equal(lots[6].url, 'https://www.christies.com/en/ssot-sale');
  assert.equal(lots[8].url, 'https://www.christies.com/en/sso?x', 'another house is never touched');
  assert.equal(nullDeadChristiesSsoUrls(lots), 0, 'idempotent');
});

test('normalizeArtCategory: print↔original re-derivation on ART makers only, explicit unique mediums never flipped', () => {
  const lots = [
    L({ id: 'o2p', artist: 'andy-warhol', category: 'original', title: 'Marilyn Monroe', medium: 'screenprint in colors' }),
    L({ id: 'o2p-ed', artist: 'andy-warhol', category: 'original', title: 'Flowers', medium: 'numbered 37/250' }),
    L({ id: 'unique', artist: 'andy-warhol', category: 'original', title: 'Flowers', medium: 'acrylic and silkscreen ink on canvas' }),
    L({ id: 'p2o', artist: 'andy-warhol', category: 'print', title: 'Self-Portrait', medium: 'acrylic on canvas' }),
    L({ id: 'p-ok', artist: 'andy-warhol', category: 'print', title: 'Mao', medium: 'screenprint, edition of 250' }),
    L({ id: 'not-art', artist: 'rolex', category: 'original', title: 'x', medium: 'lithograph' }),
  ];
  assert.deepEqual(normalizeArtCategory(lots), { o2p: 2, p2o: 1 });
  assert.deepEqual(lots.map(l => l.category), ['print', 'print', 'original', 'original', 'print', 'original']);
  assert.equal(lots[0].catReclass, 'o2p');
  assert.equal(lots[3].catReclass, 'p2o');
  assert.deepEqual(normalizeArtCategory(lots), { o2p: 0, p2o: 0 }, 'idempotent');
});

test('recoverPlayerSlug: the athlete off a game-used title; teams, dates and set codes skipped; abstains on one token', () => {
  assert.equal(recoverPlayerSlug('1998 Michael Jordan Game-Worn Chicago Bulls Jersey'), 'michael-jordan');
  assert.equal(recoverPlayerSlug('Mickey Mantle 1960 New York Yankees Game-Used Bat'), 'mickey-mantle');
  assert.equal(recoverPlayerSlug('May 5, 1998 Derek Jeter Game-Used Bat'), 'derek-jeter');
  assert.equal(recoverPlayerSlug('HIGHLIGHT Babe Ruth Signed Baseball Bids: 12 Opening bid: $500'), 'babe-ruth');
  assert.equal(recoverPlayerSlug('Game-Used Baseball'), null);
  assert.equal(recoverPlayerSlug(''), null);
});

test('guTeamOf / guUseClass / guGameKey: the three game-used comp axes', () => {
  assert.equal(guTeamOf('Mickey Mantle New York Yankees Game-Used Bat'), 'yankees');
  assert.equal(guTeamOf('Ted Williams Boston Red Sox Jersey'), 'red-sox');
  assert.equal(guTeamOf('Magic Johnson Lakers Jersey'), 'lakers', 'magic is not a team key');
  assert.equal(guTeamOf('Plain bat'), null);
  assert.equal(guUseClass('Team-Issued Home Jersey'), 'issued');
  assert.equal(guUseClass('Game-Issued and Game-Worn Jersey'), 'used');
  assert.equal(guUseClass('Signed Jersey'), 'used', 'unmarked reads as used');
  assert.equal(guGameKey('Game-Used Bat - 6/30/26 vs. LAD'), null, '2-digit year is not a game date');
  assert.equal(guGameKey('Home Run Ball Used 9/11/2026 vs. NYM'), '2026-09-11');
  assert.equal(guGameKey('Worn Oct. 3, 1951 Shot Heard Round the World'), '1951-oct-03');
  assert.equal(guGameKey('2016 World Series Game 7 Worn Cleats'), '2016:world-series-g7');
  assert.equal(guGameKey('Opening Day Worn Jersey', 2024), '2024:opening-day');
  assert.equal(guGameKey('Season Worn Jersey', 2024), null, 'season attribution only');
});

test('stampCultureAxes: itemClass + subjectKeys on culture slugs only', () => {
  const lots = [
    L({ id: 'music', artist: 'music-memorabilia', title: 'Jimi Hendrix Stage-Played Stratocaster Guitar' }),
    L({ id: 'movie', artist: 'movie-tv', title: '"Star Wars" Stormtrooper Helmet Prop' }),
    L({ id: 'sport', artist: 'game-used', title: 'Babe Ruth Bat' }),
  ];
  assert.equal(stampCultureAxes(lots), 2);
  assert.equal(lots[0].itemClass, 'instrument');
  assert.deepEqual(lots[0].subjectKeys, ['jimi hendrix']);
  assert.equal(lots[1].itemClass, 'prop');
  // KNOWN QUIRK (pinned, not endorsed): the person reader strips the quotes
  // and takes the leading capitalized run, so the franchise + item words
  // become a pseudo-person key alongside the real franchise key
  assert.deepEqual(lots[1].subjectKeys, ['star wars stormtrooper helmet', 'star wars']);
  assert.equal(lots[2].itemClass, undefined);
});
