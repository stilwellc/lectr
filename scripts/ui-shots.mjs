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
 *
 * Animations are neutralized (reduced-motion + a transition kill switch)
 * so frames are deterministic; the live data itself changes nightly, so
 * data-bearing regions will drift a little — THRESHOLD is calibrated to
 * catch layout/color breaks, not a moved sparkline.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'https://lectr.bid';
const APPROVE = process.argv.includes('--approve');
const THRESHOLD_PCT = 2.5; // % of pixels allowed to drift (live data moves)

const ROUTES = ['/', '/value', '/analytics', '/makers', '/blog', '/about', '/styleguide'];
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
const BASELINE = 'tests/ui-baseline';
fs.mkdirSync(CUR, { recursive: true });
fs.mkdirSync(DIF, { recursive: true });
fs.mkdirSync(BASELINE, { recursive: true });

const slug = r => (r === '/' ? 'home' : r.replace(/\//g, '').replace(/[^a-z0-9-]/gi, ''));

const browser = await chromium.launch();
let failures = 0;
const report = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  });
  for (const mode of MODES) {
    for (const route of ROUTES) {
      const name = `${slug(route)}-${vp.name}-${mode.name}.png`;
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}${route}?${mode.q}`, { waitUntil: 'networkidle', timeout: 60000 });
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
          report.push(`≡ ${name} — baseline ${APPROVE ? 'approved' : 'seeded'}`);
        } else {
          const a = PNG.sync.read(fs.readFileSync(basePath));
          const b = PNG.sync.read(fs.readFileSync(path.join(CUR, name)));
          if (a.width !== b.width || a.height !== b.height) {
            failures++;
            report.push(`✗ ${name} — size changed ${a.width}x${a.height} → ${b.width}x${b.height}`);
          } else {
            const diff = new PNG({ width: a.width, height: a.height });
            const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.16 });
            const pct = (n / (a.width * a.height)) * 100;
            if (pct > THRESHOLD_PCT) {
              failures++;
              fs.writeFileSync(path.join(DIF, name), PNG.sync.write(diff));
              report.push(`✗ ${name} — ${pct.toFixed(2)}% drifted (limit ${THRESHOLD_PCT}%)`);
            } else {
              report.push(`✓ ${name} — ${pct.toFixed(2)}%`);
            }
          }
        }
      } catch (err) {
        failures++;
        report.push(`✗ ${name} — capture failed: ${String(err).slice(0, 120)}`);
      } finally {
        await page.close();
      }
    }
  }
  await ctx.close();
}
await browser.close();

console.log(report.join('\n'));
console.log(`\n[shots] ${report.length} frames, ${failures} failures`);
process.exit(failures ? 1 : 0);
