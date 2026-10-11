/**
 * The first paint (perf wave W27, app/lib/first-paint): the gate's slot
 * words are the page's own words at every clock, the viewport classes read
 * a page's width queries the way a phone / desktop does, and the postbuild
 * proves a zone's window only over byte-identical steps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FP_SLOT_JS, FP_GATE_JS, FP_ZONES, fpMatches, fpSlot, pinClock, unpinClock,
} from '../first-paint';
import { reasonOf, closeMsOf } from '../priority';
import { closeIsTimed } from '../house-tz';
import { foldPage, slotify, normalize, deferImages } from '../../../scripts/first-paint-postbuild';
import { entitiesFirst } from '../../../scripts/emit-first-screen';
import type { AuctionLot } from '../../types';

// the gate's slot function, exactly as the gate inlines it
// eslint-disable-next-line no-new-func
const slot = new Function(`return (${FP_SLOT_JS})`)() as (p: string[], now: number) => string;

const TIMING = /^(?:Closes within the hour|Closes in \d+h|Closes tomorrow|Closes in \d+ days|Sells today|Sells tomorrow|Sells in \d+ days)$/;
const timingOf = (r: string | null) => (r || '').split(' · ').find(p => TIMING.test(p)) ?? '';

function lot(over: Partial<AuctionLot>): AuctionLot {
  return {
    id: 'goldin-1', title: 'Card', artist: 'graded-cards', auctionHouse: 'Goldin', status: 'upcoming',
    saleDate: '2026-10-14', estimateLow: 40000, estimateHigh: 60000, currency: 'USD',
    ...over,
  } as AuctionLot;
}

test("slot 'r' prints reasonOf's timing part at every clock, timed and date-only, in every proved zone", () => {
  const lots = [
    lot({ id: 'goldin-1', saleDateTime: '2026-10-14T02:00:00Z', saleDate: '2026-10-13' }),
    lot({ id: 'rr-1', auctionHouse: 'RR Auction', saleDate: '2026-10-15', saleDateTime: undefined }),
    lot({ id: 'christies-1', auctionHouse: "Christie's", saleDate: '2026-10-12', saleDateTime: '2026-10-12T15:00:00Z', currentBid: 70000, bidCount: 5 }),
  ];
  const from = Date.parse('2026-10-11T03:00:00Z');
  let checked = 0;
  for (const zone of ['America/New_York', 'America/Los_Angeles', 'UTC', 'Europe/London']) {
    for (let t = from; t < from + 6 * 24 * 3.6e6; t += 17 * 60_000) {
      pinClock(t, zone);
      try {
        for (const l of lots) {
          const want = timingOf(reasonOf(l, t));
          if (!want) continue;
          const close = closeMsOf(l)!;
          const timed = closeIsTimed(l);
          const got = slot(['r', String(close), timed ? '1' : '0', timed ? '' : (l.saleDate || '').slice(0, 10)], t);
          assert.equal(got, want, `${l.id} at ${new Date(t).toISOString()} in ${zone}`);
          checked++;
        }
      } finally { unpinClock(); }
    }
  }
  assert.ok(checked > 1000, `swept ${checked} clocks`);
});

test('the pinned clock reads the zone and instant, and lets go', () => {
  const before = process.env.TZ;
  pinClock(Date.parse('2026-10-12T02:00:00Z'), 'America/New_York');
  assert.equal(Date.now(), Date.parse('2026-10-12T02:00:00Z'));
  assert.equal(new Date().getDate(), 11);
  unpinClock();
  assert.equal(process.env.TZ, before);
  assert.ok(Math.abs(Date.now() - new Date().getTime()) < 1000);
});

test('viewport classes answer width queries as a 390px phone and a 1440px desktop', () => {
  assert.equal(fpMatches('m', '(max-width: 639px)'), true);
  assert.equal(fpMatches('m', '(max-width: 820px)'), true);
  assert.equal(fpMatches('m', '(min-width: 900px)'), false);
  assert.equal(fpMatches('d', '(min-width: 900px)'), true);
  assert.equal(fpMatches('d', '(max-width: 899px)'), false);
});

test('the gate body is hash-listed in public/_headers', () => {
  const h = `'sha256-${createHash('sha256').update(FP_GATE_JS).digest('base64')}'`;
  const headers = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', '_headers'), 'utf8');
  assert.ok(headers.includes(h), `add ${h} to public/_headers script-src`);
});

/* ── the postbuild fold ── */
const T0 = Date.parse('2026-10-11T12:00:00Z');
const step = (v: string, zone: string, k: number, body: string) =>
  `<template data-fsv="${v}|${zone}|${T0 + k * 20 * 60_000}">${body}</template>`;
