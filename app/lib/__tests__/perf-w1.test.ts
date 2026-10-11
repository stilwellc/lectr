/**
 * PERF WAVE W1 (Oct 11 2026) — every first-load cut must leave every number
 * where it was. These pin the four changes:
 *   1. sizedImg asks the host's resizer for the slot size (Christie's,
 *      Cloudinary, Phillips) and never rewrites a URL it cannot size safely;
 *   2. served rows drop the dead `_vn` vector norm — the live counts, the
 *      one-lot-one-number face and the decision line are identical without it;
 *   3. the "Matters most" comparator scores each lot once — same order;
 *   4. closeMs is memoised per lot — same instant, and a rewritten stamp
 *      recomputes.
 * The book-wide checks run on the served upcoming.json when it is present
 * (a data-less checkout skips them) and on a synthetic book always.
 */
import { pinClock } from './helpers/pin-clock';
pinClock('2026-10-09T20:00:00Z');

import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { sizedImg, getUpcomingCounts } from '../../utils';
import { slimForClient } from '../../../scripts/corpus-io';
import { byPriority, priorityOf, closeMsOf } from '../priority';
import { closeMs } from '../house-tz';
import { lotFace, decisionOf } from '../lot-face';
import { routeReadsLiveBook } from '../../components/RayDataPreloads';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const UP = path.join(ROOT, 'public/data/ray/upcoming.json');
const NOW = Date.parse('2026-10-09T20:00:00Z');
const book: AuctionLot[] | null = existsSync(UP) ? (JSON.parse(readFileSync(UP, 'utf8')).lots as AuctionLot[]) : null;

// ── 1. image sizing ─────────────────────────────────────────────────────────
test('sizedImg: Christie\'s gets ?mode=max&w=, never twice', () => {
  const u = 'https://www.christies.com/img/lotimages/2026/NYR/2026_NYR_24498_0339_000(andy_warhol_torso_c_1976124206).jpg?mode=max';
  assert.equal(sizedImg(u, 120), u + '&w=120');
  const bare = 'https://www.christies.com/img/lotimages/2026/NYR/x.jpg';
  assert.equal(sizedImg(bare, 240), bare + '?mode=max&w=240');
  assert.equal(sizedImg(u + '&w=500', 120), u + '&w=500');
});

test('sizedImg: Cloudinary transform goes before the version, never onto a transformed URL', () => {
  const u = 'https://res.cloudinary.com/robertedwardauctions/image/upload/v1791473276/2026-October/210012-1.jpg';
  assert.equal(sizedImg(u, 120), 'https://res.cloudinary.com/robertedwardauctions/image/upload/w_120,c_limit,q_auto/v1791473276/2026-October/210012-1.jpg');
  const t = 'https://res.cloudinary.com/acct/image/upload/t_thumb/v1/x.jpg';
  assert.equal(sizedImg(t, 120), t);
  const signed = 'https://res.cloudinary.com/acct/image/upload/s--abc--/w_900/v1/x.jpg';
  assert.equal(sizedImg(signed, 120), signed);
});

test('sizedImg: Phillips box shrinks, never grows', () => {
  const u = 'https://dist.phillips.com/auction-assets/NY030726/239452_001.jpg?bg-color=ffffff&pad=0&fit=bounds&height=550&optimize=medium&width=605';
  assert.equal(sizedImg(u, 240), 'https://dist.phillips.com/auction-assets/NY030726/239452_001.jpg?bg-color=ffffff&pad=0&fit=bounds&height=240&optimize=medium&width=240');
  assert.equal(sizedImg(u, 1280), u);
});

test('sizedImg: hosts that cannot be resized safely are untouched', () => {
  for (const u of [
    'https://sothebys-md.brightspotcdn.com/dims4/default/a39b4cb/2147483647/strip/true/crop/1246x1574+0+0/resize/1024x1294!/quality/90/?url=x',
    'https://cdn.rrauction.com/auction/751/preview/3517151_1.jpg',
    'https://s1.img.bidsquare.com/item/xl/3920/39209382.jpeg',
  ]) assert.equal(sizedImg(u, 120), u);
  // the pre-existing rewrites keep their behaviour
  assert.equal(sizedImg('https://images1.bonhams.com/image?src=a.jpg', 160), 'https://images1.bonhams.com/image?src=a.jpg&width=160');
  assert.equal(sizedImg(null, 120), undefined);
});

