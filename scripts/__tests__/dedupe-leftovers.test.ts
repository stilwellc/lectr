/**
 * corpus-normalize dedupe leftovers (Oct 2026 identity audit) — fixtures are
 * real corpus rows:
 *   · Wright/LAMA/Rago alphanumeric lot codes (wright-RA4 ≡ lama-RA4) and
 *     lettered sale slots (…/modern-design/2412a)
 *   · Phillips' two id schemes (phillips-UK010625-10 ≡ phillips-225570)
 *   · NFL Auction relists: the same item (photo + title) sold, then listed
 *     again weeks later → the earlier "sale" did not complete
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeWrightFamilyMirrors, dedupeUrlSchemeCollisions, markNflRelists } from '../lib/corpus-normalize';

type Row = Parameters<typeof markNflRelists>[0][number];
const L = (o: Record<string, unknown>): Row => ({ id: 'x', artist: 'design', title: 't', category: 'object', saleDate: '2026-01-01', status: 'sold', ...o }) as unknown as Row;
const ids = (xs: Row[]) => xs.map(x => String(x.id)).sort();

test('dedupeWrightFamilyMirrors: alphanumeric lot codes and lettered slots are mirrors too', () => {
  const lots = [
    L({ id: 'wright-RA4', auctionHouse: 'Wright', title: 'ESU 420-N', priceUsd: 9000, url: 'https://www.wright20.com/auctions/2002/10/modern-design/RA4' }),
    L({ id: 'lama-RA4', auctionHouse: 'LAMA', title: 'ESU 420-N', priceUsd: 9000, url: 'https://www.lamodern.com/auctions/2002/10/modern-design/RA4' }),
    // Rago-hosted under a wright- id, LAMA mirror; dates a day apart
    L({ id: 'wright-ABMG2', auctionHouse: 'Rago', title: 'Wohl side table', saleDate: '2018-05-20', url: 'https://www.ragoarts.com/auctions/2018/05/modern-design/2412a' }),
    L({ id: 'lama-ABMG2', auctionHouse: 'LAMA', title: 'Wohl side table', saleDate: '2018-05-19', url: 'https://www.lamodern.com/auctions/2018/05/modern-design/2412a' }),
    // a lettered slot alone (different codes) still pairs by the sale path
    L({ id: 'rago-ZZ1', auctionHouse: 'Rago', title: 'Lamp', url: 'https://www.ragoarts.com/auctions/2019/05/design/755a' }),
    L({ id: 'lama-ZZ2', auctionHouse: 'LAMA', title: 'Lamp', url: 'https://www.lamodern.com/auctions/2019/05/design/755a' }),
    // a short code shared by two DIFFERENT lots is not a mirror (code keys with the title)
    L({ id: 'wright-AB1', auctionHouse: 'Wright', title: 'Chair' }),
    L({ id: 'lama-AB1', auctionHouse: 'LAMA', title: 'Table' }),
  ];
  assert.equal(dedupeWrightFamilyMirrors(lots), 3);
  assert.deepEqual(ids(lots), ['lama-AB1', 'rago-ZZ1', 'wright-AB1', 'wright-ABMG2', 'wright-RA4']);
  assert.equal(dedupeWrightFamilyMirrors(lots), 0, 'idempotent');
});

test('dedupeUrlSchemeCollisions: Phillips sale-code row wins over the bare detail-id row', () => {
  const lots = [
    L({ id: 'phillips-UK010625-10', auctionHouse: 'Phillips', lotNumber: 10, saleDate: '2025-10-18', priceUsd: 131064, url: 'https://www.phillips.com/detail/george-condo/225570' }),
    L({ id: 'phillips-225570', auctionHouse: 'Phillips', saleDate: '2025-10-18', priceUsd: 134160, url: 'https://www.phillips.com/detail/george-condo/225570' }),
    L({ id: 'phillips-218717', auctionHouse: 'Phillips', status: 'bought_in', url: 'https://www.phillips.com/detail/george-condo/218717' }),
    L({ id: 'phillips-HK030225-65', auctionHouse: 'Phillips', status: 'bought_in', saleDate: '2025-11-25', url: 'https://www.phillips.com/detail/george-condo/218717' }),
    // distinct lots
    L({ id: 'phillips-NY011125-370', auctionHouse: 'Phillips', url: 'https://www.phillips.com/detail/george-condo/218825' }),
    L({ id: 'phillips-NY011125-371', auctionHouse: 'Phillips', url: 'https://www.phillips.com/detail/george-condo/218826' }),
  ];
  assert.equal(dedupeUrlSchemeCollisions(lots), 2);
  assert.deepEqual(ids(lots), ['phillips-HK030225-65', 'phillips-NY011125-370', 'phillips-NY011125-371', 'phillips-UK010625-10']);
  assert.equal(dedupeUrlSchemeCollisions(lots), 0, 'idempotent');
});

test('markNflRelists: same photo + title relisted within weeks → the earlier sale is unpaid; the later kept', () => {
  const img = (n: number) => `http://vafloc02.s3.amazonaws.com/isyn/images/f000/img-${n}-f.jpg`;
  const T = (s: string) => `${s} | The official auction site of the National Football League`;
  const N = (o: Record<string, unknown>) => L({ auctionHouse: 'NFL Auction', artist: 'game-used', ...o });
  const lots = [
    // sold 2025-10-14 at $3,630, relisted (same photo) and sold 2025-11-18
    N({ id: 'nflauction-5885667', title: T('STS - Chiefs Game Worn Jersey'), imageUrl: img(4401), saleDate: '2025-10-14', priceUsd: 3630 }),
    N({ id: 'nflauction-5948833', title: T('STS - Chiefs Game Worn Jersey'), imageUrl: img(4401), saleDate: '2025-11-18', priceUsd: 2650 }),
    // relisted and live again
    N({ id: 'nflauction-1', title: T('Crucial Catch - Texans Jersey'), imageUrl: img(4402), saleDate: '2026-08-20', priceUsd: 610 }),
    N({ id: 'nflauction-2', title: T('Crucial Catch - Texans Jersey'), imageUrl: img(4402), saleDate: '2026-09-15', status: 'upcoming', priceUsd: null }),
    // same title, DIFFERENT photo: two identical game-issued jerseys — untouched
    N({ id: 'nflauction-5829800', title: T('NFL - Cardinals Budda Baker Game Issued Pro Bowl Jersey Size 42'), imageUrl: img(4533106), saleDate: '2025-09-01', priceUsd: 480 }),
    N({ id: 'nflauction-6064881', title: T('NFL - Cardinals Budda Baker Game Issued Pro Bowl Jersey Size 42'), imageUrl: img(4605893), saleDate: '2025-10-01', priceUsd: 1000 }),
    // same photo + title but 8 months apart — left alone (photo reuse not ruled out)
    N({ id: 'nflauction-5842744', title: T('STS - Broncos Jerry Jeudy Game Worn Jersey'), imageUrl: img(4403), saleDate: '2025-09-09', priceUsd: 1500 }),
    N({ id: 'nflauction-6158475', title: T('STS - Broncos Jerry Jeudy Game Worn Jersey'), imageUrl: img(4403), saleDate: '2026-04-27', priceUsd: 680 }),
  ];
  const r = markNflRelists(lots);
  assert.deepEqual(r, { marked: 2, usd: 3630 + 610 });
  const by = Object.fromEntries(lots.map(l => [l.id, l as Row & { relistedAs?: string; compExclude?: string }]));
  assert.equal(by['nflauction-5885667'].status, 'unknown-result');
  assert.equal(by['nflauction-5885667'].relistedAs, 'nflauction-5948833');
  assert.equal(by['nflauction-5885667'].compExclude, 'relisted-unpaid');
  assert.equal(by['nflauction-5948833'].status, 'sold');
  assert.equal(by['nflauction-1'].relistedAs, 'nflauction-2');
  for (const id of ['nflauction-5829800', 'nflauction-6064881', 'nflauction-5842744', 'nflauction-6158475']) assert.equal(by[id].status, 'sold', id);
  assert.equal(markNflRelists(lots).marked, 0, 'idempotent');
});
