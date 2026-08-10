// Isolated live test of crawlLama — verifies the LAMA crawler parses real
// lamodern.com data into valid, invariant-clean AuctionLots. Does NOT touch the
// corpus. Run: RAY_SKIP_MAIN=1 npx tsx scripts/_qa/test-lama.ts
import { crawlLama } from '../ray-crawl';
import { assertInvariants } from '../../app/lib/validate';

async function run() {
  const artist = { slug: 'ed-ruscha', displayName: 'Ed Ruscha', wright: 'ed-ruscha' };
  const lots = await crawlLama(artist as never);
  console.log(`\n[test] crawlLama returned ${lots.length} lots`);
  if (!lots.length) { console.error('[test] FAIL: zero lots'); process.exit(1); }

  const sold = lots.filter(l => l.status === 'sold');
  const withImg = lots.filter(l => l.imageUrl);
  const badId = lots.filter(l => !l.id.startsWith('lama-'));
  const badHouse = lots.filter(l => l.auctionHouse !== 'LAMA');
  console.log(`[test] sold=${sold.length} withImage=${withImg.length} badIdPrefix=${badId.length} badHouse=${badHouse.length}`);

  // invariant gate — the real write-time validator (takes the whole array)
  const report = assertInvariants(lots as never);
  const fatal = report.fatal.length;
  console.log(`[test] invariant FATALs: ${fatal} | warns: ${report.warn.length}`);
  report.warn.slice(0,6).forEach(w=>console.error("  WARN",w)); report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));

  const s = sold[0];
  if (s) {
    console.log('\n[test] sample sold lot:');
    console.log('  id      ', s.id);
    console.log('  title   ', s.title.slice(0, 60));
    console.log('  house   ', s.auctionHouse, '| saleDate', s.saleDate);
    console.log('  hammer  ', (s as { hammerUsd?: number }).hammerUsd, '| realized', (s as { priceUsd?: number }).priceUsd);
    console.log('  est     ', (s as { estimateLow?: number }).estimateLow, '-', (s as { estimateHigh?: number }).estimateHigh);
    console.log('  img     ', s.imageUrl?.slice(0, 80));
    console.log('  url     ', s.url?.slice(0, 80));
  }

  if (badId.length || badHouse.length || fatal) { console.error('\n[test] FAIL'); process.exit(1); }
  console.log('\n[test] PASS');
}
run().catch(e => { console.error(e); process.exit(1); });