const big = (s: string) => `<div class="row">${s}</div>${'<i></i>'.repeat(120)}`;
function page(bodyAt: (v: string, zone: string, k: number) => string, ks = 4): string {
  let steps = '';
  for (const v of ['m', 'd']) for (const z of FP_ZONES) for (let k = 0; k < ks; k++) steps += step(v, z, k, bodyAt(v, z, k));
  return `<main><div data-fsi="home" hidden="" data-t0="${T0}" data-loc="en-US">${steps}</div><div class="loading"></div></main>`;
}

test('a zone is proved up to its last identical step; slot words and useIds never break a window', () => {
  const html = page((v, z, k) => big(`${v} ${fpSlot('r', [T0 + 9e6, 1, ''], `Closes in ${3 - k}h`)} <svg id="_R_${k}ab_"></svg>${z === 'UTC' && k >= 2 ? ' later' : ''}${z === 'Europe/London' ? ' other' : ''}`));
  const r = foldPage(html);
  assert.equal(r.islands, 1);
  assert.equal(r.shown, 1);
  const z = r.zones[0];
  assert.equal(z['America/New_York'], T0 + 3 * 20 * 60_000);
  assert.equal(z.UTC, T0 + 1 * 20 * 60_000);
  assert.equal(z['Europe/London'], undefined);
  assert.ok(!r.html.includes('<template data-fsv'), 'steps folded away');
  assert.ok(r.html.includes('<span data-fpr="r|'), 'slot spans');
  assert.ok(r.html.includes('<div data-v="m">') && r.html.includes('<div data-v="d">'));
  assert.ok(r.html.includes(`<script>${FP_GATE_JS}</script>`));
  assert.ok(r.html.includes('<div class="loading"></div>'), 'the loading line stays');
});

test('a step left pending, or one that printed nothing, proves nothing', () => {
  const pending = foldPage(page(() => big('<!--$?--><template id="B:0"></template>')));
  assert.equal(pending.shown, 0);
  assert.ok(/<div data-fsi="home" hidden=""[^>]*><\/div>/.test(pending.html), 'ships empty');
  const empty = foldPage(page(() => ''));
  assert.equal(empty.shown, 0);
});

test('slot markers inside an attribute stay plain words', () => {
  const h = `<a title="${fpSlot('r', [1, 1, ''], 'Closes in 2h')}">${fpSlot('r', [1, 1, ''], 'Closes in 2h')}</a>`;
  assert.equal(slotify(h), '<a title="Closes in 2h"><span data-fpr="r|1|1|">Closes in 2h</span></a>');
  assert.equal(normalize(slotify(h)), '<a title="Closes in 2h"><span data-fpr="r|1|1|">§</span></a>');
});

test("the copy's off-site photos (and their alt words) wait for the page's own render; same-site images stay", () => {
  assert.equal(
    deferImages('<img src="https://cdn.x/a.jpg" alt="Card" loading="lazy"><img src="/brand/m.png" alt="lectr"><img srcset="//c/x 2x" src="http://y/b" alt="">'),
    '<img data-fp-src="https://cdn.x/a.jpg" alt="" data-fp-alt="Card" loading="lazy"><img src="/brand/m.png" alt="lectr"><img data-fp-srcset="//c/x 2x" data-fp-src="http://y/b" alt="">',
  );
});

test("the total market's entities slice is the makers' columns of the same wire", () => {
  const w = { v: 2, tier: 'main', tailN: 3, ds: ['a'], ml: [], c: { id: ['mk:a', 'pl:b', 'mk:c'], s: [1, 2, 3] }, vf: { 'mk:a': { x: 1 }, 'pl:b': { y: 1 } } };
  assert.deepEqual(entitiesFirst(w), { v: 2, tier: 'main', tailN: 3, ds: ['a'], ml: [], c: { id: ['mk:a', 'mk:c'], s: [1, 3] }, vf: { 'mk:a': { x: 1 } } });
  assert.equal(entitiesFirst({ v: 1, entities: [] }), null);
});
