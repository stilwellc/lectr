#!/usr/bin/env node
/**
 * back-scroll.e2e.mjs — Back from a lot returns the reader to the SAME ROW of
 * the feed (app/lib/use-back-scroll + LotBrowser's data-lot-row), on home and
 * on a LotBrowser-backed entity page, desktop and phone, by client-side and
 * by hard (document) navigation, including a slow network where the whole
 * book lands long after the first-screen slice.
 *
 *   BASE=http://localhost:3000 node scripts/e2e/back-scroll.e2e.mjs
 *   (CASES=home-1440,maker-390 to pick; SHOTS=dir for screenshots)
 *
 * Installed Chrome, HEADED (some image hosts refuse HeadlessChrome). Exits 1
 * on any case whose top row before ≠ after.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const SHOTS = process.env.SHOTS || '';
const MAKER = process.env.MAKER || '/makers/andy-warhol';
const PLAYER = process.env.PLAYER || '/player?id=michael-jordan';
const CAT = process.env.CAT || '/makers/sports-cards'; // a category maker → home's feed, scoped
const ROWS = '[data-lot-row]';

const ALL = [
  { name: 'home-1440', path: '/?tab=all', w: 1440, h: 900, depth: 5200, nav: 'client' },
  { name: 'home-390', path: '/?tab=all', w: 390, h: 844, depth: 5200, nav: 'client' },
  { name: 'home-1440-hard-slow', path: '/?tab=all', w: 1440, h: 900, depth: 5200, nav: 'hard', slowMbps: 3 },
  { name: 'home-390-hard-slow', path: '/?tab=all', w: 390, h: 844, depth: 5200, nav: 'hard', slowMbps: 3 },
  { name: 'maker-1440', path: MAKER, w: 1440, h: 900, depth: 2600, nav: 'client' },
  { name: 'maker-390', path: MAKER, w: 390, h: 844, depth: 2600, nav: 'hard' },
  { name: 'player-1440', path: PLAYER, w: 1440, h: 900, depth: 2200, nav: 'client' },
  { name: 'player-390', path: PLAYER, w: 390, h: 844, depth: 2200, nav: 'client' },
  { name: 'cat-390', path: CAT, w: 390, h: 844, depth: 2600, nav: 'hard' },
];
const pick = (process.env.CASES || '').split(',').filter(Boolean);
const cases = pick.length ? ALL.filter(c => pick.includes(c.name)) : ALL;

// the same rule as use-back-scroll's pickAnchorRow: the first row still
// showing below the sticky nav
const topRow = page => page.evaluate(sel => {
  const nav = document.querySelector('nav, header');
  const edge = Math.max(0, Math.min(140, nav ? nav.getBoundingClientRect().bottom : 0));
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    if (r.bottom - edge < Math.min(24, r.height / 2)) continue;
    if (r.top >= innerHeight) return null;
    return { id: el.getAttribute('data-lot-row'), top: Math.round(r.top), y: Math.round(scrollY) };
  }
  return null;
}, ROWS);

async function run(browser, c) {
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, isMobile: c.w < 500, hasTouch: c.w < 500 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(BASE + c.path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(ROWS, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  // page the feed until it reaches past the depth
  for (let i = 0; i < 20; i++) {
    const bottom = await page.evaluate(sel => { const a = document.querySelectorAll(sel); const l = a[a.length - 1]; return l ? l.getBoundingClientRect().bottom + scrollY : 0; }, ROWS);
    if (bottom > c.depth + c.h) break;
    const more = page.locator('.ray-show-more');
    if (!(await more.count())) break;
    await more.first().scrollIntoViewIfNeeded();
    await more.first().click();
    await page.waitForTimeout(500);
  }
  // the depth, or — a short live book — a row deep in the feed
  const lastRowY = await page.evaluate(sel => { const a = document.querySelectorAll(sel); const l = a[Math.max(0, a.length - 3)]; return l ? l.getBoundingClientRect().top + scrollY : 0; }, ROWS);
  await page.evaluate(y => window.scrollTo(0, y), Math.min(c.depth, Math.max(0, lastRowY - 150)));
  await page.waitForTimeout(600); // the settled-scroll save
  const before = await topRow(page);
  if (!before) throw new Error(`${c.name}: no feed row at the viewport top (depth ${c.depth})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/w20-backscroll-${c.name}-before.png` });

  // open the row's lot (the modal), then the lot's own page from it
  await page.locator(`[data-lot-row="${before.id}"]`).first().evaluate(el => {
    const b = el.querySelector('.t-title') || el.querySelector('button') || el;
    b.click();
  });
  const lotLink = page.locator('a[href^="/lot?id="]').first();
  await lotLink.waitFor({ timeout: 20_000 });
  if (c.slowMbps) {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  }
  if (c.nav === 'hard') {
    const href = await lotLink.getAttribute('href');
    await page.evaluate(h => { location.href = h; }, href);
  } else {
    await lotLink.click();
  }
  await page.waitForURL(/\/lot/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  if (c.slowMbps) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: c.slowMbps * 125_000, uploadThroughput: 94_000 });
  }
  await page.goBack({ waitUntil: 'commit' });

  // the row may take a slow book's time to come back: poll up to 40s
  let after = null;
  const t0 = Date.now();
  let stableSince = 0;
  while (Date.now() - t0 < 40_000) {
    await page.waitForTimeout(250);
    after = await topRow(page).catch(() => null);
    if (after && after.id === before.id && Math.abs(after.top - before.top) <= 8) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince > 2500) break; // held through the settle
    } else stableSince = 0;
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/w20-backscroll-${c.name}-after.png` });
  await ctx.close();
  const ok = !!after && after.id === before.id && Math.abs(after.top - before.top) <= 8;
  return { name: c.name, ok, before, after, ms: Date.now() - t0 };
}

const browser = await chromium.launch({ channel: 'chrome', headless: false });
let failed = 0;
for (const c of cases) {
  try {
    const r = await run(browser, c);
    if (!r.ok) failed++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}: before ${JSON.stringify(r.before)} after ${JSON.stringify(r.after)}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${c.name}: ${e.message}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
