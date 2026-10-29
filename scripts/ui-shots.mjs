/**
 * THE SHOT RIG — nightly visual regression for the north-star UI.
 *
 * Captures the key routes at two viewports in both modes, then diffs each
 * capture against the approved baseline in tests/ui-baseline/. Any frame
 * drifting more than THRESHOLD writes a red-overlay diff to shots/diff/
 * and fails the run — the "gray blob on cream" class of bug gets caught
 * by the robot, not by Collin.
 *
 *   node scripts/ui-shots.mjs                  # capture + diff vs baseline (default BASE_URL = prod; CI = local pinned build)
 *   node scripts/ui-shots.mjs --approve        # bless current as baseline
 *   BASE_URL=http://localhost:3000 node ...    # pre-ship local check
 *   LOT_ID=<id> node ...                       # pin the /lot/<id> frame
 *   BASELINE_DIR=/tmp/bl node ...              # diff against a scratch baseline (never seeds tests/)
 *
 * Animations are neutralized (reduced-motion + a transition kill switch)
 * so frames are deterministic; the live data itself changes nightly, so
 * data-bearing regions will drift a little — THRESHOLD is calibrated to
 * catch layout/color breaks, not a moved sparkline.
 *
 * A page that GROWS (one more row on the tape) is not a regression: when
 * the capture and the baseline differ in height, the overlap is diffed and
 * the extra rows count as drifted pixels — the run no longer fails on a
 * bare "size changed". Every failure logs its frame name, the drifted pixel
 * count, and the size delta; the summary repeats the failing names.
 *
 * PINNED DATA (Sep 27 2026). Diffing PROD meant every nightly's data moved
 * the frames — the rig was red 28 days straight and caught nothing. In CI
 * (.github/workflows/ui-shots.yml) the site is now BUILT from a frozen served
 * payload (R2 key committed in tests/ui-baseline/FIXTURE, installed with
 * `data-store.sh pull-fixture`) and served locally by `wrangler pages dev`,
 * so only CODE moves pixels. Determinism knobs:
 *   SHOT_NOW=<ISO>       freeze Date.now()/new Date() (timers keep running) —
 *                        "closes in 3h", "tonight", countdowns render the same
 *   SHOT_OFFLINE=1       only same-origin + Google Fonts load; external images
 *                        (auction CDNs) get a flat placeholder, every other
 *                        external request (Supabase, APIs) is aborted
 *   SHOT_ROUTES=/,/value capture only these routes (quick local check)
 *   SHOT_MASK=a,b        extra CSS selectors to mask (always masked:
 *                        [data-volatile], [data-shot-mask])
 * A MISSING BASELINE IS A FAILURE (it used to silently seed itself, so six
 * new routes were never compared). Only --approve writes baselines.
 *
 * THE DESK FRAME (Oct 29 2026, pass 8): /profile on a POPULATED desk —
 * profile-desk-{desktop,mobile}-{light,dark}. The plain /profile frame is
 * the signed-out desk; the rooms on DeskRow (Watching, Today, the week,
 * History, Names, Budget…) only exist with saves. Before navigation the
 * rig seeds localStorage (`ray-saved-lots`, `lectr-follows`, `lectr-picks`)
 * with ids DERIVED AT RUNTIME from the served payload (resolveDeskSeed:
 * eight upcoming lots with photos across three or more houses, closing
 * after SHOT_NOW, soonest first; six sold ids from the served sold ledger;
 * follows from the picked lots' makers) — so the frame is deterministic
 * for the pinned fixture and survives a re-pin without a hand-kept id
 * list. SHOT_NOW (the workflow sets it an hour after the fixture's crawl)
 * is the desk's clock: closes read live, "saved 10 days ago" is fixed.
 *
 * Re-baselining (CI renders with Linux fonts — never approve from a Mac):
 *   gh workflow run ui-shots.yml -f approve=true
 *   gh run download <run-id> -n ui-baseline -D tests/ui-baseline
 *   git add tests/ui-baseline && git commit -m "ui-shots: re-baseline"
 * To move the data too, first `bash scripts/data-store.sh pin-fixture`
 * (needs R2 write) and commit tests/ui-baseline/FIXTURE with the baselines.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'https://lectr.bid';
const APPROVE = process.argv.includes('--approve');
const THRESHOLD_PCT = 2.5; // % of pixels allowed to drift (anti-aliasing, font hinting)
const SHOT_NOW = process.env.SHOT_NOW ? new Date(process.env.SHOT_NOW) : null;
if (SHOT_NOW && Number.isNaN(SHOT_NOW.getTime())) throw new Error(`SHOT_NOW is not a date: ${process.env.SHOT_NOW}`);
const OFFLINE = process.env.SHOT_OFFLINE === '1';
const MASKS = ['[data-volatile]', '[data-shot-mask]', ...(process.env.SHOT_MASK || '').split(',').map(s => s.trim()).filter(Boolean)];
// 1x1 mid-grey PNG — stands in for every external image in offline mode
const PLACEHOLDER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNYsGDBfwAGpALgO+f6bgAAAABJRU5ErkJggg==', 'base64');
const ORIGIN = new URL(BASE).origin;
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
// a real Chrome UA — the auction CDNs (and some of our own image hosts)
// serve broken images to HeadlessChrome, which reads as a false regression
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** the /lot/<id> frame needs a permalink that exists tonight: LOT_ID pins
    one; otherwise the first flagged lot on the live book (the same set the
    build statically emits — app/lot/flagged.ts). */
