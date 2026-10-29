/**
 * THE EMAIL-CLIENT LINT (Oct 29 2026) — the rendered Daily Desk against what
 * Gmail, Outlook and Apple Mail strip or break. A rich edition is rendered
 * and walked; any of these fails the run:
 *   flexbox / grid / position / negative margins / CSS variables
 *   a <style> block that carries layout (only color-scheme lines may live there)
 *   an <img> without width, height and alt · an href that is not https
 *   a <table> without role="presentation" · a fixed width over 600
 *   a non-table element with a fixed px width over 360 (it would not fit a
 *   390px phone beside the gutters)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import { planDesk } from '../lib/daily-desk';
import { renderDesk } from '../lib/daily-desk-html';

const NOW = Date.parse('2026-10-21T12:20:00Z');
const H = 3600_000;
const lot = (id: string, closeIn: number, extra: Partial<AuctionLot> = {}): AuctionLot => ({
  id, title: `Lot ${id}`, artist: 'andy-warhol', auctionHouse: "Christie's", status: 'upcoming', currency: 'USD', ek: 'mk:andy-warhol',
  saleDate: new Date(NOW + closeIn).toISOString().slice(0, 10), saleDateTime: new Date(NOW + closeIn).toISOString(),
  estimateLow: 1000, estimateHigh: 2000, imageUrl: `https://img.example/${id}.jpg`, firstSeen: '2026-10-21', ...extra,
} as unknown as AuctionLot);

/** every section populated, the welcome on, a trim forced */
function richHtml(): string {
  const book = Array.from({ length: 30 }, (_, k) => lot(`l${k}`, (k + 2) * H, { currentBid: 100 + k, bidCount: k, signal: k % 2 ? { label: 'Below Market', pct: 40, basis: 6, kind: 'form', confidence: 'low' } : null } as unknown as Partial<AuctionLot>));
  const d = planDesk({
    now: NOW, tz: 'America/New_York',
    watches: [
      ...book.slice(0, 10).map((l, k) => ({ lot_id: l.id, max_usd: k % 2 ? 50 : 5000, bid_count: 1 })),
      { lot_id: 'own-1', saved_title: 'Cow, 1976', saved_artist: 'andy-warhol', owned: true, paid_usd: 12_000 },
      { lot_id: 'sold-1', max_usd: 10_000, est_mid: 8_000 },
    ],
    live: new Map(book.map(l => [l.id, l])), book,
    sold: [{ id: 'sold-1', title: 'Card', house: 'REA', price_usd: 12_000, sale_date: '2026-10-20', image_url: 'https://img.example/s.jpg' }],
    picks: book.slice(10, 18).map((l, k) => ({ lot: l, note: 'Like your prints', lane: { kind: k < 3 ? 'follow' as const : 'saved' as const, label: k < 3 ? 'Because you follow Andy Warhol' : `Because you saved ${k}`, who: null } })),
    follows: [{ kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' }, { kind: 'maker', key: 'kaws', label: 'KAWS' }, { kind: 'cat', key: 'fine-art:prints', label: 'Prints' }],
    nameSold: new Map([['mk:andy-warhol', { id: 's9', p: 243_200, d: '2026-10-20', h: "Christie's", t: 'African Elephant' }]]),
    nameRecent: new Map([['mk:andy-warhol', [{ id: 's9', p: 243_200, d: '2026-10-20', h: "Christie's", t: 'African Elephant' }]]]),
    receipts: { rows: Array.from({ length: 6 }, (_, k) => ({ id: `r${k}`, k: 'card', d: '2026-10-10', sd: '2026-10-20', p: 1000, r: 900, m: 'art', t: 'Row', h: 'Phillips' })) },
    backtest: { flagged: { n: 2903, medianPerfPct: 44 }, unflagged: { n: 14906, medianPerfPct: 20 } },
    pendingResults: 12, lastSentOn: null,
  })!;
  const { html } = renderDesk(d, { origin: 'https://lectr.bid', unsubUrl: 'https://lectr.bid/api/email/unsubscribe?t=x', dateLabel: 'Wednesday, Oct 21', sizeCap: 20_000 });
  assert.ok(html.includes('Welcome to the Daily Desk') && html.includes('Trimmed for your inbox') && html.includes('Your collection') && html.includes('The market'));
  return html;
}

const tags = (html: string, tag: string) => html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) || [];
const attr = (tag: string, name: string) => new RegExp(`\\s${name}=("[^"]*"|'[^']*'|[^\\s>]+)`, 'i').exec(tag)?.[1]?.replace(/^["']|["']$/g, '') ?? null;
const styleOf = (tag: string) => attr(tag, 'style') || '';

test('email lint: no flex, grid, position, negative margins or CSS variables anywhere', () => {
  const html = richHtml();
  for (const bad of [/display\s*:\s*(?:flex|grid|inline-flex|inline-grid)/i, /position\s*:\s*(?:absolute|fixed|relative|sticky)/i, /margin(?:-(?:top|right|bottom|left))?\s*:\s*-\d/i, /var\(--/i, /calc\(/i, /@media/i, /transform\s*:/i]) {
    assert.ok(!bad.test(html), `found ${bad}`);
  }
});

test('email lint: the <style> block carries only color-scheme lines, never layout', () => {
  const html = richHtml();
  const blocks = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || [];
  assert.ok(blocks.length <= 1);
  for (const b of blocks) {
    const body = b.replace(/<\/?style[^>]*>/gi, '').trim();
    assert.match(body, /^:root\{(?:(?:color-scheme|supported-color-schemes):[^;}]+;?)+\}$/, `layout in <style>: ${body}`);
  }
});

test('email lint: every image has width, height and alt; every link is https', () => {
  const html = richHtml();
  const imgs = tags(html, 'img');
  assert.ok(imgs.length > 5);
  for (const img of imgs) {
    assert.ok(/^\d+$/.test(attr(img, 'width') || ''), `img without width: ${img}`);
    assert.ok(/^\d+$/.test(attr(img, 'height') || ''), `img without height: ${img}`);
    assert.ok(attr(img, 'alt') != null, `img without alt: ${img}`);
    assert.match(attr(img, 'src') || '', /^https:\/\//, `img not https: ${img}`);
  }
  const links = tags(html, 'a');
  assert.ok(links.length > 20);
  for (const a of links) assert.match(attr(a, 'href') || '', /^https:\/\//, `link not https: ${a}`);
});

test('email lint: every table is presentational and nothing is fixed wider than the card or a phone', () => {
  const html = richHtml();
  // the MSO wrapper is inside a conditional comment: it is a table too, and it is presentational
  for (const t of tags(html, 'table')) assert.equal(attr(t, 'role'), 'presentation', `table without role: ${t}`);
  for (const t of tags(html, '(?:table|td|th|img|div|span|a)')) {
    const w = attr(t, 'width');
    if (w && /^\d+$/.test(w)) assert.ok(Number(w) <= 600, `fixed width over 600: ${t}`);
    const m = /(?:^|;)\s*width\s*:\s*(\d+)px/i.exec(styleOf(t));
    if (!m) continue;
    const px = Number(m[1]);
    assert.ok(px <= 600, `style width over 600: ${t}`);
    // a non-table element fixed wider than 360px cannot sit inside the 390px phone's gutters
    if (!/^<(?:table|td|th)\b/i.test(t)) assert.ok(px <= 360, `fixed ${px}px on a phone: ${t}`);
  }
  // the card itself is fluid: a 600 attribute with a max-width, never a fixed style width
  const card = tags(html, 'table').find(t => attr(t, 'width') === '600' && /max-width/.test(styleOf(t)));
  assert.ok(card && /width\s*:\s*100%/.test(styleOf(card)));
});

test('email lint: light only is declared for every client, the lamp pills are solid', () => {
  const html = richHtml();
  assert.ok(html.includes('<meta name="color-scheme" content="light only">'));
  assert.ok(html.includes('<meta name="supported-color-schemes" content="light only">'));
  assert.ok(html.includes('<!--[if mso]>'));
  const pills = html.match(/<span style="[^"]*border-radius:999px[^"]*"/g) || [];
  assert.ok(pills.length > 3);
  for (const p of pills) {
    assert.match(p, /background-color:#[0-9A-Fa-f]{6}/, `pill without a solid background: ${p}`);
    assert.match(p, /color:#ffffff/, `pill without white ink: ${p}`);
    assert.ok(!/gradient|rgba|var\(/.test(p));
  }
});
