/**
 * One-off: revive the Christie's online-sale lots that www.christies.com's stale
 * data wrongly stranded as bought_in, using the real close (end_date) from the
 * onlineonly SSO url each lot carries. Then rebuild the served payloads.
 * Run: npx tsx scripts/fix-christies-onlineonly.ts
 */
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { runMarketBuild } from './build-market';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const readGz = (f: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) => fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Lot = { id: string; auctionHouse: string; status: string; url?: string; saleDate?: string; saleDateTime?: string; resultsPending?: boolean };

(async () => {
  const lots: Lot[] = readGz('lots.json');
  const arch: Lot[] = readGz('sold-archive.json');
  const all = lots.concat(arch); // references — mutating an element mutates its source array

  const targets = all.filter(l => l.auctionHouse === "Christie's" && l.status !== 'sold' && l.url && /onlineonly\.christies\.com/.test(l.url));
  console.log(`[fix] ${targets.length} non-sold Christie's onlineonly lots to check`);

  const CONC = 6;
  let dated = 0, revived = 0, failed = 0;
  for (let i = 0; i < targets.length; i += CONC) {
    await Promise.all(targets.slice(i, i + CONC).map(async lot => {
      try {
        const r = await fetch(lot.url!, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        if (!r.ok) { failed++; return; }
        const h = await r.text();
        const raw = (h.match(/"end_date":"([0-9T:.\-]+Z)"/) || [])[1];
        if (!raw) { failed++; return; }
        const d = new Date(raw);
        if (isNaN(d.getTime())) { failed++; return; }
        const iso = d.toISOString();
        lot.saleDate = iso.slice(0, 10);
        lot.saleDateTime = iso;
        dated++;
        if (d.getTime() > Date.now()) {
          if (lot.status !== 'upcoming') revived++;
          lot.status = 'upcoming';
          lot.resultsPending = false;
        }
      } catch { failed++; }
    }));
    if (i % 60 === 0) console.log(`[fix]   …${i}/${targets.length}`);
    await sleep(120);
  }
  console.log(`[fix] dated ${dated}, revived ${revived} to upcoming, ${failed} unreachable (kept as-is)`);

  writeGz('lots.json', lots);
  writeGz('sold-archive.json', arch);
  console.log('[fix] corpus written · rebuilding served payloads…');
  runMarketBuild();
})();
