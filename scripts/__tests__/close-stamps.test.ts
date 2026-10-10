/**
 * Crawler close stamps (Oct 9 2026): fields the Phillips and Bonhams crawls
 * already fetch carry the real close — Phillips maker-lots API stamps are
 * sale-local with an offset; Bonhams hammerTime is a per-lot instant.
 * Shapes are the live API's (probed Oct 9 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phillipsCloseStamp } from '../lib/houses/phillips';
import { bonhamsCloseStamp } from '../lib/houses/bonhams';

test('Phillips: online → END stamp; one-day live room → session start; multi-day room → none', () => {
  // NY080426 (online watches, Oct 1–9 2026)
  assert.deepEqual(phillipsCloseStamp(3, '2026-10-01T10:00:00-04:00', '2026-10-09T10:00:00-04:00'),
    { at: '2026-10-09T10:00:00-04:00', kind: 'online' });
  // online with no end stamp: nothing honest to stamp
  assert.equal(phillipsCloseStamp(3, '2026-10-01T10:00:00-04:00', '0001-01-01T00:00:00+00:00'), null);
  // UK011126 (live, one day)
  assert.deepEqual(phillipsCloseStamp(1, '2026-10-17T13:00:00+01:00', '2026-10-17T18:00:00+01:00'),
    { at: '2026-10-17T13:00:00+01:00', kind: 'session' });
  // HK010726 (live, no end stamp)
  assert.deepEqual(phillipsCloseStamp(1, '2026-09-30T18:00:00+08:00', '0001-01-01T00:00:00+00:00'),
    { at: '2026-09-30T18:00:00+08:00', kind: 'session' });
  // NY030726 (live, Oct 22 → Oct 24): which session a lot sells in isn't in the feed
  assert.equal(phillipsCloseStamp(1, '2026-10-22T17:00:00-04:00', '2026-10-24T12:00:00-04:00'), null);
  assert.equal(phillipsCloseStamp(1, undefined, undefined), null);
});

test('Bonhams: hammerTime is the close (ONLINE) or the session start (live rooms)', () => {
  assert.deepEqual(bonhamsCloseStamp('2026-10-21T10:39:00+00:00', 'ONLINE'), { at: '2026-10-21T10:39:00+00:00', kind: 'online' });
  assert.deepEqual(bonhamsCloseStamp('2026-10-29T13:00:00+00:00', 'PUBLIC'), { at: '2026-10-29T13:00:00+00:00', kind: 'session' });
  assert.equal(bonhamsCloseStamp(undefined, 'ONLINE'), null);
  assert.equal(bonhamsCloseStamp('soon', 'ONLINE'), null);
});