// ── 2. the dead _vn norm ────────────────────────────────────────────────────
test('slimForClient strips _vn (and nothing a face reads)', () => {
  const row = { id: 'x', title: 'T', _vn: 21.85, cardComps: { med: 216, n: 1 }, value: { compValueUsd: 100 } };
  const out = slimForClient(row);
  assert.equal('_vn' in out, false);
  assert.deepEqual(out.cardComps, row.cardComps);
  assert.deepEqual(out.value, row.value);
});

function withoutVn(l: AuctionLot): AuctionLot {
  const c = { ...l } as AuctionLot & { _vn?: number };
  delete c._vn;
  return c;
}

test('served book: counts, faces and decision lines are identical without _vn', { skip: !book }, () => {
  const slim = book!.map(withoutVn);
  assert.deepEqual(getUpcomingCounts(slim), getUpcomingCounts(book!));
  for (let i = 0; i < book!.length; i++) {
    assert.deepEqual(lotFace(slim[i]), lotFace(book![i]), book![i].id);
    assert.deepEqual(decisionOf(slim[i], NOW), decisionOf(book![i], NOW), book![i].id);
  }
});

// ── 3. the memoised comparator ──────────────────────────────────────────────
/** the comparator exactly as it was before the memo (recompute per compare) */
function naiveByPriority(nowMs: number) {
  return (x: AuctionLot, y: AuctionLot): number => {
    const px = priorityOf(x, nowMs), py = priorityOf(y, nowMs);
    if (!px || !py) return px ? -1 : py ? 1 : 0;
    if (py.score !== px.score) return py.score - px.score;
    const cx = closeMsOf(x) ?? Infinity, cy = closeMsOf(y) ?? Infinity;
    if (cx !== cy) return cx - cy;
    return py.a - px.a;
  };
}

function synthBook(n: number): AuctionLot[] {
  const houses = ["Christie's", 'Goldin', 'RR Auction', 'Phillips', 'Bonhams', 'REA'];
  const out: AuctionLot[] = [];
  for (let i = 0; i < n; i++) {
    const day = 9 + (i % 9);
    out.push({
      id: `s-${i}`, artist: i % 3 ? 'sports-cards' : 'andy-warhol', title: `Lot ${i} ${i % 7 ? 'PSA 9' : 'screenprint'}`,
      category: 'x', auctionHouse: houses[i % houses.length], saleDate: `2026-10-${String(day).padStart(2, '0')}`,
      saleDateTime: i % 4 ? `2026-10-${String(day).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z` : null,
      estimateLow: i % 5 ? 1000 * (i % 13) : null, estimateHigh: i % 5 ? 1500 * (i % 13) : null,
      currentBid: i % 2 ? 50 * (i % 40) : undefined, bidCount: i % 11, status: 'upcoming', priceUsd: null,
    } as unknown as AuctionLot);
  }
  return out;
}

test('byPriority (memoised) sorts exactly like the recompute-per-compare comparator', () => {
  const pools = [synthBook(800), ...(book ? [book] : [])];
  for (const pool of pools) {
    const a = pool.slice().sort(naiveByPriority(NOW)).map(l => l.id);
    const b = pool.slice().sort(byPriority(NOW)).map(l => l.id);
    assert.deepEqual(b, a);
  }
});

// ── 4. the memoised close clock ─────────────────────────────────────────────
test('closeMs memo: same instant as a fresh copy, and a rewritten stamp recomputes', () => {
  const pool = book || synthBook(400);
  for (const l of pool) {
    const first = closeMs(l);
    assert.equal(closeMs(l), first);
    assert.equal(closeMs({ ...l }), first, l.id); // a fresh object computes from scratch
  }
  const l = { id: 'm', auctionHouse: 'Goldin', saleDate: '2026-10-12', saleDateTime: '2026-10-12T03:00:00Z' } as AuctionLot;
  const t1 = closeMs(l);
  (l as { saleDateTime?: string }).saleDateTime = '2026-10-13T03:00:00Z';
  assert.equal(closeMs(l), (t1 as number) + 864e5);
});

// ── preloads ────────────────────────────────────────────────────────────────
test('the live-book preloads skip only the static routes', () => {
  for (const p of ['/about', '/blog', '/blog/q2-2026-art', '/styleguide']) assert.equal(routeReadsLiveBook(p), false, p);
  for (const p of ['/', '/makers', '/makers/andy-warhol', '/value', '/profile', '/lot', '/lot/x', '/player', '/sports', '/blogger', null]) assert.equal(routeReadsLiveBook(p as string), true, String(p));
});
