/**
 * THE DESK ROW (pass 6) — an SSR smoke test of DeskRow: the one row grammar
 * renders to static markup, the title link carries the row as one sentence
 * (tag · title · sub-line · the figure with its meaning), and the figure's
 * kind lands as data-fig so the stylesheet seats the three money forms alike.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// the row's graph reaches a stylesheet (Terminal → .css) Node cannot parse: stub the extension
(Module as unknown as { _extensions: Record<string, (m: unknown, f: string) => void> })._extensions['.css'] = () => {};
declare const require: NodeRequire;
const { DeskRow, figureWordsOf, priceFigureOf } = require('../desk/row') as typeof import('../desk/row');

const lot = {
  id: 'bonhams-1-1', title: 'Cow, 1976', artist: 'andy-warhol', auctionHouse: 'Bonhams', status: 'upcoming',
  saleDate: '2026-11-04', saleDateTime: null, estimateLow: 4600, estimateHigh: 6900, imageUrl: null,
} as unknown as import('../../types').AuctionLot;

test('DeskRow: the title link reads the row as one sentence, the figure carries its kind', () => {
  const html = renderToStaticMarkup(
    <DeskRow lot={lot} tag={{ text: 'Below market', tone: 'up' }} sub="Andy Warhol · Bonhams"
      figure={<span>$4.6K–$6.9K</span>} figureKind="est" figureText="$4.6K–$6.9K" figureSub="estimate" />,
  );
  assert.match(html, /aria-label="Below market\. Cow, 1976\. Andy Warhol · Bonhams\. estimate \$4\.6K–\$6\.9K"/);
  assert.match(html, /class="dk-fig" data-fig="est"/);
  assert.match(html, /data-nav-row/);
  assert.match(html, /data-nav-focus=""/);
  // no photo: the maker's initial stands in and says so
  assert.match(html, /role="img" aria-label="A — no photo of Andy Warhol"/);
});

test('DeskRow: a live bid and a hammer say what they are', () => {
  const bid = renderToStaticMarkup(<DeskRow lot={lot} sub="Andy Warhol · Bonhams" figure="$8K" figureKind="bid" figureSub="12 bids" />);
  assert.match(bid, /aria-label="Cow, 1976\. Andy Warhol · Bonhams\. live bid \$8K, 12 bids"/);
  assert.match(bid, /data-fig="bid"/);
  const ham = renderToStaticMarkup(<DeskRow lot={lot} sub="Andy Warhol · Bonhams" figure="$1.3K" figureKind="hammer" figureSubText="+12% vs estimate" figureSub={<b>+12%</b>} />);
  assert.match(ham, /hammered \$1\.3K, \+12% vs estimate"/);
  assert.equal(figureWordsOf('clock', '8:30 AM', 'in 14h 30m'), 'closes 8:30 AM, in 14h 30m');
});

test('DeskRow: a compact row and an expanding row keep their hooks', () => {
  const html = renderToStaticMarkup(
    <DeskRow lot={lot} compact figure="$1.3K" figureKind="hammer" expand={{ open: false, id: 'd1', onToggle: () => {} }} />,
  );
  assert.match(html, /data-compact="true"/);
  assert.match(html, /data-expand=""/);
  assert.match(html, /aria-expanded="false" aria-controls="d1"/);
  // the words for the printed-bid gate
  assert.deepEqual(priceFigureOf(lot), { fig: '$4.6K–$6.9K', sub: 'estimate', quiet: false, kind: 'est' });
});
