/**
 * Per-link share previews (functions/_lib/share.ts): a shared /lot?id= link
 * must unfurl as THAT lot — its title, sale facts and house photo — not the
 * generic site card every lot link used to get.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isUnfurler, lotShareMeta, money, rewriteHead, shareImg, type ShareLot } from '../../functions/_lib/share';

const LOT: ShareLot = {
  id: 'bonhams-31994-572', artist: 'rolex', title: 'Oyster Date Precision, Ref: 6066, Circa 1952',
  imageUrl: 'https://images1.bonhams.com/image?src=Images/live/2026-10/07/60156941-2-1.jpg',
  auctionHouse: 'Bonhams', saleDate: '2026-10-29', lotNumber: 572, currency: 'GBP',
  estimateLow: 931, estimateHigh: 1197, status: 'upcoming', value: { n: 6, signal: { label: 'at comparable market' } },
};

const SHELL = `<!DOCTYPE html><html><head><meta charSet="utf-8"/><title>Lot — lectr</title>`
  + `<meta name="description" content="One lot, read against every comparable hammer — lectr auction intelligence."/>`
  + `<meta property="og:title" content="lectr — auction intelligence"/><meta property="og:description" content="generic"/>`
  + `<meta property="og:image" content="https://lectr.bid/opengraph-image?v=1"/><meta property="og:image:width" content="1200"/>`
  + `<meta property="og:image:height" content="630"/><meta name="twitter:card" content="summary_large_image"/>`
  + `<meta name="twitter:title" content="lectr"/><meta name="twitter:image" content="https://lectr.bid/opengraph-image?v=1"/>`
  + `</head><body><div id="app">lot shell</div></body></html>`;

test('unfurlers are recognised, people are not', () => {
  for (const ua of [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0', // iMessage
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'Twitterbot/1.0', 'WhatsApp/2.23.20.0',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', 'TelegramBot (like TwitterBot)', 'LinkedInBot/1.0',
  ]) assert.ok(isUnfurler(ua), ua);
  for (const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', null, '',
  ]) assert.ok(!isUnfurler(ua), String(ua));
});

test('money keeps the sale currency', () => {
  assert.equal(money(1197, 'GBP'), '£1,197');
  assert.equal(money(30000, 'USD'), '$30K');
  assert.equal(money(1_250_000, 'EUR'), '€1.25M');
  assert.equal(money(500, 'XYZ'), 'XYZ 500');
});

test('a lot reads as itself', () => {
  const m = lotShareMeta(LOT);
  assert.equal(m.title, 'Oyster Date Precision, Ref: 6066, Circa 1952 — Rolex — lectr');
  assert.match(m.description, /est\. £931–£1,197 · Bonhams · lot 572 · Oct 29, 2026\./);
  assert.match(m.description, /Comparable sales: at comparable market \(6 sales\)\./);
  assert.equal(m.image, `${LOT.imageUrl}&width=1200`);
  assert.equal(m.url, 'https://lectr.bid/lot?id=bonhams-31994-572');
});

test('a sold lot leads with what it sold for; no photo keeps the site card', () => {
  const m = lotShareMeta({ ...LOT, status: 'sold', realizedNative: 2400, imageUrl: null });
  assert.match(m.description, /^Sold for £2,400 · Bonhams/);
  assert.equal(m.image, undefined);
  const html = rewriteHead(SHELL, m);
  assert.match(html, /og:image" content="https:\/\/lectr\.bid\/opengraph-image\?v=1"/);   // untouched
  assert.match(html, /og:image:width/);
});

test('the head is rewritten, the body is not', () => {
  const html = rewriteHead(SHELL, lotShareMeta(LOT));
  assert.match(html, /<title>Oyster Date Precision, Ref: 6066, Circa 1952 — Rolex — lectr<\/title>/);
  assert.match(html, /<meta property="og:title" content="Oyster Date Precision/);
  assert.match(html, /<meta property="og:image" content="https:\/\/images1\.bonhams\.com\/image\?src=[^"]+&amp;width=1200"\/>/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/images1\.bonhams/);
  assert.match(html, /<meta property="og:url" content="https:\/\/lectr\.bid\/lot\?id=bonhams-31994-572"\/>/);
  assert.doesNotMatch(html, /og:image:width/);                                   // a house photo isn't 1200×630
  assert.equal((html.match(/property="og:title"/g) || []).length, 1);
  assert.ok(html.endsWith('<body><div id="app">lot shell</div></body></html>'));
});

test('quotes and angle brackets in a title cannot break out of the tag', () => {
  const html = rewriteHead(SHELL, lotShareMeta({ ...LOT, title: 'A "chair" <b>bold</b> & co' }));
  assert.match(html, /content="A &quot;chair&quot; &lt;b&gt;bold&lt;\/b&gt; &amp; co — Rolex — lectr"/);
  assert.doesNotMatch(html, /<b>bold/);
});

test('Christie\'s originals are sized for unfurlers', () => {
  assert.equal(shareImg('http://www.christies.com/img/LotImages/2026/x.jpg'), 'https://www.christies.com/img/LotImages/2026/x.jpg?w=1200');
});

test('works on the real /lot shell when a build is present', { skip: !fs.existsSync(path.join(process.cwd(), 'out/lot.html')) }, () => {
  const shell = fs.readFileSync(path.join(process.cwd(), 'out/lot.html'), 'utf8');
  const html = rewriteHead(shell, lotShareMeta(LOT));
  assert.match(html, /<title>Oyster Date Precision/);
  assert.equal((html.match(/property="og:image"/g) || []).length, 1);
  assert.equal((html.match(/name="twitter:image"/g) || []).length, 1);
  assert.equal(html.length - shell.length < 2000, true);
});
