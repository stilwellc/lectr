// QA probe for the Struts (Julien's / Propstore) Wayback parser: parse local
// snapshot files and print the outcome for each.
//   npx tsx scripts/_qa/struts-probe.ts <juliens|propstore> <dir-of-html-files>
import * as fs from 'fs';
import * as path from 'path';
import { STRUTS_HOUSES, parseStrutsLot } from '../lib/struts-auction';

const cfg = STRUTS_HOUSES[process.argv[2]];
const dir = process.argv[3];
const counts: Record<string, number> = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort()) {
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  const { lot, reason } = parseStrutsLot(cfg, html, '0', String(f.replace(/\D/g, '') || '0'));
  counts[reason] = (counts[reason] || 0) + 1;
  if (lot) {
    const l = lot as unknown as Record<string, unknown>;
    console.log(`${f} | ${l.saleName} | ${l.saleDate} | lot ${l.lotNumber} | ${l.nativeCurrency} ${l.hammerNative} -> $${l.priceUsd} (${l.priceBasis}) | ${l.subCat}/${l.authConfidence} | ${String(l.title).slice(0, 50)}`);
  } else {
    console.log(`${f} | -- ${reason}`);
  }
}
console.log('outcomes:', counts);
