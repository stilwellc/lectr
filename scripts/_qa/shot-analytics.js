/* screenshot /analytics per market to verify the SubMarketDrills panel in situ */
const { chromium } = require('playwright-core');
(async () => {
  const base = process.env.SHOT_BASE || 'http://localhost:3000';
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } });
  for (const m of ['sports', 'watches', 'culture', 'science', 'design', 'art']) {
    await page.goto(`${base}/analytics?market=${m}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const panel = page.locator('.ray-vm-card', { hasText: 'Sub-markets' }).first();
    const found = await panel.count();
    if (found) {
      await panel.screenshot({ path: `${process.env.SHOT_DIR || '/tmp'}/drills-${m}.png` }).catch(() => {});
      const txt = (await panel.innerText()).replace(/\n+/g, ' | ').slice(0, 300);
      console.log(`${m}: PANEL ${txt}`);
    } else {
      console.log(`${m}: NO PANEL`);
    }
  }
  await browser.close();
})();
