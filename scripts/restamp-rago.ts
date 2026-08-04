/**
 * restamp-rago.ts — repair the Wright/Rago house crosstalk in existing data.
 *
 * THE BUG. Wright's API returns a per-ITEM `house` field. A single auction
 * session can therefore come back split across the Wright and Rago brands, and
 * the crawler stamped each lot from its own item payload — so lots that were
 * sold by Rago got `auctionHouse: 'Wright'` and a wright20.com URL. Those URLs
 * 404: the lot only exists on ragoarts.com. The GA smoke test measured 25 of 91
 * external comp links on /value dead for exactly this reason — on the comp
 * ladder, which is the one surface where the product asks to be trusted on its
 * evidence.
 *
 * THE CRAWLER IS ALREADY FIXED (house resolved per-SESSION, ids namespaced at
 * birth). This script exists because the affected rows are historical sold lots
 * that are never re-crawled, so nothing self-heals them.
 *
 * WHAT WE REWRITE, AND ON WHAT EVIDENCE. scripts/_data/rago-sales.json lists
 * every (year, month, slug) sale that was PROBE-VERIFIED as Rago: the lot page
 * 404s on wright20.com and 200s on ragoarts.com with a matching canonical link
 * and "<lotNumber>:" meta title. 103 of 129 sales were confirmed with two
 * distinct lots; the other 26 by the sale-index page on both hosts. Sales that
 * 404 on BOTH hosts are delisted, NOT misattributed — they are deliberately
 * left alone (rewriting them would swap one dead link for another and destroy
 * the evidence that they were Wright's).
 *
 * WHAT WE DELIBERATELY DO NOT TOUCH:
 *  - `id`. Ids are permalinks: /lot/<id>, useSavedLots entries, and the Supabase
 *    mirror are all keyed on them, and that mirror never deletes rows. Renaming
 *    wright-* to rago-* would orphan every saved lot and every shared URL. The
 *    id keeps its historical prefix; the house and URL become correct.
 *  - Any sale not in the verified list.
 *
 * SEGMENT SAFETY: corpus-io maps BOTH 'Wright' and 'Rago' to the 'wright'
 * segment, so restamping the house does not move a row between segments — the
 * wright crawler still owns these rows and will not orphan them.
 *
 * Dry-run by default (house convention, cf. migrate-v2.ts). Pass --commit to
 * write. Every target file is backed up to <file>.pre-rago.bak first.
 *
 *   npx tsx scripts/restamp-rago.ts              # report only
 *   npx tsx scripts/restamp-rago.ts --commit     # write
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const COMMIT = process.argv.includes('--commit');
const ROOT = process.cwd();
const LIST = path.join(ROOT, 'scripts', '_data', 'rago-sales.json');

const TARGETS = [
  path.join(ROOT, 'data', 'corpus', 'segments', 'wright.ndjson.gz'),
  path.join(ROOT, 'data', 'corpus', 'lots.json.gz'),
  path.join(ROOT, 'data', 'corpus', 'sold-archive.json.gz'),
];

// https://www.wright20.com/auctions/<YYYY>/<MM>/<slug>/<lot>
const WRIGHT_LOT = /^https?:\/\/(?:www\.)?wright20\.com\/auctions\/(\d{4})\/(\d{2})\/([a-z0-9-]+)\/(\d+)/i;

const listed = JSON.parse(fs.readFileSync(LIST, 'utf8')) as {
  sales: { y: string; m: string; slug: string; rows: number }[];
};
const RAGO = new Set(listed.sales.map(s => `${s.y}/${s.m}/${s.slug}`));
console.log(`[rago] ${RAGO.size} probe-verified Rago sales loaded (expect ${listed.sales.reduce((n, s) => n + s.rows, 0)} rows)`);

interface Lot { id?: string; url?: string; auctionHouse?: string }

/** Returns the rewritten line, or null when the row is not ours to touch. */
function restampLine(line: string): string | null {
  // cheap prefilter — the vast majority of lines are not Wright at all
  if (!line.includes('wright20.com')) return null;
  let lot: Lot;
  try { lot = JSON.parse(line) as Lot; } catch { return null; }
  const m = lot.url ? WRIGHT_LOT.exec(lot.url) : null;
  if (!m) return null;
  if (!RAGO.has(`${m[1]}/${m[2]}/${m[3]}`)) return null;
  lot.url = lot.url!.replace(/^(https?:\/\/)(?:www\.)?wright20\.com/i, '$1www.ragoarts.com');
  lot.auctionHouse = 'Rago';
  return JSON.stringify(lot);
}

/**
 * Walk a gunzipped NDJSON buffer line-by-line WITHOUT ever building one string
 * for the whole file. sold-archive.json.gz inflates past V8's max string length
 * (ERR_STRING_TOO_LONG) — the same constraint corpus-io.ts's parseNdjson was
 * written against. Each line is decoded on its own; output accumulates as small
 * per-line buffers that are concatenated once at the end.
 */
function walk(buf: Buffer, onLine: (line: string) => string | null): { parts: Buffer[]; lines: number; changed: number } {
  const parts: Buffer[] = [];
  let lines = 0, changed = 0, start = 0;
  const NL = Buffer.from('\n');
  const flush = (s: number, e: number) => {
    if (e <= s) { parts.push(NL); return; }
    lines++;
    const line = buf.toString('utf8', s, e);
    const next = onLine(line);
    if (next !== null) { changed++; parts.push(Buffer.from(next, 'utf8')); }
    else parts.push(buf.subarray(s, e));
    parts.push(NL);
  };
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { flush(start, i); start = i + 1; }
  }
  if (start < buf.length) flush(start, buf.length);
  return { parts, lines, changed };
}

let grand = 0;
for (const file of TARGETS) {
  if (!fs.existsSync(file)) { console.log(`[rago] SKIP (absent): ${path.relative(ROOT, file)}`); continue; }
  const raw = zlib.gunzipSync(fs.readFileSync(file));
  const { parts, lines, changed } = walk(raw, restampLine);
  grand += changed;
  console.log(`[rago] ${path.relative(ROOT, file)}: ${changed} rows restamped (of ${lines} rows)`);
  if (COMMIT && changed > 0) {
    const bak = `${file}.pre-rago.bak`;
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    fs.writeFileSync(file, zlib.gzipSync(Buffer.concat(parts), { level: 9 }));
    // read back and re-verify: a corpus we cannot re-read is worse than the bug
    const back = zlib.gunzipSync(fs.readFileSync(file));
    let residual = 0, reread = 0;
    walk(back, line => {
      reread++;
      if (line.includes('wright20.com')) {
        try {
          const mm = WRIGHT_LOT.exec((JSON.parse(line) as Lot).url || '');
          if (mm && RAGO.has(`${mm[1]}/${mm[2]}/${mm[3]}`)) residual++;
        } catch { /* unparseable line is caught by the count check below */ }
      }
      return null;
    });
    console.log(`[rago]   ✓ rewritten + re-read ${reread} rows · residual bad rows: ${residual}`);
    if (residual > 0) throw new Error('restamp did not fully apply — refusing to continue');
    if (reread !== lines) throw new Error(`row count changed ${lines} -> ${reread} — refusing to continue`);
  }
}

console.log(
  COMMIT
    ? `[rago] COMMITTED · ${grand} rows restamped. Backups at *.pre-rago.bak. Re-run build-market to propagate to served.`
    : `[rago] DRY RUN · ${grand} rows WOULD be restamped. Re-run with --commit to write.`
);
