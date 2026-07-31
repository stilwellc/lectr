import * as fs from 'fs';
import { localToday, trueSaleDay } from '../../app/utils';
const up = JSON.parse(fs.readFileSync('public/data/ray/upcoming.json', 'utf8'));
const lots = (up.lots || up.upcoming || up).filter((l: any) => l.status === 'upcoming');
const today = localToday();
const offenders = lots.filter((l: any) => l.saleDate && l.saleDate >= today && !l.resultsPending && trueSaleDay(l) < today);
console.log('lots passing OLD guard but truly past:', offenders.length);
offenders.slice(0, 5).forEach((l: any) => console.log(` ${l.id} saleDate=${l.saleDate} trueDay=${trueSaleDay(l)} ${l.title.slice(0, 50)}`));
