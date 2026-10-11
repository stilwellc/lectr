/**
 * W8 (Oct 11 2026) — the printed close day and the maker slot, one rule each.
 *
 * 1. Every "hammers / closes / hammered <day>" print reads closeDayOf (app/utils)
 *    = the reader's TRUE day (trueSaleDay), not the crawl's saleDate. The lot
 *    page printed "Oct 9" for a 1:56 AM ET Oct 10 Goldin close the feed called
 *    Oct 10.
 * 2. makerLineOf (app/lib/lot-labels) never prints a pseudo-category
 *    ("Sports Cards", "Autographs", "Entertainment & Icons") as a maker: the
 *    lot's subject takes the slot, else no name. Real makers are untouched.
 *
 * The live-book legs run over public/data/ray/upcoming.json when the data is
 * present (a worktree with the served data copied in), and skip otherwise.
 */
process.env.TZ = 'America/New_York'; // the reader's zone, before any Date is read
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { closeDayOf, trueSaleDay, formatDate } from '../../utils';
import { houseCloseDayOf } from '../house-tz';
import { makerLineOf, catalogMakerLineOf } from '../lot-labels';
import { displayMakerOf, SUBJECT_MARKETS } from '../maker-subjects';
import { ARTIST_LABEL, marketOf } from '../../constants';
import { pinClock } from './helpers/pin-clock';
pinClock('2026-10-09T16:00:00-04:00');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BOOK = path.join(ROOT, 'public', 'data', 'ray', 'upcoming.json');
type Lot = { id: string; artist: string; title?: string; status?: string; saleDate?: string; saleDateTime?: string | null; auctionHouse?: string };
const book: Lot[] | null = existsSync(BOOK) ? (JSON.parse(readFileSync(BOOK, 'utf8')).lots as Lot[]) : null;

const PSEUDO = new Set(Object.keys(ARTIST_LABEL).filter(k => SUBJECT_MARKETS.has(marketOf(k))));
const PSEUDO_LABELS = new Set(Array.from(PSEUDO).map(k => ARTIST_LABEL[k]));

test('closeDayOf: a late-night Goldin close prints the reader\'s day, not the crawl day', () => {
  // 1:56 AM ET Oct 10 (extended bidding) — the crawl stamped saleDate Oct 9
  const late = { saleDate: '2026-10-09', saleDateTime: '2026-10-10T05:56:00Z', auctionHouse: 'Goldin' };
  assert.equal(closeDayOf(late), '2026-10-10');
  assert.equal(formatDate(closeDayOf(late)), 'Oct 10, 2026');
  // 10 PM ET Oct 9 = 02:00Z Oct 10 — the reader's Oct 9
  assert.equal(closeDayOf({ saleDate: '2026-10-09', saleDateTime: '2026-10-10T02:00:00Z', auctionHouse: 'Goldin' }), '2026-10-09');
  // a Christie's local-midnight day stamp is the sale-local day
  assert.equal(closeDayOf({ saleDate: '2026-10-14', saleDateTime: '2026-10-13T23:00Z', auctionHouse: "Christie's" }), '2026-10-14');
  // no stamp → the saleDate stands
  assert.equal(closeDayOf({ saleDate: '2026-10-21', auctionHouse: 'Phillips' }), '2026-10-21');
  assert.equal(closeDayOf({ saleDate: '' }), '');
});

test('houseCloseDayOf: build-time prints (lot metadata) read the day where the sale is held', () => {
  assert.equal(houseCloseDayOf({ saleDate: '2026-10-09', saleDateTime: '2026-10-10T05:56:00Z', auctionHouse: 'Goldin' }), '2026-10-10');
  assert.equal(houseCloseDayOf({ saleDate: '2026-10-09', saleDateTime: '2026-10-10T02:00:00Z', auctionHouse: 'Goldin' }), '2026-10-09');
  assert.equal(houseCloseDayOf({ saleDate: '2026-10-21', auctionHouse: 'Phillips' }), '2026-10-21');
});

