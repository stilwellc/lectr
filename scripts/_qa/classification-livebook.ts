/** classification-livebook — footprint of the v2 normalizeCategory rules on
 *  the LIVE surfaces: upcoming.json (the live book) and the client corpus's
 *  upcoming rows. Inline copies of the v2 rules (standalone). */
import fs from 'fs';
import { classifyForm } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const PRINT_PROCESS = /\b(lithograph(?:s|e|ie)?|silkscreen|screen\s?print(?:s|ing)?|s[ée]rigraph(?:s|y|ie)?|etching(?:s)?|aquatint|engraving(?:s)?|woodcut(?:s)?|wood engraving|linocut(?:s)?|drypoint|mezzotint|pochoirs?|photogravure|h[ée]liogravure|gicl[ée]e|offset (?:lithograph|print)|monotype|monoprint|intaglio|chine coll[ée]|linoleum cut)\b/i;
const PLATE_FROM = /\b(?:pl\.?|plates?)\s*(?:[IVXLCDM]+\b|\d{1,3}\b)?[,]?\s*from\b|\b(?:one|two|three|four|five|six|seven|eight|\d{1,2})\s+plates?\b|\bplate\s+(?:[IVXLCDM]+|\d{1,3})\b/i;
const FROM_SERIES = /,\s*from\s+(?!the\s+(?:collection|estate|property)|a\s+private|an?\s+important)(?:the\s+)?[A-Z'"«“]/;
const EDITION_STRONG = /\bedition of \d+\b|\bfrom (?:an|the) edition\b|\bnumbered\b[^.;]{0,16}\d{1,3}\s*\/\s*\d{1,4}|\bartist'?s proof\b|\bprinter'?s proof\b|\btrial proof\b|\bbon [aà] tirer\b|\bhors commerce\b/i;
function bareEditionFraction(s: string): boolean {
  const re = /(^|[^\d\s]|\s)(\d{1,3})\s*\/\s*(\d{1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 4), m.index + m[1].length);
    if (/\d\s?$/.test(before)) continue;
    const num = parseInt(m[2], 10), den = parseInt(m[3], 10);
    if (den >= 8 && num <= den && den <= 3000) return true;
  }
  return false;
}
const ORIGINAL_STRONG = /\b(?:oil|acrylic|tempera|alkyd|enamel|synthetic polymer)\b[^.;]{0,40}\bon\s+(?:canvas|linen|panel|board|masonite|cardboard|paper)\b|\bmixed media on (?:canvas|panel|board)\b|\bhand[- ]painted\b|\bunique\b/i;
const OIL_CANVAS = /\b(?:oil|acrylic|tempera|synthetic polymer)\b[^.;]{0,30}\bon\s+(?:canvas|panel|board|linen|masonite)\b/i;
const EDITION_ANY = /\bedition of \d+|\bnumbered edition\b|\blimited edition\b/i;
const textOf = (l: AuctionLot) => `${l.title || ''}  ${l.medium || ''}`;
const origToPrint = (l: AuctionLot) => l.category === 'original' && !ORIGINAL_STRONG.test(textOf(l))
  && (PRINT_PROCESS.test(textOf(l)) || PLATE_FROM.test(textOf(l)) || FROM_SERIES.test(l.title || '') || EDITION_STRONG.test(textOf(l)) || bareEditionFraction(textOf(l)));
const printToOrig = (l: AuctionLot) => l.category === 'print' && !PRINT_PROCESS.test(textOf(l)) && !PLATE_FROM.test(textOf(l))
  && !EDITION_ANY.test(textOf(l)) && OIL_CANVAS.test(textOf(l));

// 1 · upcoming.json (the live book)
const up = JSON.parse(fs.readFileSync('public/data/ray/upcoming.json', 'utf8'));
const book: AuctionLot[] = up.lots;
const o2p = book.filter(origToPrint), p2o = book.filter(printToOrig);
console.log(`upcoming.json lots=${book.length}: origToPrint=${o2p.length} printToOrig=${p2o.length}`);
for (const l of [...o2p, ...p2o]) {
  const flipped = { title: l.title, medium: l.medium, category: l.category === 'original' ? 'print' : 'original' } as AuctionLot;
  console.log(`  ${l.id} ${l.artist} [${l.category}→${flipped.category}] form ${(l as { formKey?: string }).formKey}→${classifyForm(flipped)} | ${(l.title || '').slice(0, 80)} | value=${JSON.stringify((l as { value?: { compValueUsd?: number; signal?: unknown } }).value?.signal ?? null)}`);
}

// 2 · client corpus upcoming rows
const client: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) client.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
const liveClient = client.filter(l => l.status === 'upcoming');
console.log(`\nclient corpus upcoming rows=${liveClient.length}: origToPrint=${liveClient.filter(origToPrint).length} printToOrig=${liveClient.filter(printToOrig).length}`);
console.log(`client corpus ALL rows: origToPrint=${client.filter(origToPrint).length} printToOrig=${client.filter(printToOrig).length} (title+served-medium only — the client's own view)`);
