import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../stall';

test('withTimeout: a read that answers in time keeps its value', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50, 'slow'), 7);
});

test('withTimeout: a read that never answers settles to the fallback by the deadline', async () => {
  const t0 = Date.now();
  assert.equal(await withTimeout(new Promise(() => {}), 30, 'slow'), 'slow');
  assert.ok(Date.now() - t0 < 500);
});

test('withTimeout: a failed read settles to the fallback, never throws', async () => {
  assert.equal(await withTimeout(Promise.reject(new Error('404')), 50, null), null);
});
