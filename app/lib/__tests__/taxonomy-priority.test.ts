/**
 * The clean taxonomy (app/lib/taxonomy) and the "matters most" score
 * (app/lib/priority): every raw shape lands in a known { cat, sub }, sport is
 * a separate facet, the anchor never re-converts USD estimates, Edge only fires
 * in the categories with a measured edge, and the shortlist caps hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taxonOf, SUBS, subMatches } from '../taxonomy';
import { prioStatic, priorityOf, shortlist, urgencyOf, reasonOf, spread } from '../priority';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

test('taxonomy: pseudo-artists, culture split, makers', () => {
  assert.deepEqual(taxonOf({ artist: 'sports-cards', subCat: 'cards', drill: 'baseball' }), { cat: 'sports-cards', sub: 'singles', sport: 'baseball' });
  assert.deepEqual(taxonOf({ artist: 'unopened-wax', subCat: 'wax', drill: 'tennis' }), { cat: 'sports-cards', sub: 'sealed-wax', sport: 'other-sports' });
  assert.deepEqual(taxonOf({ artist: 'game-used', subCat: 'game-used' }), { cat: 'sports-memorabilia', sub: 'game-used', sport: undefined });
  assert.deepEqual(taxonOf({ artist: 'pokemon', subCat: 'pokemon-sealed', drill: 'vintage' }), { cat: 'tcg', sub: 'sealed' });
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'documents', drill: 'political' }), { cat: 'historical', sub: 'political' });
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'props', drill: 'hollywood' }), { cat: 'entertainment', sub: 'props-costumes', domain: 'film-tv' });
  assert.deepEqual(taxonOf({ artist: 'space-exploration', subCat: 'space', drill: 'apollo' }), { cat: 'space-science', sub: 'apollo' });
  assert.deepEqual(taxonOf({ artist: 'patek-philippe', subCat: 'pocket-watches' }), { cat: 'watches', sub: 'pocket' });
  assert.deepEqual(taxonOf({ artist: 'jean-prouve', subCat: 'seating' }), { cat: 'design', sub: 'seating' });
  assert.deepEqual(taxonOf({ artist: 'andy-warhol', subCat: 'prints' }), { cat: 'fine-art', sub: 'prints' });
  assert.deepEqual(taxonOf({ artist: 'some-unknown-slug' }), { cat: 'fine-art', sub: 'other' });
});

test('taxonomy: every emitted sub is in the SUBS table', () => {
  const shapes = [
    { artist: 'sports-cards' }, { artist: 'graded-cards' }, { artist: 'memorabilia' }, { artist: 'equipment-artifacts' },
    { artist: 'pokemon', drill: 'weird' }, { artist: 'music-memorabilia', subCat: 'awards' }, { artist: 'movie-tv', subCat: 'zzz' },
    { artist: 'fossils' }, { artist: 'charles-eames', subCat: 'storage' }, { artist: 'rolex' },
  ];
  for (const s of shapes) {
    const t = taxonOf(s);
    assert.ok(SUBS[t.cat].some(x => x.key === t.sub), `${JSON.stringify(s)} → ${t.cat}/${t.sub}`);
  }
});

test('priority: anchor uses USD estimates as-is (no FX re-conversion)', () => {
  const p = prioStatic({ artist: 'patek-philippe', estimateLow: 4600, estimateHigh: 6900, currency: 'EUR' } as never);
  assert.equal(p?.a, 5750);
  assert.equal(p?.src, 'est');
});

test('priority: anchor order est → engine → validated projection → bid; none → null', () => {
  assert.equal(prioStatic({ artist: 'sports-cards', value: { expectedHammerUsd: 9000 }, currentBid: 100 })?.src, 'engine');
  assert.equal(prioStatic({ artist: 'sports-cards', bidProj: { ok: true, allIn: 12200 }, currentBid: 100 })?.a, 10000);
  assert.equal(prioStatic({ artist: 'sports-cards', bidProj: { allIn: 12200 }, currentBid: 100 })?.src, 'bid');
  assert.equal(prioStatic({ artist: 'sports-cards' }), null);
});

test('priority: Edge only in measured-edge categories', () => {
  const flagged = { signal: { label: 'Below Market' }, value: { signal: { beatRatePct: 52 } }, estimateLow: 10000, estimateHigh: 10000 };
  assert.equal(prioStatic({ ...flagged, artist: 'jean-prouve' })?.edge, 1);
  assert.equal(prioStatic({ ...flagged, artist: 'rolex' })?.edge, 0);
  assert.equal(prioStatic({ ...flagged, artist: 'sports-cards' })?.edge, 0);
  assert.equal(prioStatic({ artist: 'andy-warhol', signal: { label: 'Above Market' }, estimateLow: 10000 })?.edge, -0.25);
});

test('priority: urgency windows and closed lots', () => {
  assert.equal(urgencyOf(NOW + 2 * 3_600_000, NOW), 1);
  assert.equal(urgencyOf(NOW + 48 * 3_600_000, NOW), 0.6);
  assert.equal(urgencyOf(NOW + 100 * 3_600_000, NOW), 0.25);
  assert.equal(urgencyOf(NOW + 400 * 3_600_000, NOW), 0);
  assert.equal(urgencyOf(NOW - 3_600_000, NOW), 0);
  const p = priorityOf({ artist: 'andy-warhol', estimateLow: 20_000_000, estimateHigh: 20_000_000, saleDateTime: inHours(3), value: { confidence: 'high' } }, NOW);
  assert.equal(p?.score, 40 + 20 + 15);
});

test('shortlist: floor, window and caps', () => {
  const lots = [];
  for (let i = 0; i < 12; i++) {
    lots.push({ id: `w${i}`, artist: 'andy-warhol', auctionHouse: "Christie's", saleDate: '2026-10-08', saleName: 'Post-War',
      saleDateTime: inHours(5), estimateLow: 100000 + i, estimateHigh: 100000 + i });
  }
  lots.push({ id: 'cheap', artist: 'kaws', auctionHouse: 'Phillips', saleDate: '2026-10-08', saleDateTime: inHours(5), estimateLow: 900, estimateHigh: 1200 });
  lots.push({ id: 'far', artist: 'kaws', auctionHouse: 'Phillips', saleDate: '2026-10-30', saleDateTime: inHours(500), estimateLow: 90000, estimateHigh: 90000 });
  const out = shortlist(lots, NOW, 20);
  assert.equal(out.length, 2, 'one maker in one sale: ≤2 per maker wins over ≤3 per sale');
  assert.ok(!out.some(l => l.id === 'cheap' || l.id === 'far'));
});

test('shortlist: the same object listed twice takes one seat', () => {
  const twin = (id: string) => ({ id, artist: 'jean-prouve', auctionHouse: 'Wright', saleDate: '2026-10-08', saleName: 'Design',
    title: 'Bench from the Électricité de France, Marcoule', saleDateTime: inHours(6), estimateLow: 20000, estimateHigh: 20000 });
  const out = shortlist([twin('a'), twin('b')], NOW, 20);
  assert.deepEqual(out.map(l => l.id), ['a']);
});

test('reasonOf: close time, value basis, edge', () => {
  const r = reasonOf({ artist: 'jean-prouve', saleDateTime: inHours(4), estimateLow: 30000, estimateHigh: 30000,
    signal: { label: 'Below Market' }, value: { signal: { beatRatePct: 52 } } }, NOW);
  assert.equal(r, 'Closes in 4h · Below market');
  assert.equal(reasonOf({ artist: 'sports-cards', saleDateTime: inHours(30), value: { expectedHammerUsd: 220000 } }, NOW), 'Closes tomorrow · $220K engine value');
});

test('taxonomy v2: new subs, culture routing, aliases', () => {
  assert.deepEqual(taxonOf({ artist: 'pablo-picasso', subCat: 'ceramics' }), { cat: 'fine-art', sub: 'ceramics' });
  assert.deepEqual(taxonOf({ artist: 'charles-eames', subCat: 'case-storage' }), { cat: 'design', sub: 'storage' });
  assert.deepEqual(taxonOf({ artist: 'rolex', subCat: 'clocks' }), { cat: 'watches', sub: 'clocks' });
  assert.deepEqual(taxonOf({ artist: 'cartier', subCat: 'watch-accessories' }), { cat: 'watches', sub: 'clocks' });
  assert.deepEqual(taxonOf({ artist: 'sports-cards', subCat: 'card-lots', drill: 'baseball' }), { cat: 'sports-cards', sub: 'lots', sport: 'baseball' });
  assert.deepEqual(taxonOf({ artist: 'sports-cards', subCat: 'tcg-other' }), { cat: 'tcg', sub: 'other-tcg' });
  assert.deepEqual(taxonOf({ artist: 'pokemon', subCat: 'pokemon-memorabilia' }), { cat: 'tcg', sub: 'memorabilia' });
  assert.deepEqual(taxonOf({ artist: 'tickets-passes', subCat: 'tickets' }).sub, 'tickets');
  assert.deepEqual(taxonOf({ artist: 'programs-publications', subCat: 'programs' }).sub, 'programs');
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'cel-art' }), { cat: 'entertainment', sub: 'animation' });
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'props', drill: 'hollywood' }), { cat: 'entertainment', sub: 'props-costumes', domain: 'film-tv' });
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'documents', drill: 'aviation' }), { cat: 'historical', sub: 'aviation' });
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'documents', drill: 'crime' }), { cat: 'historical', sub: 'crime' });
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'autographs', drill: 'sports' }), { cat: 'sports-memorabilia', sub: 'autographs' });
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', drill: 'apollo' }), { cat: 'space-science', sub: 'apollo' });
  assert.ok(subMatches('sports-memorabilia', 'tickets-programs', 'tickets'));
  assert.ok(subMatches('sports-memorabilia', 'tickets-programs', 'programs'));
  assert.ok(!subMatches('sports-memorabilia', 'tickets-programs', 'autographs'));
  for (const [cat, subs] of Object.entries(SUBS)) assert.equal(new Set(subs.map(x => x.key)).size, subs.length, `${cat} has duplicate keys`);
});

test('priority (Oct 9): each market on its own size scale', () => {
  const card = prioStatic({ artist: 'sports-cards', currentBid: 40_000, bidCount: 12 })!;
  const art = prioStatic({ artist: 'andy-warhol', estimateLow: 40_000, estimateHigh: 40_000 })!;
  assert.ok(card.size > art.size, 'a $40K card is big for cards, a $40K Warhol is minor for fine art');
  assert.equal(card.ev, 0.6, '8+ bids = the room agrees on a price');
  assert.equal(prioStatic({ artist: 'sports-cards', currentBid: 500, bidCount: 1 })!.ev, 0.15);
});

test('priority (Oct 9): a bid past the estimate becomes the anchor and voids the edge', () => {
  const p = prioStatic({ artist: 'mahatma-gandhi', subCat: 'autographs', estimateLow: 2000, estimateHigh: 3000, currentBid: 3960, currency: 'USD',
    signal: { label: 'Below Market' }, value: { signal: { beatRatePct: 60 } } } as never)!;
  assert.equal(p.a, 3960);
  assert.equal(p.over, true);
  assert.equal(p.edge, 0);
});

test('shortlist (Oct 9): one seat per card identity, one sale = house + close day', () => {
  const jordan = (id: string, g: number) => ({ id, artist: 'sports-cards', auctionHouse: 'Goldin', saleDate: '2026-10-09',
    title: `1986 Fleer #57 Michael Jordan Rookie Card - PSA ${g}`, saleDateTime: inHours(20), currentBid: 9000 + g, bidCount: 20 });
  const out = shortlist([jordan('a', 9), jordan('b', 8), jordan('c', 7)], NOW, 20);
  assert.deepEqual(out.map(l => l.id), ['a']);
  const ch = (id: string, saleName: string, artist: string) => ({ id, artist, auctionHouse: "Christie's", saleDate: '2026-10-09', saleName,
    saleDateTime: inHours(6), estimateLow: 5_000_000, estimateHigh: 5_000_000, title: id });
  const other = (id: string) => ({ id: `o${id}`, artist: `maker-${id}`, auctionHouse: 'Phillips', saleDate: `2026-10-1${id}`,
    saleDateTime: inHours(30 + Number(id) * 24), estimateLow: 300_000, estimateHigh: 300_000, title: `w${id}` });
  const evening = shortlist([ch('1', 'Evening Sale', 'francis-bacon'), ch('2', 'London Sale 25228', 'andy-warhol'),
    ch('3', 'Evening Sale', 'pablo-picasso'), ch('4', 'London Sale 25228', 'alexander-calder'), other('1'), other('2'), other('3')], NOW, 6);
  assert.equal(evening.filter(l => l.auctionHouse === "Christie's").length, 3, 'two sale names, one evening: ≤3 seats while other sales can fill');
  // a pool that IS one room (the reader narrowed to it) may fill past 3 once nothing else qualifies
  assert.equal(shortlist([ch('1', 'Evening Sale', 'francis-bacon'), ch('2', 'London Sale 25228', 'andy-warhol'),
    ch('3', 'Evening Sale', 'pablo-picasso'), ch('4', 'London Sale 25228', 'alexander-calder')], NOW, 20).length, 4);
});

test('spread (Oct 9): ≤3 per sale in any 12, order otherwise kept', () => {
  const lots = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, artist: `maker-${i}`, auctionHouse: 'REA', saleDate: '2026-10-18' }))
    .concat([{ id: 'x', artist: 'other', auctionHouse: 'Goldin', saleDate: '2026-10-10' }]);
  const out = spread(lots);
  assert.deepEqual(out.slice(0, 4).map(l => l.id), ['r0', 'r1', 'r2', 'x']);
  assert.equal(out.length, lots.length);
});

test('reasonOf (Oct 9): date-only sales name the day, not an hour', () => {
  const d = new Date(NOW); const iso = (n: number) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + n)).toISOString().slice(0, 10);
  assert.equal(reasonOf({ artist: 'jean-prouve', saleDate: iso(0), estimateLow: 30000, estimateHigh: 30000 }, NOW), 'Sells today');
  assert.equal(reasonOf({ artist: 'jean-prouve', saleDate: iso(3), estimateLow: 30000, estimateHigh: 30000 }, NOW), 'Sells in 3 days');
});
