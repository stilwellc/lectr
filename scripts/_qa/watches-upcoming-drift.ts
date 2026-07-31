/** watches-upcoming-drift.ts — does upcoming.json carry stamped formKey, and
 *  how often does the stamp disagree with live classifyForm for watch makers? */
import * as fs from 'fs';
import { classifyForm, watchKey } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const up: AuctionLot[] = JSON.parse(fs.readFileSync('public/data/ray/upcoming.json', 'utf8')).lots;
console.log('upcoming lots:', up.length);

const WMAKERS = new Set(['patek-philippe', 'rolex', 'cartier', 'audemars-piguet', 'omega']);
const obj = up.filter(l => l.category === 'object' && WMAKERS.has(l.artist));
console.log('watch-maker object lots in live book:', obj.length);

let stamped = 0, drift = 0;
const pairs = new Map<string, number>();
const ex: any[] = [];
for (const l of obj) {
  if (l.formKey === undefined || l.formKey === null) continue;
  stamped++;
  const live = classifyForm(l);
  if (l.formKey !== live) {
    drift++;
    const k = `${l.formKey} -> ${live}`;
    pairs.set(k, (pairs.get(k) || 0) + 1);
    if (ex.length < 20) ex.push({ id: l.id, artist: l.artist, stamped: l.formKey, live, key: watchKey(l), title: (l.title || '').slice(0, 100) });
  }
}
console.log('stamped:', stamped, 'unstamped:', obj.length - stamped, 'drift:', drift,
  stamped ? `(${(100 * drift / stamped).toFixed(2)}% of stamped)` : '');
console.log('pairs:', [...pairs.entries()].sort((a, b) => b[1] - a[1]));
console.log(JSON.stringify(ex, null, 1));

// the audit flag lot specifically
const flag = up.find(l => l.id === 'bonhams-31913-7');
if (flag) console.log('\nFLAG bonhams-31913-7:', { stamped: flag.formKey, live: classifyForm(flag), ref: flag.reference, key: watchKey(flag), title: flag.title });
const flag2 = up.find(l => l.id === 'bonhams-31913-14');
if (flag2) console.log('FLAG bonhams-31913-14:', { stamped: flag2.formKey, live: classifyForm(flag2), ref: flag2.reference, key: watchKey(flag2), title: flag2.title });
