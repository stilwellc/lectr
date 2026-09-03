/**
 * THE SHOT RIG — nightly visual regression for the north-star UI.
 *
 * Captures the key routes at two viewports in both modes, then diffs each
 * capture against the approved baseline in tests/ui-baseline/. Any frame
 * drifting more than THRESHOLD writes a red-overlay diff to shots/diff/
 * and fails the run — the "gray blob on cream" class of bug gets caught
 * by the robot, not by Collin.
 *
 *   node scripts/ui-shots.mjs                  # capture + diff vs baseline
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
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'https://lectr.bid';
const APPROVE = process.argv.includes('--approve');
const THRESHOLD_PCT = 2.5; // % of pixels allowed to drift (live data moves)
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

const lotId = await resolveLotId();
const ROUTES = [
  '/', '/value', '/analytics', '/makers', '/blog', '/about', '/styleguide',
  '/receipts', '/profile',
  '/player?id=michael-jordan',
  '/ref/rolex/1002',
  '/sub/tcg/pokemon-cards',
  ...(lotId ? [`/lot/${lotId}`] : []),
];
if (!lotId) console.log('[shots] no flagged lot resolved — /lot frame skipped (set LOT_ID to pin one)');
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

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    userAgent: UA,
  });
  for (const mode of MODES) {
    for (const route of ROUTES) {
      const name = `${slug(route)}-${vp.name}-${mode.name}.png`;
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
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(CUR, name), fullPage: true });

        const basePath = path.join(BASELINE, name);
        if (APPROVE || !fs.existsSync(basePath)) {
          fs.copyFileSync(path.join(CUR, name), basePath);
          log(`≡ ${name} — baseline ${APPROVE ? 'approved' : 'seeded'}`);
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
      }
    }
  }
  await ctx.close();
}
await browser.close();

console.log(`\n[shots] ${report.length} frames, ${failed.length} failures`);
if (failed.length) console.log(`[shots] failing frames:\n  ${failed.join('\n  ')}`);
process.exit(failed.length ? 1 : 0);
