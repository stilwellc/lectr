/**
 * The quick-start interests on the account (app/lib/interests-sync): the
 * device's interests go up the first time a signed-in reader has none; after
 * that the account wins and the device mirrors it; rows read defensively.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOnSignIn, rowToInterests, interestsToRow, hasInterests, sameInterests, NO_TABLE } from '../interests-sync';
import { NO_INTERESTS, parseInterests, type Interests } from '../interests';

const dev: Interests = { v: 1, markets: ['tcg', 'sports'], minUsd: 100, maxUsd: 2000, at: '2026-10-20T10:00:00.000Z' };
const acct: Interests = { v: 1, markets: ['art'], minUsd: 5000, maxUsd: null, at: '2026-10-25T10:00:00.000Z' };

test('first sign-in with no row: the device’s interests go up and are used', () => {
  assert.deepEqual(mergeOnSignIn(dev, null), { use: dev, upload: true });
  assert.deepEqual(mergeOnSignIn(dev, NO_INTERESTS), { use: dev, upload: true }, 'an empty row counts as none');
});

test('afterwards the account wins — even an older account row over a newer device', () => {
  const older = { ...acct, at: '2026-10-01T00:00:00.000Z' };
  assert.deepEqual(mergeOnSignIn(dev, older), { use: older, upload: false });
  assert.deepEqual(mergeOnSignIn(NO_INTERESTS, acct), { use: acct, upload: false });
});

test('neither side has anything: nothing moves', () => {
  assert.deepEqual(mergeOnSignIn(NO_INTERESTS, null), { use: NO_INTERESTS, upload: false });
  assert.equal(hasInterests(NO_INTERESTS), false);
  assert.equal(hasInterests({ ...NO_INTERESTS, maxUsd: 1000 }), true);
});

test('rows read through the device’s own parser: numerics as strings, unknown markets dropped, an inverted range opened', () => {
  const i = rowToInterests({ markets: ['tcg', 'nope', 'tcg'], min_usd: '250', max_usd: '100', updated_at: '2026-10-25T10:00:00.000Z' });
  assert.deepEqual(i, { v: 1, markets: ['tcg'], minUsd: 250, maxUsd: null, at: '2026-10-25T10:00:00.000Z' });
  assert.deepEqual(rowToInterests(null), NO_INTERESTS);
  assert.deepEqual(rowToInterests({ markets: null, min_usd: null, max_usd: null }), NO_INTERESTS);
  // the row the client writes round-trips
  const row = interestsToRow(dev);
  assert.deepEqual(rowToInterests({ ...row, markets: row.markets }), dev);
  assert.deepEqual(rowToInterests(interestsToRow(acct)).markets, ['art']);
  assert.deepEqual(parseInterests(JSON.stringify(acct)), acct, 'the device parser accepts the same shape');
});

test('a mirror write that changes nothing is recognised; the missing-table error is', () => {
  assert.ok(sameInterests(dev, { ...dev, at: null }));
  assert.ok(!sameInterests(dev, { ...dev, markets: ['tcg'] }));
  assert.ok(NO_TABLE.test('relation "public.user_interests" does not exist'));
  assert.ok(NO_TABLE.test("Could not find the table 'public.user_interests' in the schema cache"));
  assert.ok(!NO_TABLE.test('permission denied for table saved_lots'));
});