async function resolveLotId() {
  if (process.env.LOT_ID) return process.env.LOT_ID;
  try {
    const res = await fetch(`${BASE}/data/ray/upcoming.json`);
    const lots = (await res.json())?.lots || [];
    const hit = lots.find(l => l && typeof l.id === 'string' && l.signal?.label === 'Below Market');
    return hit?.id || null;
  } catch {
    return null;
  }
}

/** THE DESK SEED — what a populated /profile needs in localStorage, read from
    the payload the rig is pointed at (never a hand-kept list of ids) */
const DESK_ROUTE = '/profile?desk=1';   // the query is the rig's marker only; the page ignores it
const DAY = 864e5;
async function resolveDeskSeed() {
  const now = SHOT_NOW ? SHOT_NOW.getTime() : Date.now();
  const json = async (p) => { const r = await fetch(`${BASE}${p}`); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
  try {
    const up = await json('/data/ray/upcoming.json');
    const lots = (up?.lots || []).filter(l => l && typeof l.id === 'string' && l.imageUrl && l.saleDate && Date.parse(`${l.saleDate}T23:59:59Z`) > now && l.status === 'upcoming');
    // soonest first; then round-robin across houses so three or more houses are on the desk
    lots.sort((a, b) => Date.parse(a.saleDateTime || `${a.saleDate}T23:59:59Z`) - Date.parse(b.saleDateTime || `${b.saleDate}T23:59:59Z`));
    const byHouse = new Map();
    for (const l of lots) { if (!byHouse.has(l.auctionHouse)) byHouse.set(l.auctionHouse, []); byHouse.get(l.auctionHouse).push(l); }
    const houses = [...byHouse.keys()];
    const live = [];
    for (let i = 0; live.length < 8 && houses.length; i++) {
      const q = byHouse.get(houses[i % houses.length]);
      const l = q?.shift();
      if (l) live.push(l);
      if (houses.every(h => !byHouse.get(h).length)) break;
    }
    // six settled ids: the payload's own recentSold (titled, priced, per market — the
    // most recent sales first); else the served sold ledger's first shard (id → [price, day])
    let sold = [];
    const rs = up?.recentSold;
    const recent = rs && typeof rs === 'object' ? Object.values(rs).flat().filter(l => l && typeof l.id === 'string' && l.priceUsd > 0 && l.saleDate) : [];
    if (recent.length) {
      sold = recent.sort((a, b) => String(b.saleDate).localeCompare(String(a.saleDate))).slice(0, 6)
        .map(l => ({ id: l.id, price: l.priceUsd, day: l.saleDate, title: l.title || null, artist: l.artist || null }));
    } else {
      try {
        const led = await json('/data/ray/sold-ledger-0.json');
        sold = Object.entries(led).filter(([id, v]) => typeof id === 'string' && Array.isArray(v) && v[0] > 0 && typeof v[1] === 'string')
          .sort((a, b) => b[1][1].localeCompare(a[1][1])).slice(0, 6).map(([id, v]) => ({ id, price: v[0], day: v[1], title: null, artist: null }));
      } catch (err) { console.log(`[shots] desk seed: no sold ledger (${String(err).slice(0, 80)}) — settled rooms stay empty`); }
    }
    const makers = [...new Set(live.map(l => l.playerSlug || l.artist).filter(Boolean))].slice(0, 2);
    const savedAt = new Date(now - 10 * DAY).toISOString();
    const seed = {
      saves: [
        ...live.map((l, n) => ({ id: l.id, savedAt, estMid: null, signalPct: null, bidCount: null, maxUsd: n === 1 ? 900 : null })),
        ...sold.map((s, n) => ({ id: s.id, savedAt: new Date(now - 30 * DAY).toISOString(), estMid: null, signalPct: null, bidCount: null, title: s.title, artist: s.artist, owned: n === 0 })),
      ],
      follows: [...makers.map(k => ({ kind: 'maker', key: k, label: k.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })), { kind: 'cat', key: 'art', label: 'Art' }],
      // the pick log: two of the sold lots as picks shown a week ago — How your picks did renders
      picks: { v: 1, picks: sold.slice(0, 2).map((s, n) => ({ id: s.id, t0: now - 9 * DAY, t: now - 7 * DAY, d: 2, r: n + 1, s: 'p', k: 'follow', lot: { title: s.title || `Settled lot ${n + 1}`, artist: s.artist || '', saleDate: s.day }, v: null, est: [Math.round(s.price * 0.7), Math.round(s.price * 1.1)] })) },
    };
    console.log(`[shots] desk seed: ${live.length} live (${[...new Set(live.map(l => l.auctionHouse))].join(', ')}) · ${sold.length} settled · follows ${seed.follows.map(f => f.label).join(', ')}`);
    return live.length ? seed : null;
  } catch (err) {
    console.log(`[shots] desk seed failed (${String(err).slice(0, 120)}) — the desk frame is skipped`);
    return null;
  }
}

const lotId = await resolveLotId();
const deskSeed = await resolveDeskSeed();
// SHOT_ROUTES=/,/value — capture only these (a quick local check); default = all
const ONLY = (process.env.SHOT_ROUTES || '').split(',').map(s => s.trim()).filter(Boolean);
const ALL_ROUTES = [
  '/', '/value', '/analytics', '/makers', '/blog', '/about', '/styleguide',
  '/receipts', '/profile',
  ...(deskSeed ? [DESK_ROUTE] : []),
  '/player?id=michael-jordan',
  '/ref/rolex/1002',
  '/sub/tcg/pokemon-cards',
  ...(lotId ? [`/lot/${lotId}`] : []),
];
const ROUTES = ONLY.length ? ALL_ROUTES.filter(r => ONLY.includes(r) || (r.startsWith('/lot/') && ONLY.includes('/lot')) || (r === DESK_ROUTE && ONLY.includes('/profile-desk'))) : ALL_ROUTES;
if (!lotId) console.log('[shots] no flagged lot resolved — /lot frame skipped (set LOT_ID to pin one)');
if (!deskSeed) console.log('[shots] no desk seed resolved — the profile-desk frame is skipped (a missing baseline fails the run)');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
const MODES = [
  { name: 'light', q: 'light=1' },
  { name: 'dark', q: 'light=0' },
];

const CUR = 'shots/current';
const DIF = 'shots/diff';
// BASELINE_DIR lets a local pre-ship run diff against a scratch copy without
// seeding new frames into the committed baseline set
const BASELINE = process.env.BASELINE_DIR || 'tests/ui-baseline';
fs.mkdirSync(CUR, { recursive: true });
fs.mkdirSync(DIF, { recursive: true });
fs.mkdirSync(BASELINE, { recursive: true });

// stable frame names: '/lot/<id>' → 'lot' (the id changes nightly), query
// routes keep their id ('player-michael-jordan'), nested paths join with '-'
const slug = r => {
  if (r === '/') return 'home';
  if (r === DESK_ROUTE) return 'profile-desk';
  if (r.startsWith('/lot/')) return 'lot';
  return r.replace(/^\//, '').replace(/\?id=/, '-').replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '');
};

/** diff two PNGs that may differ in height: the overlap is compared
    pixel-for-pixel, every row outside the overlap counts as drift. Returns
    the drifted-pixel count, the pct over the LARGER frame, and the overlay. */
function diffFrames(a, b) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const W = Math.max(a.width, b.width);
  const H = Math.max(a.height, b.height);
  const crop = (png) => {
    if (png.width === w && png.height === h) return png;
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(png, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(crop(a).data, crop(b).data, diff.data, w, h, { threshold: 0.16 });
  const outside = W * H - w * h;
  return { drifted: n + outside, pct: ((n + outside) / (W * H)) * 100, diff, sizeChanged: outside > 0 };
}

const browser = await chromium.launch();
const failed = [];
const report = [];
const log = (line) => { report.push(line); console.log(line); };

// One fresh browser context per FRAME (Oct 28 2026): a context shared across routes and modes carried
// localStorage / sessionStorage between frames (the remembered /value lens, the remembered /profile tab), so the
// light and dark frames of one page showed different states and the rig failed every night after Oct 6.
async function freshContext(vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    userAgent: UA,
  });
  if (SHOT_NOW) await ctx.clock.setFixedTime(SHOT_NOW);
  if (OFFLINE) {
    await ctx.route('**/*', (route) => {
      const req = route.request();
      let u;
      try { u = new URL(req.url()); } catch { return route.abort(); }
      if (u.origin === ORIGIN || u.protocol === 'data:' || u.protocol === 'blob:' || FONT_HOSTS.has(u.hostname)) return route.continue();
      if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER_PNG });
      return route.abort();
    });
  }
  return ctx;
}

