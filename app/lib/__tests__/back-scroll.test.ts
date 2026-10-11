/**
 * Back-scroll anchoring (app/lib/use-back-scroll): the reader's place is the
 * ROW at the top of the viewport and its offset, so a Back re-lands that row
 * however the page above it grew or shrank; the pixel offset is only the
 * fallback. The old plain-number slot still reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAnchorRow, landingY, parseAnchor } from '../use-back-scroll';

const rows = [
  { id: 'a', top: -300, bottom: -240 },
  { id: 'b', top: -240, bottom: 70 },   // mostly under a 64px nav: 6px showing
  { id: 'c', top: 70, bottom: 130 },
  { id: 'd', top: 130, bottom: 190 },
];

test('the anchor is the first row still showing below the nav', () => {
  assert.equal(pickAnchorRow(rows, 64, 900)?.id, 'c');
  // a row with half its body below the nav is still the reader's row
  assert.equal(pickAnchorRow([{ id: 'x', top: 20, bottom: 120 }, ...rows.slice(2)], 64, 900)?.id, 'x');
  // nothing on screen (the feed is all above, or all below the viewport)
  assert.equal(pickAnchorRow(rows.slice(0, 1), 64, 900), null);
  assert.equal(pickAnchorRow([{ id: 'z', top: 1000, bottom: 1060 }], 64, 900), null);
});

test('a mounted row lands at its old offset, whatever the page above did', () => {
  const anchor = { y: 5200, row: 'c', off: 70 };
  // the page above came back 3,800px shorter: the row now sits at 1,470 from a 0 scroll
  assert.equal(landingY(anchor, 1470, 0, 20_000), 1400);
  // and taller (the wall painted above it): the row is 300px lower than before
  assert.equal(landingY(anchor, 370, 5200, 20_000), 5500);
  // already in place: stays
  assert.equal(landingY(anchor, 70, 5200, 20_000), 5200);
});

test('no row yet: the pixel place, clamped to what the page can hold', () => {
  const anchor = { y: 5200, row: 'c', off: 70 };
  assert.equal(landingY(anchor, null, 0, 1400), 1400);
  assert.equal(landingY(anchor, null, 1400, 9000), 5200);
  assert.equal(landingY({ y: 300 }, null, 0, 9000), 300);
  assert.equal(landingY(anchor, -9999, 0, 9000), 0);
});

test('slots: the JSON anchor, the legacy number, and junk', () => {
  assert.deepEqual(parseAnchor('{"y":5200,"row":"c","off":70}'), { y: 5200, row: 'c', off: 70 });
  assert.deepEqual(parseAnchor('5200'), { y: 5200 });
  assert.equal(parseAnchor('0'), null);
  assert.equal(parseAnchor(null), null);
  assert.equal(parseAnchor('{oops'), null);
  assert.equal(parseAnchor('{"y":0}'), null);
  assert.deepEqual(parseAnchor('{"y":"x","row":"c"}'), null);
});
