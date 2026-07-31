/* science-space-flown.ts — space-exploration only: does gating the reference
   pool on FLOWN parity (title says flown vs not) tighten the tail? Also dumps
   the worst residual cases. */
import * as fs from 'fs';
import { classifyForm, normalizeTitle } from '../../app/lib/comps';

const DIR = 'public/data/ray';
const all: any[] = [];
for (const f of fs.readdirSync(DIR)) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8')));

const formOf = (l: any) => l.formKey ?? classifyForm(l);
const rows = all.filter(l => l.category === 'object' && l.artist === 'space-exploration');
const sold = rows.filter(l => l.status === 'sold' && l.priceUsd && formOf(l) === 'space');

const ART_PARENS = /\([^)]*\b(1[4-9]\d{2}|20[0-2]\d)\b[^)]*\)/;
const isArt = (l: any) => ART_PARENS.test(l.title || '');
const SPACE_MISSIONS = /\b(apollo[- ]?(?:\d{1,2}|[ivx]{1,4})|apollo|gemini[- ]?\d{0,2}|mercury|soyuz|skylab|sputnik|vostok|space shuttle|shuttle|sts-\d+|iss|mir)\b/;
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16', xvii: '17' };
function missionId(l: any): string | null {
  const m = ` ${(l.title || '').toLowerCase()} `.match(SPACE_MISSIONS);
  if (!m) return null;
  let id = m[1].replace(/[- ]/g, '');
  const r = id.match(/^apollo([ivx]+)$/);
  if (r && ROMAN[r[1]]) id = 'apollo' + ROMAN[r[1]];
  return id;
}
const isFlown = (l: any) => /\bflown\b/i.test(l.title || '');

function median(xs: number[]): number { const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function estMid(l: any): number | null { const lo = l.estLowUsd ?? l.estimateLow, hi = l.estHighUsd ?? l.estimateHigh; return lo && hi ? (lo + hi) / 2 : null; }

function band(lot: any, flownGate: boolean) {
  if (isArt(lot)) return null;
  const tid = missionId(lot);
  const ent = lot.entity ? lot.entity.toLowerCase().trim() : null;
  if (!tid && !ent) return null;
  const fl = isFlown(lot);
  const words = new Set<string>(normalizeTitle(lot.title).split(' ').filter((w: string) => w.length > 3));
  const scored: [number, any][] = [];
  for (const l of sold) {
    if (l.id === lot.id || isArt(l)) continue;
    if (flownGate && isFlown(l) !== fl) continue;
    let idHit = false, s = 0;
    if (ent && l.entity && l.entity.toLowerCase().trim() === ent) { idHit = true; s += 3; }
    const lid = missionId(l);
    if (tid && lid && lid === tid) { idHit = true; s += 3; }
    let ov = 0; for (const w of normalizeTitle(l.title).split(' ')) if (words.has(w)) ov++;
    s += ov;
    if (idHit) scored.push([s, l]);
  }
  if (scored.length < 3) return null;
  const pool = scored.sort((a, b) => (b[0] - a[0]) || (new Date(b[1].saleDate).getTime() - new Date(a[1].saleDate).getTime())).slice(0, 24).map(x => x[1]);
  const prices = pool.map(l => l.priceUsd).sort((a: number, b: number) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)], q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return null;
  const em = estMid(lot);
  if (em && (med > em * 5 || med < em / 5)) return null;
  return { med, n: pool.length };
}

function pct(n: number, d: number) { return d ? (100 * n / d).toFixed(1) + '%' : '—'; }
function errStats(errs: number[]) {
  if (!errs.length) return 'n=0';
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  return `n=${errs.length} med|err|=${(median(abs) * 100).toFixed(0)}% within±50%=${pct(errs.filter(e => Math.abs(e) <= 0.5).length, errs.length)} within±100%=${pct(errs.filter(e => Math.abs(e) <= 1.0).length, errs.length)} >200%=${errs.filter(e => Math.abs(e) > 2).length} worst=${(Math.max(...abs) * 100).toFixed(0)}%`;
}

for (const gate of [false, true]) {
  const errs: number[] = []; const worst: [number, string][] = [];
  for (const lot of sold) {
    const b = band(lot, gate);
    if (!b) continue;
    const e = (lot.priceUsd - b.med) / b.med;
    errs.push(e);
    worst.push([Math.abs(e), `"${(lot.title || '').slice(0, 70)}" realized=$${Math.round(lot.priceUsd)} med=$${Math.round(b.med)} err=${(e * 100).toFixed(0)}%`]);
  }
  console.log(`\nflownGate=${gate}: ${errStats(errs)}`);
  for (const [, s] of worst.sort((a, b) => b[0] - a[0]).slice(0, 6)) console.log('  ' + s);
}
