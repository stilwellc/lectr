/**
 * makers overhaul P3 polish (Oct 10): hotlink-safe faces, the value rungs,
 * reference model lines ("rolex daytona"), the line-aware maker search.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageHostTier, betterFace, bestLotImage } from '../img-host';
import { VALUE_FLOORS, VALUE_CEILINGS, triageFromParams, triageToParams, TRIAGE_DEFAULTS, valuePatchOf } from '../feed-filters';
import { refLineOf, makerLineOfWords, readWatchLine } from '../watch-ref';
import { matchRefs, type RefRow } from '../search-index';
import { searchRow, lineSearchOf, needleOf, followedRow, type Row } from '../entity/ledger';
import { refLabel } from '../../utils';

const CHR = 'https://www.christies.com/img/lotimages/2022/NYR/x.jpg?mode=max';
const SBY = 'https://sothebys-com.brightspotcdn.com/dims4/default/x/resize/421x421!/quality/90/?url=y';
const PHI = 'https://dist.phillips.com/auction-assets/NY030726/239452_001.jpg';
const WRI = 'https://www.wright20.com/items/index/220/129_1.jpg';

test('image host tiers: safe CDNs, UA-sensitive hosts (christies renders for readers), dead hosts last', () => {
  assert.equal(imageHostTier(SBY), 0);
  assert.equal(imageHostTier(PHI), 0);
  assert.equal(imageHostTier('https://images2.bonhams.com/image?src=a.jpg'), 0);
  assert.equal(imageHostTier('https://d2tt46f3mh26nl.cloudfront.net/public/Lots/a@1x'), 0);
  assert.equal(imageHostTier(WRI), 1);
  assert.equal(imageHostTier(CHR), 1);
  assert.equal(imageHostTier('https://www.julienslive.com/images/lot/1/1_xl.jpg'), 2);
  assert.equal(imageHostTier(null), 2);
  assert.equal(imageHostTier('not a url'), 2);
});

test('a face: a dead host never wins; among live hosts the most valuable picture', () => {
  // the $195M Christie's Marilyn keeps Warhol's face (it renders for readers)
  assert.equal(betterFace({ url: CHR, val: 195e6 }, { url: SBY, val: 1e6 }), false);
  assert.equal(betterFace({ url: SBY, val: 1e6 }, { url: CHR, val: 195e6 }), true);
  const JUL = 'https://www.julienslive.com/images/lot/1/1_xl.jpg';
  assert.equal(betterFace({ url: JUL, val: 9e6 }, { url: SBY, val: 1e3 }), true);
  assert.equal(betterFace({ url: SBY, val: 1e6 }, { url: PHI, val: 2e6 }), true);
  assert.equal(betterFace(null, { url: CHR, val: 1 }), true);
});

test('the live-lot fallback: first live-host photo, a dead host only when alone', () => {
  const JUL = 'https://www.julienslive.com/images/lot/1/1_xl.jpg';
  assert.equal(bestLotImage([{ imageUrl: JUL }, { imageUrl: null }, { imageUrl: CHR }, { imageUrl: SBY }]), CHR);
  assert.equal(bestLotImage([{ imageUrl: JUL }]), JUL);
  assert.equal(bestLotImage([{ imageUrl: null }]), null);
});

test('value rungs: $10K, $50K, $250K added; old links still read', () => {
  assert.deepEqual(VALUE_FLOORS, [1000, 5000, 10000, 25000, 50000, 100000, 250000]);
  assert.ok(VALUE_CEILINGS.includes(50000) && VALUE_CEILINGS.includes(10000));
  // the URL carries any positive number: an old 25K link and a new 50K one
  assert.equal(triageFromParams(new URLSearchParams('min=25000')).minUsd, 25000);
  assert.equal(triageFromParams(new URLSearchParams('max=50000')).maxUsd, 50000);
  const p = new URLSearchParams();
  triageToParams({ ...TRIAGE_DEFAULTS, minUsd: 50000 }, p);
  assert.equal(p.get('min'), '50000');
  assert.deepEqual(valuePatchOf('min:50000'), { minUsd: 50000, maxUsd: null });
});

test("a reference's model line is read off its own titles, never guessed", () => {
  const daytona = [
    'Rolex Cosmograph Daytona, Ref. 6263, a stainless steel chronograph',
    'ROLEX | DAYTONA REF 6263 "BIG RED"',
    'Rolex. A steel chronograph wristwatch, Daytona, ref. 6263',
    'Rolex 6263 chronograph',
  ];
  assert.equal(refLineOf(daytona, 'rolex'), 'daytona');
  // two titles is not a vote
  assert.equal(refLineOf(daytona.slice(0, 2), 'rolex'), null);
  // a split vote is no line
  assert.equal(refLineOf([...daytona.slice(0, 3), 'Rolex Submariner 6263', 'Rolex Submariner 6263', 'Rolex Submariner'], 'rolex'), null);
  // a line from another brand never lands on this maker
  assert.equal(readWatchLine('Patek Philippe Nautilus 5711', 'rolex'), null);
  assert.equal(makerLineOfWords('rolex', ['daytona']), 'daytona');
  assert.equal(makerLineOfWords('rolex', ['gmt', 'master', 'ii']), 'gmtmasterii');
  assert.equal(makerLineOfWords('audemars-piguet', ['royal', 'oak']), 'royaloak');
  assert.equal(makerLineOfWords('rolex', ['nautilus']), null);
});

test('"rolex daytona" finds the Daytona references, not only the bucket', () => {
  const REFS: RefRow[] = [
    { maker: 'rolex', ref: 'daytona', n: 47, med: 30000 },
    { maker: 'rolex', ref: '6263', n: 224, med: 150000, line: 'daytona' },
    { maker: 'rolex', ref: '116520', n: 144, med: 20000, line: 'daytona' },
    { maker: 'rolex', ref: '1680', n: 178, med: 12000, line: 'submariner' },
    { maker: 'patek-philippe', ref: '5711', n: 25, med: 90000, line: 'nautilus' },
  ];
  const hits = matchRefs('rolex daytona', REFS, refLabel, 6).map(h => h.row.ref);
  assert.deepEqual(hits, ['daytona', '6263', '116520']);
  assert.deepEqual(matchRefs('nautilus', REFS, refLabel, 6).map(h => h.row.ref), ['5711']);
});

const row = (over: Partial<Row>): Row => ({
  id: 'mk:rolex', kind: 'maker', label: 'Rolex', market: 'watches', tag: 'Watchmaker', discipline: null, hero: null,
  spark: null, live: 2, flags: 0, sold: 100, median: null, medianN: null, medianScope: null, revenue: 0, sold12: 0,
  sold12Since: null, record: null, verified: null, yoy: null, thin: false,
  liveLots: [{ id: 'a', title: 'A steel chronograph wristwatch', artist: 'rolex' }, { id: 'b', title: 'A Daytona chronograph', artist: 'rolex' }] as unknown as Row['liveLots'],
  topScore: 0, page: '/makers/rolex', feed: null,
  ...over,
} as Row);

test('a maker row survives "<maker> <its line>" with only the lots naming it', () => {
  const r = row({});
  assert.equal(lineSearchOf(r, needleOf('rolex daytona')), 'daytona');
  assert.equal(lineSearchOf(r, needleOf('daytona')), null);       // no maker word: the plain search
  assert.equal(lineSearchOf(r, needleOf('rolex nautilus')), null); // not a Rolex line
  const hit = searchRow(r, needleOf('rolex daytona'));
  assert.ok(hit);
  assert.equal(hit!.live, 1);
  assert.equal(hit!.liveLots[0].id, 'b');
  // nothing live names the line: the row stays, an honest 0
  const none = searchRow(row({ liveLots: [] }), needleOf('rolex daytona'));
  assert.ok(none);
  assert.equal(none!.live, 0);
  assert.equal(searchRow(r, needleOf('rolex nautilus')), null);
});

test('the Following lens: a followed name whole, else only its followed lots', () => {
  const r = row({});
  const isB = (l: { id: string }) => l.id === 'b';
  assert.equal(followedRow(r, true, () => false), r);
  const n = followedRow(r, false, isB as never);
  assert.ok(n);
  assert.equal(n!.live, 1);
  assert.equal(followedRow(r, false, () => false), null);
});
