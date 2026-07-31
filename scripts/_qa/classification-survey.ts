/** classification-survey — corpus shape for the classification vertical.
 *  Counts categories, medium/dims coverage per category, formKey coverage,
 *  and the raw print↔original conflict counts using the AUDIT's simple cues. */
import { readGzRows } from '../corpus-io';
import { classifyForm } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const lots = readGzRows('data/corpus/lots.json.gz') as unknown as AuctionLot[];
const sold = readGzRows('data/corpus/sold-archive.json.gz') as unknown as AuctionLot[];
console.log('lots.json.gz rows:', lots.length, ' sold-archive rows:', sold.length);

for (const [name, arr] of [['lots', lots], ['sold-archive', sold]] as const) {
  const cats: Record<string, { n: number; med: number; fk: number; fkMatch: number; sold: number }> = {};
  for (const l of arr) {
    const c = l.category || 'null';
    const s = (cats[c] ||= { n: 0, med: 0, fk: 0, fkMatch: 0, sold: 0 });
    s.n++;
    if (l.medium) s.med++;
    const fk = (l as { formKey?: string }).formKey;
    if (fk !== undefined && fk !== null) {
      s.fk++;
      if (fk === classifyForm(l)) s.fkMatch++;
    }
    if (l.status === 'sold' && l.priceUsd) s.sold++;
  }
  console.log(`\n== ${name} ==`);
  for (const [c, s] of Object.entries(cats).sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      c.padEnd(12),
      `n=${s.n}`.padEnd(10),
      `medium=${(100 * s.med / s.n).toFixed(1)}%`.padEnd(14),
      `formKey=${(100 * s.fk / s.n).toFixed(1)}%`.padEnd(15),
      `fk==classify=${s.fk ? (100 * s.fkMatch / s.fk).toFixed(1) : '—'}%`.padEnd(20),
      `sold=${s.sold}`,
    );
  }
}
