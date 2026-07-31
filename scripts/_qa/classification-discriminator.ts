/** classification-discriminator — build & measure the print-vs-original
 *  title/medium discriminator on the full corpus (lots.json.gz), where medium
 *  survives. Positives frame: category='print'; negatives: category='original'.
 *  Per-cue precision measured against the category label on all art rows, then
 *  disagreement samples printed for manual adjudication. */
import { readGzRows } from '../corpus-io';
import { classifyForm } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const lots = readGzRows('data/corpus/lots.json.gz') as unknown as AuctionLot[];

// ── candidate cues ──────────────────────────────────────────────────────────
// strong printmaking process nouns (title OR medium)
const PRINT_PROCESS = /\b(lithograph(?:s|e|ie)?|silkscreen|screen\s?print(?:s|ing)?|s[ée]rigraph(?:s|y|ie)?|etching(?:s)?|aquatint|engraving(?:s)?|woodcut(?:s)?|wood engraving|linocut(?:s)?|drypoint|mezzotint|pochoirs?|photogravure|h[ée]liogravure|gicl[ée]e|offset (?:lithograph|print)|monotype|monoprint|intaglio|chine coll[ée]|linoleum cut)\b/i;
// "pl. 14, from Jazz" / "Plate II from Six Contes" / "One plate, from …" / "Three plates, from …"
const PLATE_FROM = /\b(?:pl\.?|plates?)\s*(?:[IVXLCDM]+\b|\d{1,3}\b)?[,]?\s*from\b|\b(?:one|two|three|four|five|six|seven|eight|\d{1,2})\s+plates?\b|\bplate\s+(?:[IVXLCDM]+|\d{1,3})\b/i;
// ", from <Capitalized Series>" — excluding provenance phrases
const FROM_SERIES = /,\s*from\s+(?!the\s+(?:collection|estate|property)|a\s+private|an?\s+important)(?:the\s+)?[A-Z'"«“]/;
// edition-number cues: "numbered 34/50", "edition of 75", "AP", "HC", bare N/M
const EDITION_WORDS = /\b(?:numbered|edition of \d+|from (?:an|the) edition|artist'?s proof|printer'?s proof|trial proof|bon [aà] tirer|hors commerce)\b/i;
// bare fraction like 34/50 — must NOT be a mixed-number size ("31 1/2") and
// denominator must look like an edition size (>=8), numerator <= denominator
function bareEditionFraction(s: string): boolean {
  const re = /(^|[^\d\s]|\s)(\d{1,3})\s*\/\s*(\d{1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    // reject "31 1/2" (mixed number): preceding token is a digit+space
    const before = s.slice(Math.max(0, m.index - 4), m.index + m[1].length);
    if (/\d\s?$/.test(before)) continue;
    const num = parseInt(m[2], 10), den = parseInt(m[3], 10);
    if (den >= 8 && num <= den && den <= 3000) return true;
  }
  return false;
}
// strong UNIQUE-work mediums — the never-touch set
const ORIGINAL_STRONG = /\b(?:oil|acrylic|tempera|alkyd|enamel)\b[^.;]{0,40}\bon\s+(?:canvas|linen|panel|board|masonite|cardboard|paper)\b|\bmixed media on (?:canvas|panel|board)\b|\bhand[- ]painted\b|\bunique\b/i;
// work-on-paper unique mediums (weaker: gouache/watercolor also describe some multiples' hand-coloring)
const ORIGINAL_WOP = /\b(?:watercolou?r|gouache|pastel|charcoal|graphite|pencil|pen and ink|ink|crayon|conte|sanguine)\b[^.;]{0,30}\bon\s+(?:paper|card|board|vellum|papier)\b|\bdrawing\b|\bstudy for\b|\bcollage\b/i;

const textOf = (l: AuctionLot) => `${l.title || ''}  ${l.medium || ''}`;
const printCue = (s: string) =>
  PRINT_PROCESS.test(s) || PLATE_FROM.test(s) || FROM_SERIES.test(s) || EDITION_WORDS.test(s) || bareEditionFraction(s);
const originalCue = (s: string) => ORIGINAL_STRONG.test(s) || ORIGINAL_WOP.test(s);

// ── per-cue precision vs the category label (print ∪ original rows) ────────
const art = lots.filter(l => l.category === 'print' || l.category === 'original');
const P = art.filter(l => l.category === 'print');
const O = art.filter(l => l.category === 'original');
console.log(`art rows: print=${P.length} original=${O.length}`);

const cues: [string, (s: string) => boolean][] = [
  ['PRINT_PROCESS', s => PRINT_PROCESS.test(s)],
  ['PLATE_FROM', s => PLATE_FROM.test(s)],
  ['FROM_SERIES', s => FROM_SERIES.test(s)],
  ['EDITION_WORDS', s => EDITION_WORDS.test(s)],
  ['bareEditionFraction', bareEditionFraction],
  ['ANY print cue', printCue],
  ['ORIGINAL_STRONG', s => ORIGINAL_STRONG.test(s)],
  ['ORIGINAL_WOP', s => ORIGINAL_WOP.test(s)],
];
for (const [name, fn] of cues) {
  const onP = P.filter(l => fn(textOf(l))).length;
  const onO = O.filter(l => fn(textOf(l))).length;
  const isPrintCue = !name.startsWith('ORIGINAL');
  const prec = isPrintCue ? onP / (onP + onO) : onO / (onP + onO);
  console.log(
    name.padEnd(20),
    `fires: print=${onP} (${(100 * onP / P.length).toFixed(1)}%)  original=${onO} (${(100 * onO / O.length).toFixed(1)}%)`,
    ` → label-precision ${(100 * prec).toFixed(2)}%`,
  );
}

// ── the composed discriminator & its disagreement sets ─────────────────────
// predicted PRINT: any print cue, and NOT a strong unique medium
// predicted ORIGINAL: original cue and no print process/plate cue
let agreePP = 0, agreeOO = 0;
const origButPrintCued: AuctionLot[] = [];
const printButOrigCued: AuctionLot[] = [];
for (const l of art) {
  const s = textOf(l);
  const predPrint = printCue(s) && !ORIGINAL_STRONG.test(s);
  const predOrig = originalCue(s) && !(PRINT_PROCESS.test(s) || PLATE_FROM.test(s));
  if (l.category === 'print' && predPrint) agreePP++;
  if (l.category === 'original' && predOrig) agreeOO++;
  if (l.category === 'original' && predPrint) origButPrintCued.push(l);
  if (l.category === 'print' && predOrig && ORIGINAL_STRONG.test(s)) printButOrigCued.push(l);
}
console.log(`\nagreement: print∧predPrint=${agreePP}/${P.length}  original∧predOrig=${agreeOO}/${O.length}`);
console.log(`CONFLICTS: category=original but print-cued (no strong orig medium): ${origButPrintCued.length}`);
console.log(`CONFLICTS: category=print but ORIGINAL_STRONG medium (no print process): ${printButOrigCued.length}`);

const show = (l: AuctionLot) =>
  `  [${l.status}${l.priceUsd ? ' $' + Math.round(l.priceUsd) : ''}] ${l.artist} | ${(l.title || '').slice(0, 90)} || medium: ${(l.medium || '∅').slice(0, 60)} | form=${classifyForm(l)}`;
console.log('\n-- sample: original-but-print-cued (would flip original→print) --');
for (const l of origButPrintCued.slice(0, 30)) console.log(show(l));
console.log('\n-- sample: print-but-original-strong (would flip print→original) --');
for (const l of printButOrigCued.slice(0, 30)) console.log(show(l));

// which cue fired on the original→print set (attribution)
const attr: Record<string, number> = {};
for (const l of origButPrintCued) {
  const s = textOf(l);
  for (const [name, fn] of cues.slice(0, 5)) if (fn(s)) attr[name] = (attr[name] || 0) + 1;
}
console.log('\ncue attribution on original→print flips:', attr);

// status / form / artist breakdown of both flip sets
const breakdown = (arr: AuctionLot[], label: string) => {
  const byArtist: Record<string, number> = {}, byForm: Record<string, number> = {}, byStatus: Record<string, number> = {};
  for (const l of arr) {
    byArtist[l.artist] = (byArtist[l.artist] || 0) + 1;
    byForm[classifyForm(l)] = (byForm[classifyForm(l)] || 0) + 1;
    byStatus[`${l.status}${l.priceUsd ? '+price' : ''}`] = (byStatus[`${l.status}${l.priceUsd ? '+price' : ''}`] || 0) + 1;
  }
  console.log(`\n${label}: byStatus=${JSON.stringify(byStatus)}\n byForm=${JSON.stringify(byForm)}\n byArtist=${JSON.stringify(Object.fromEntries(Object.entries(byArtist).sort((a, b) => b[1] - a[1]).slice(0, 12)))}`);
};
breakdown(origButPrintCued, 'original→print flips');
breakdown(printButOrigCued, 'print→original flips');

// price contamination check: for artists with ≥5 flips, median price of the
// flipped rows vs median of the artist's KEPT sold 'original' paintings.
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const flipsByArtist: Record<string, AuctionLot[]> = {};
for (const l of origButPrintCued) (flipsByArtist[l.artist] ||= []).push(l);
console.log('\n-- price contamination (sold, priced rows only) --');
for (const [a, arr] of Object.entries(flipsByArtist).filter(([, v]) => v.length >= 5)) {
  const flippedP = arr.filter(l => l.priceUsd).map(l => l.priceUsd!);
  const keptOrig = lots.filter(l => l.artist === a && l.category === 'original' && l.priceUsd
    && !origButPrintCued.includes(l)).map(l => l.priceUsd!);
  console.log(`  ${a}: flipped n=${flippedP.length} med=$${Math.round(median(flippedP))}  vs kept-original n=${keptOrig.length} med=$${Math.round(median(keptOrig))}`);
}
