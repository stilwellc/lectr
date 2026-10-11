/* (r9, QA4) data fixes — the sport stamp re-derived on every build, a
   "Moonwalk" that is Michael Jackson's, and the misfiles QA4 listed. Titles are
   the corpus's / the live book's own. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleSportStamp, restampTitleSports, subCatOf } from '../lib/sub-cats';
import { reclassifyLot, isSpaceLeadTitle, isSpaceMoonwalk, DROP } from '../lib/classify';
import { taxonOf } from '../../app/lib/taxonomy';
import { entityKeyOf } from '../../app/lib/entity/key';
import { sportLabelOfDrill } from '../../app/lib/submarkets';
import { assertInvariants } from '../../app/lib/validate';
import { sportOf } from '../../app/utils';
import type { AuctionLot } from '../../app/types';

type R = Record<string, unknown>;
const L = (o: R): any => ({ id: 'x', artist: 'memorabilia', title: 't', category: 'object', auctionHouse: 'Goldin', saleName: '', status: 'sold', ...o });
const move = (o: R) => { const l = L(o); const r = reclassifyLot(l); return r.drop ? DROP : l.artist; };

test('r9: the sport stamp is re-derived from the title on every row — a stale bare-"Jordan" stamp does not survive a build', () => {
  // Goldin's cards rode last-good with the pre-r8 stamp
  const love = L({ artist: 'sports-cards', title: '2020 Panini Prizm Autograph Purple Pulsar #363 Jordan Love Signed Rookie Card - PSA MINT 9', sport: 'Basketball' });
  const walker = L({ artist: 'sports-cards', title: '2023 Bowman Chrome Prospect Autographs #CPA-JW Jordan Walker Signed Rookie Card - PSA 10', sport: 'Basketball' });
  const mj = L({ artist: 'sports-cards', title: '1986 Fleer #57 Michael Jordan Rookie Card - PSA MINT 9', sport: 'Basketball' });
  // a house that names the sport itself keeps it, whatever the title says
  const nfl = L({ artist: 'game-used', auctionHouse: 'NFL Auction', title: 'STS - Cardinals Kyler Murray Game Used Jersey (11/8/20) Size 40', sport: 'Football' });
  const mlb = L({ artist: 'game-used', auctionHouse: 'MLB Auctions', title: 'Brayan Bello Game Worn Autographed 2026 Patriots Day Jersey', sport: 'Baseball' });
  // a stamped row the classifier since re-filed (an autograph off a game-used slug) is re-read too
  const rea = L({ artist: 'graded-cards', auctionHouse: 'REA', title: '2020 Panini Mosaic Football #211 Jordan Love Rookie PSA GEM MINT 10', sport: 'Basketball' });
  const auto = L({ artist: 'autographs', title: 'Mariano Rivera Signed, Inscribed New York Yankees Home Jersey - Steiner COA', sport: 'Baseball' });
  // a row the crawler never stamped stays unstamped; off the sports market a stamp is cleared
  const never = L({ artist: 'autographs', auctionHouse: 'REA', title: 'Babe Ruth Signed Baseball' });
  const culture = L({ artist: 'entertainment-memorabilia', title: 'Jimi Hendrix', sport: null });
  const rows = [love, walker, mj, nfl, mlb, rea, auto, never, culture];
  const r = restampTitleSports(rows);
  assert.equal(love.sport, null);
  assert.equal(walker.sport, null);
  assert.equal(mj.sport, 'Basketball');
  assert.equal(nfl.sport, 'Football');
  assert.equal(mlb.sport, 'Baseball');
  assert.equal(rea.sport, null);
  assert.equal(auto.sport, 'Baseball');
  assert.equal('sport' in never, false);
  assert.equal('sport' in culture, false);
  assert.equal(r.changed, 3);
  assert.equal(r.byChange['Basketball→∅'], 3);
  assert.equal(restampTitleSports(rows).changed, 0, 'idempotent');
  // a bare "Jordan" is Michael only beside an NBA name or one of his products
  assert.equal(sportOf('92 Upper Deck #34 Magic vs. Jordan – PSA GEM MT 10'), 'Basketball');
  assert.equal(sportOf('1996 Collector\'s Choice #364 J.Starks/M.Jordan – PSA EX-MT 6'), 'Basketball');
  assert.equal(sportOf('1986 Star Best of the New BGS-Graded Complete Set (4) - Featuring Jordan, Ewing, Olajuwon'), 'Basketball');
  assert.equal(sportOf('1996 Upper Deck Space Jam #60 Jordan Lends A Hand – PSA NM 7'), 'Basketball');
  assert.equal(sportOf('2024 Panini Prizm Draft Picks Color Blast Dual #CBD-FSU1 Jordan Travis/Keon Coleman - PSA NM-MT 8'), null);
  assert.equal(sportOf('2023 Panini Black Rookie Patch Autograph #202 Jordan Addison Signed Patch Rookie Card'), null);
  assert.equal(sportOf('2020 Topps Chrome #200 Jordan Alvarez Rookie Card – PSA GEM MT 10'), null);
  // the same rule the crawler applies
  assert.equal(titleSportStamp({ artist: 'tickets-passes', title: '1960 World Series Game 7 Ticket Stub' }), 'Baseball');
  assert.equal(titleSportStamp({ artist: 'andy-warhol', title: 'Michael Jordan' }), undefined);
  // the drill now reads the title's own words / the learned maps, not the stale stamp
  assert.equal(subCatOf(rea).drill, 'football');
  assert.equal(subCatOf(love).drill, null);
  // players.json votes the drill first
  assert.equal(sportLabelOfDrill('football'), 'Football');
  assert.equal(sportLabelOfDrill('boxing-mma'), 'Boxing / MMA');
  assert.equal(sportLabelOfDrill('music'), null);
  assert.equal(sportLabelOfDrill(null), null);
});

test('r9: "Moonwalk" is Michael Jackson\'s unless a space word says otherwise', () => {
  const mjBook = 'Michael Jackson Twice-Signed 1st Edition Moonwalk Autobiography - Grad Authentication Digital LOA';
  assert.equal(isSpaceLeadTitle(mjBook), false);
  assert.equal(isSpaceMoonwalk(mjBook), false);
  assert.equal(isSpaceMoonwalk('Michael Jackson Moonwalker Promotional Poster'), false);
  // the culture leak no longer files it as a space lot
  assert.equal(move({ artist: 'entertainment-memorabilia', title: mjBook, saleName: 'Goldin Elite Auction' }), 'entertainment-memorabilia');
  // a generalist house's space lot whose only space word was the moonwalk goes back to culture (never dropped)
  assert.equal(move({ artist: 'space-exploration', auctionHouse: "Christie's", title: 'Michael Jackson Signed Moonwalk First Edition' }), 'entertainment-memorabilia');
  // the twelve are space; a moonwalk beside a space word is space
  assert.equal(isSpaceMoonwalk('Moonwalkers (12) Signed Photographs - Complete Set of Uninscribed NASA Lithographs'), true);
  assert.equal(isSpaceMoonwalk('Moonwalkers: Shepard and Irwin Signed Photographs'), true);
  assert.equal(isSpaceMoonwalk('Apollo 11 First Moonwalk Photograph'), true);
  assert.equal(move({ artist: 'entertainment-memorabilia', title: 'Moonwalkers (12) Signed Photographs - Complete Set of Uninscribed NASA Lithographs' }), 'space-exploration');
  // the space program drill: Apollo off the twelve, never off Jackson's book
  const S = (title: string) => subCatOf({ artist: 'space-exploration', title }).drill;
  assert.equal(S('Moonwalkers: Shepard and Irwin Signed Photographs'), 'apollo');
  assert.equal(S("ALDRIN'S MOONWALK – Photograph signed. 1969."), 'apollo');
  assert.equal(S('Collection of Twelve Moonwalker Signed Photographs'), 'apollo');
  assert.notEqual(S(mjBook), 'apollo');
  assert.notEqual(S('Mar. 25, 1983 Michael Jackson Moonwalk Debut Show Type I Original Photo by NBC'), 'apollo');
  // and the lot files under Jackson, in Pop Culture — not Space & Science · Apollo
  const lot = { id: 'g', artist: 'entertainment-memorabilia', title: mjBook, ...subCatOf({ artist: 'entertainment-memorabilia', title: mjBook }) };
  assert.equal(taxonOf(lot).cat, 'entertainment');
  assert.equal(entityKeyOf(lot), 'sj:culture|p:michael-jackson');
});

test('r9: the misfiles QA4 listed find their real category', () => {
  // a Woodstock ticket off Goldin's Tickets facet is a music ticket, not a Sports Ticket
  assert.equal(move({ artist: 'tickets-passes', title: 'Aug. 15-17, 1969 - Woodstock Music And Art Fair Three-Day Full Ticket - PSA MINT 9', saleName: 'Goldin Weekly Auction' }), 'entertainment-memorabilia');
  // a mixed sports-and-Hollywood sale: the lot that names no sport is the Hollywood half…
  const espy = 'American Greats Vintage Sports And Hollywood From The Dr G B Espy Collection';
  const gwtw = 'MITCHELL, Margaret (1900–1949). Gone with the Wind. New York: Macmillan, 1936. First edition, first printing, in first issue dust jacket. It won the National Book Award in 1936 and Pulitzer Prize for fiction in 1937. Signed on front free endleaf "Margaret Mitchell".';
  assert.equal(move({ artist: 'trophies-awards', auctionHouse: "Christie's", saleName: espy, title: gwtw }), 'entertainment-memorabilia');
  // …and a sports lot there stays sports
  assert.equal(move({ artist: 'trophies-awards', auctionHouse: "Christie's", saleName: espy, title: 'BABE RUTH 1927 NEW YORK YANKEES WORLD SERIES TROPHY BALL' }), 'trophies-awards');
  // it moves on positive culture evidence only: an ambiguous name or a sports painting stays
  assert.equal(move({ artist: 'autographs', auctionHouse: "Christie's", saleName: espy, title: 'RARE AND IMPORTANT JOE JACKSON AUTOGRAPHED PROMISSORY NOTE (PSA/DNA 7 NM) 1916' }), 'autographs');
  assert.equal(move({ artist: 'autographs', auctionHouse: "Christie's", saleName: espy, title: 'LEROY NEIMAN (1921-2012) ALABAMA HANDOFF' }), 'autographs');
  assert.equal(move({ artist: 'type-1-photos', auctionHouse: "Christie's", saleName: espy, title: 'VERY EARLY SNAPSHOT OF MARILYN MONROE (PSA/DNA "TYPE I") CIRCA 1942' }), 'entertainment-memorabilia');
  // a culture lot in a space SALE that names nothing of space takes no space domain
  const thornton = { artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction', saleName: 'Space Exploration', title: '1967 Plymouth Belvedere GTX - From the Personal Collection of William E. Thornton' };
  assert.notEqual(subCatOf(thornton).drill, 'space-science');
  assert.notEqual(taxonOf({ ...thornton, ...subCatOf(thornton) }).cat, 'space-science');
  // …while one that names a program still reads it; an aviation sale's unnamed hardware is aviation
  assert.equal(subCatOf({ ...thornton, title: 'Apollo 11 Mission Control Console Placard' }).drill, 'apollo');
  assert.equal(subCatOf({ ...thornton, saleName: 'Space & Aviation', title: 'Convair B-58 Hustler Escape Capsule Oxygen System' }).drill, 'aviation');
  // Christie's "The Origins Of Cyberspace" is a computing sale, not a space one
  assert.equal(subCatOf({ artist: 'entertainment-memorabilia', auctionHouse: "Christie's", saleName: 'The Origins Of Cyberspace', title: '[CALCULATING MACHINES]. (1) Machine à calculer. Roule sur billes' }).drill, 'science');
  // a record label's signed promo iPod is music, not a scientific instrument
  assert.equal(move({ artist: 'scientific-instruments', saleName: 'Goldin Thematic Auction', title: 'Kayne West Signed, Inscribed Limited Edition 2004 UMG iPod - Beckett LOA' }), 'music-memorabilia');
  // the act with its nickname run on is the act (no "The Beatles Fab Four" person)
  assert.equal(entityKeyOf({ artist: 'entertainment-memorabilia', title: '1960s The Beatles Fab Four Type I Original Photo by David Magnus - 7 x 8.5 - PSA/DNA' }), 'sj:culture|fr:fr-beatles');
  // a magician and a child film star are never sports players
  assert.equal(entityKeyOf({ artist: 'autographs', title: 'Harry Houdini Signed Photograph' }), 'sj:culture|p:harry-houdini');
  assert.doesNotMatch(String(entityKeyOf({ artist: 'graded-cards', title: '1923 Edwards, Ringer & Bigg "Cinema Stars" #38 Jackie Coogan PSA EX 5' })), /^pl:/);
});

test('r9: an upcoming lot hammering tonight in the US is not "past" because the UTC day turned', () => {
  const lot = (saleDate: string) => ({ id: 'goldin-x', artist: 'game-used', title: 't', category: 'object', auctionHouse: 'Goldin', saleName: 'Goldin Elite Auction', status: 'upcoming', saleDate, saleDateTime: `${saleDate}T02:00:00Z`, currency: 'USD' }) as unknown as AuctionLot;
  // 00:26Z Oct 11 = 20:26 ET Oct 10: the Oct 10 sale is still open
  const at = Date.parse('2026-10-11T00:26:00Z');
  const past3 = (r: { fatal: string[] }) => r.fatal.filter(f => f.startsWith('[3]'));
  assert.equal(past3(assertInvariants([lot('2026-10-10')], at)).length, 0);
  assert.equal(past3(assertInvariants([lot('2026-10-09')], at)).length, 1);
  // midday UTC: yesterday's sale is over everywhere
  assert.equal(past3(assertInvariants([lot('2026-10-10')], Date.parse('2026-10-11T13:00:00Z'))).length, 1);
});
