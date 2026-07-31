import * as fs from 'fs';
import { localToday, trueSaleDay } from '../../app/utils';
const all: any[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (!/^lots-\d+\.json$/.test(f)) continue;
  const c = JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8'));
  all.push(...(Array.isArray(c) ? c : c.lots || []));
}
const today = localToday();
const upc = all.filter(l => l.status === 'upcoming');
const oldGuardPass = upc.filter(l => l.saleDate && l.saleDate >= today && !l.resultsPending);
const trulyPast = oldGuardPass.filter(l => trueSaleDay(l) < today);
const newGuardPass = upc.filter(l => {
  const day = trueSaleDay(l);
  return day && day >= today && !l.resultsPending;
});
console.log(`corpus upcoming: ${upc.length} | old-guard pass: ${oldGuardPass.length} | of which TRULY PAST: ${trulyPast.length} | new-guard pass: ${newGuardPass.length}`);
trulyPast.slice(0, 8).forEach(l => console.log(` PAST-BUT-PICKABLE: ${l.id} saleDate=${l.saleDate} trueDay=${trueSaleDay(l)} dt=${l.saleDateTime} · ${l.title.slice(0, 55)}`));
// also: stale 'upcoming' rows whose saleDate itself is already past (invisible to both guards but rot in the corpus)
const staleUpcoming = upc.filter(l => l.saleDate && l.saleDate < today);
console.log('stale upcoming (saleDate < today, status never flipped):', staleUpcoming.length);