for (const vp of VIEWPORTS) {
  for (const mode of MODES) {
    for (const route of ROUTES) {
      const name = `${slug(route)}-${vp.name}-${mode.name}.png`;
      const ctx = await freshContext(vp);
      // the populated desk: its saves, follows and pick log land in localStorage before the page runs
      if (route === DESK_ROUTE && deskSeed) {
        await ctx.addInitScript((seed) => {
          try {
            localStorage.setItem('ray-saved-lots', JSON.stringify(seed.saves));
            localStorage.setItem('lectr-follows', JSON.stringify(seed.follows));
            localStorage.setItem('lectr-picks', JSON.stringify(seed.picks));
          } catch { /* storage blocked: the frame renders signed-out and the diff says so */ }
        }, deskSeed);
      }
      const page = await ctx.newPage();
      try {
        const sep = route.includes('?') ? '&' : '?';
        // nogreet=1: the first-visit greeting splash never hides the fold from the rig
        await page.goto(`${BASE}${route}${sep}${mode.q}&nogreet=1`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        // kill every transition/animation so frames are deterministic
        await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
        // walk the page so lazy rooms mount, then return to the top
        await page.evaluate(async () => {
          const step = window.innerHeight;
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo({ top: y, behavior: 'instant' });
            await new Promise(r => setTimeout(r, 120));
          }
          window.scrollTo({ top: 0, behavior: 'instant' });
        });
        // the walk mounts lazy rooms that fetch their own data: let those requests settle too
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(900);
        await page.screenshot({
          path: path.join(CUR, name),
          fullPage: true,
          mask: MASKS.map(sel => page.locator(sel)),
        });

        const basePath = path.join(BASELINE, name);
        if (APPROVE) {
          fs.copyFileSync(path.join(CUR, name), basePath);
          log(`≡ ${name} — baseline approved`);
        } else if (!fs.existsSync(basePath)) {
          failed.push(name);
          log(`✗ ${name} — NO BASELINE (approve it deliberately: see the header of scripts/ui-shots.mjs)`);
        } else {
          const a = PNG.sync.read(fs.readFileSync(basePath));
          const b = PNG.sync.read(fs.readFileSync(path.join(CUR, name)));
          const { drifted, pct, diff, sizeChanged } = diffFrames(a, b);
          const size = sizeChanged ? ` · size ${a.width}x${a.height} → ${b.width}x${b.height}` : '';
          if (pct > THRESHOLD_PCT) {
            failed.push(name);
            fs.writeFileSync(path.join(DIF, name), PNG.sync.write(diff));
            log(`✗ ${name} — ${pct.toFixed(2)}% drifted · ${drifted.toLocaleString()} px (limit ${THRESHOLD_PCT}%)${size}`);
          } else {
            log(`✓ ${name} — ${pct.toFixed(2)}% · ${drifted.toLocaleString()} px${size}`);
          }
        }
      } catch (err) {
        failed.push(name);
        log(`✗ ${name} — capture failed: ${String(err).slice(0, 160)}`);
      } finally {
        await page.close();
        await ctx.close();
      }
    }
  }
}
await browser.close();

console.log(`\n[shots] ${report.length} frames, ${failed.length} failures`);
if (failed.length) console.log(`[shots] failing frames:\n  ${failed.join('\n  ')}`);
process.exit(failed.length ? 1 : 0);