test('no close-day print formats the raw saleDate (app/profile excepted: owned elsewhere)', () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (e === '__tests__' || e === 'profile' || e === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) {
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          // a day print (no month/year opts) or a days-to word off the crawl's saleDate
          if (/formatDate\(\s*[\w.?]+\.saleDate\s*\)|daysWord\([^)]*\.saleDate\)/.test(line)) hits.push(`${path.relative(ROOT, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(path.join(ROOT, 'app'));
  assert.deepEqual(hits, []);
});

test('live book: every printed close day equals trueSaleDay', { skip: !book && 'no served data in this tree' }, () => {
  let drift = 0, n = 0;
  for (const l of book!) {
    const t = trueSaleDay(l);
    if (!t) continue;
    n++;
    assert.equal(formatDate(closeDayOf(l)), formatDate(t), l.id);
    if (t !== (l.saleDate || '').slice(0, 10)) drift++;
  }
  assert.ok(n > 1000);
  // the lots whose raw saleDate printed the wrong day before W8 (reported, not pinned: it moves nightly)
  console.log(`[w8] ${n} dated live lots · ${drift} where the crawl's saleDate is not the reader's close day (ET)`);
});

test('maker line: a pseudo-category is never printed as a maker; subjects take the slot', () => {
  const jr = makerLineOf({ artist: 'sports-cards', title: '1949 Bowman #50 Jackie Robinson PSA 5' });
  assert.equal(jr.name, 'Jackie Robinson');
  // the live row that printed "Sports Cards": a slot run-on into card words
  assert.equal(makerLineOf({ artist: 'sports-cards', title: '1949 Bowman #50 Jackie Robinson Inaugural Bowman Card - PSA MINT 9; MBA Bronze Diamond Certification - Highest PSA Copy!' }).name, 'Jackie Robinson');
  // a signed card catalogued under Autographs names its player
  assert.equal(makerLineOf({ artist: 'autographs', title: 'Signed 1979 Hostess #102 Ozzie Smith Rookie PSA/DNA GEM MINT 10' }).name, 'Ozzie Smith');
  // a film franchise
  assert.equal(makerLineOf({ artist: 'entertainment-memorabilia', title: 'Severus Snape Wand from Harry Potter and the Half-Blood Prince - Coronado Trading OOA' }).name, 'Harry Potter');
  // nothing readable → no name (and displayMakerOf → null), never "Entertainment & Icons"
  const jaws = { artist: 'entertainment-memorabilia', title: 'Bomb\'s Away Army Themed Guitar' };
  assert.equal(makerLineOf(jaws).name, '');
  assert.equal(displayMakerOf(jaws), null);
  assert.equal(catalogMakerLineOf(jaws).name, 'Entertainment & Icons');
  // real makers keep their line
  assert.deepEqual(makerLineOf({ artist: 'pablo-picasso', title: 'Tête de femme' }), catalogMakerLineOf({ artist: 'pablo-picasso', title: 'Tête de femme' }));
  assert.equal(makerLineOf({ artist: 'rolex', title: 'Daytona 6263' }).name, ARTIST_LABEL.rolex);
});

test('live book: no lot prints a category name as its maker; real makers unchanged', { skip: !book && 'no served data in this tree' }, () => {
  let before = 0, after = 0, toSubject = 0, toNone = 0, changedReal = 0;
  for (const l of book!) {
    const cat = catalogMakerLineOf(l), line = makerLineOf(l);
    if (PSEUDO_LABELS.has(cat.name)) before++;
    if (PSEUDO_LABELS.has(line.name)) after++;
    if (!PSEUDO.has(l.artist) && (cat.name !== line.name || cat.href !== line.href)) changedReal++;
    if (cat.name !== line.name) { if (line.name) toSubject++; else toNone++; }
  }
  assert.equal(after, 0);
  assert.equal(changedReal, 0);
  assert.ok(before > 0);
  console.log(`[w8] category-as-maker: ${before} before → ${after} after (${toSubject} now name their subject, ${toNone} print no maker line)`);
});
