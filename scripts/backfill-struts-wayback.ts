// Wayback backfill for the Struts auction platform — Propstore and Julien's.
//
// Both live hosts are walled (Cloudflare 403 / AWS-WAF 202-empty, verified
// Sep 3 2026), so realized prices come from Wayback captures of their
// lot-details pages. Recon, CDX numbers and measured yields:
// scripts/_qa/JULIENS_PROPSTORE_PLAN.md.
//
// Two phases:
//   1. MANIFEST — query the Wayback CDX index for every captured lot-details
//      url and reduce it to the LATEST capture per (catalog, lot). Latest is
//      not a detail: at a random capture Propstore's sold-rate is ~14% and
//      most pages predate the sale close; the latest capture is the only one
//      that can carry a result.
//        npx tsx scripts/backfill-struts-wayback.ts --house propstore --build-manifest
//   2. WALK — fetch each snapshot with the `id_` modifier (original bytes, no
//      Archive toolbar), parse, union into the house's segment.
//        npx tsx scripts/backfill-struts-wayback.ts --house propstore \
//          --conc 2 --delay 400 [--skip N] [--cap M] --write
//
// web.archive.org rate-limits hard (bursts of `Failed to connect` at 3-way
// concurrency during recon, and two CDX 503s), so: conc <= 2, delay >= 400ms,
// retries with a long backoff, and long walks are sliced with --skip/--cap
// across dispatches, exactly like the MLB idwalk.
//
// SAFETY (all the standing laws):
//   · silent-zero guard — pages fetched but nothing parsed ⇒ exit 1, no write
//   · poison detector before EVERY write, incremental flushes included
//   · settledOnly + assertInvariants before the write
//   · writeMergedSegment unions (fresh id wins) so a bounded slice can never
//     shrink the segment
import * as fs from 'fs';
import * as path from 'path';
import type { AuctionLot } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { getHtml, mapPool, settledOnly, writeMergedSegment, installCrashGuard, REAL_UA, FETCH_STATS, mapPoolErrors } from './lib/sports-crawl';
import { poisonedBatch } from './lib/bidsquare';
import { STRUTS_HOUSES, parseStrutsLot, type ParseReason } from './lib/struts-auction';
import { readSegment } from './corpus-io';

const CDX_PREFIX: Record<string, string> = {
  juliens: 'julienslive.com/lot-details*',
  propstore: 'propstoreauction.com/lot-details*',
};

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const argNum = (name: string, def: number) => parseInt(arg(name, String(def)), 10);

interface Row { catalog: string; lot: string; ts: string; original: string; }

function manifestPath(house: string): string {
  return arg('manifest', path.join(process.cwd(), 'scripts', 'data', `${house}-wayback-lots.csv`));
}

/** CDX with a long backoff — the index answers 503 "Temporarily Offline" under
 *  load, which is NOT "no captures" and must never be read as one. */
async function cdx(pattern: string): Promise<string[][]> {
  const url = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pattern)}` +
    `&output=json&limit=400000&fl=timestamp,original&collapse=urlkey&filter=statuscode:200`;
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': REAL_UA }, signal: AbortSignal.timeout(300_000) });
      const text = await r.text();
      if (r.ok && text.trimStart().startsWith('[')) return JSON.parse(text).slice(1) as string[][];
      console.warn(`[cdx] attempt ${a + 1}: HTTP ${r.status}, ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
    } catch (e) { console.warn(`[cdx] attempt ${a + 1} failed: ${(e as Error).message}`); }
    await new Promise(res => setTimeout(res, 15_000 * (a + 1)));
  }
  throw new Error('CDX index unreachable after 5 attempts — refusing to build a partial manifest');
}

async function buildManifest(house: string): Promise<void> {
  const rows = await cdx(CDX_PREFIX[house]);
  const latest = new Map<string, Row>();
  for (const [ts, original] of rows) {
    const m = original.match(/\/catalog\/(\d+)\/lot\/(\d+)/);
    if (!m) continue;
    const key = `${m[1]}/${m[2]}`;
    const prev = latest.get(key);
    if (!prev || ts > prev.ts) latest.set(key, { catalog: m[1], lot: m[2], ts, original });
  }
  const out = manifestPath(house);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const lines = ['catalog,lot,timestamp,original'];
  for (const r of Array.from(latest.values()).sort((a, b) => Number(a.catalog) - Number(b.catalog) || Number(a.lot) - Number(b.lot))) {
    lines.push(`${r.catalog},${r.lot},${r.ts},${r.original.replace(/,/g, '%2C')}`);
  }
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`[${house}] manifest: ${rows.length} CDX rows → ${latest.size} unique (catalog,lot) at their LATEST capture → ${out}`);
}

function readManifest(house: string): Row[] {
  const p = manifestPath(house);
  if (!fs.existsSync(p)) throw new Error(`no manifest at ${p} — run with --build-manifest first`);
  return fs.readFileSync(p, 'utf8').trim().split('\n').slice(1).map(l => {
    const [catalog, lot, ts, original] = l.split(',');
    return { catalog, lot, ts, original: original.replace(/%2C/g, ',') };
  }).filter(r => r.catalog && r.lot && r.ts);
}

async function main() {
  const house = arg('house', '');
  const cfg = STRUTS_HOUSES[house];
  if (!cfg) { console.error(`--house must be one of: ${Object.keys(STRUTS_HOUSES).join(', ')}`); process.exit(1); }
  const L = cfg.label;

  if (process.argv.includes('--build-manifest')) { await buildManifest(house); return; }

  const write = process.argv.includes('--write');
  if (write) installCrashGuard(L);
  const conc = Math.min(2, argNum('conc', 2));   // hard-capped: the Archive throttles above this
  const delayMs = argNum('delay', 400);
  const skip = argNum('skip', 0);
  const cap = argNum('cap', 0);

  // ids already in the segment never need a re-fetch
  const existingIds = new Set((readSegment(cfg.segment) as unknown as AuctionLot[]).map(l => l.id));
  let rows = readManifest(house).filter(r => !existingIds.has(`${cfg.idPrefix}-${r.catalog}-${r.lot}`));
  if (skip > 0) rows = rows.slice(skip);
  if (cap > 0) rows = rows.slice(0, cap);
  console.log(`[${L}] walking ${rows.length} archived lots (skip ${skip}, cap ${cap || '∞'}, conc ${conc}, delay ${delayMs}ms)`);

  const lots: AuctionLot[] = [];
  const reasons: Record<string, number> = {};
  let fetched = 0, miss = 0, done = 0;
  const bump = (r: ParseReason | 'fetch-miss') => { reasons[r] = (reasons[r] || 0) + 1; };

  await mapPool(rows, conc, async (r) => {
    const url = `https://web.archive.org/web/${r.ts}id_/${r.original}`;
    // 3 tries with a long backoff — the Archive refuses connections in bursts
    let html: string | null = null;
    for (let a = 0; a < 3 && !html; a++) {
      html = await getHtml(url, 90_000, 0);
      if (!html) await new Promise(res => setTimeout(res, 5_000 * (a + 1)));
    }
    await new Promise(res => setTimeout(res, delayMs));
    done++;
    if (done % 500 === 0) console.log(`[${L}] ${done}/${rows.length} walked, ${lots.length} sold rows so far`);
    if (!html) { miss++; bump('fetch-miss'); return; }
    fetched++;
    const { lot, reason } = parseStrutsLot(cfg, html, r.catalog, r.lot);
    bump(reason);
    if (lot) lots.push(lot);

    // INCREMENTAL: a 14k-lot walk must not lose everything to a crash — flush
    // every 500 keeps, but only past the poison detector
    if (write && lots.length && lots.length % 500 === 0) {
      const { good } = settledOnly(lots);
      const p = poisonedBatch(good);
      if (p) { console.error(`[${L}] ABORT (flush): $${p.price} repeats on ${p.n}/${good.length} rows — poisoned feed, nothing written.`); process.exit(1); }
      if (good.length) console.log(`  [${L}] flush → segment now ${writeMergedSegment(cfg.segment, good).total} lots`);
    }
  }, L);

  console.log(`[${L}] walked ${done}: fetched ${fetched}, miss ${miss}, parsed ${lots.length}`);
  console.log(`[${L}] outcomes:`, reasons);
  console.log(`[${L}] health: non2xx ${FETCH_STATS.non2xx}, rateLimited ${FETCH_STATS.rateLimited}, failed ${FETCH_STATS.failed}, poolErrors ${mapPoolErrors()}`);

  // NO SILENT ZERO: pages came back and none parsed = broken parser / changed
  // markup. Refuse the run so the prior segment rides untouched.
  if (fetched >= 20 && lots.length === 0) {
    console.error(`[${L}] FATAL: fetched ${fetched} snapshots and parsed 0 sold rows — refusing to write.`);
    process.exit(1);
  }

  if (!write) {
    const s = lots[0];
    if (s) console.log(`[${L}] sample:`, JSON.stringify({
      id: s.id, title: s.title.slice(0, 60), saleName: s.saleName, saleDate: s.saleDate, lot: s.lotNumber,
      cur: (s as { nativeCurrency?: string }).nativeCurrency, native: (s as { hammerNative?: number }).hammerNative,
      usd: (s as { priceUsd?: number }).priceUsd, basis: (s as { priceBasis?: string }).priceBasis,
      cat: (s as { subCat?: string }).subCat, conf: (s as { authConfidence?: string }).authConfidence,
    }));
    console.log(`[${L}] dry run (pass --write to persist)`);
    return;
  }

  const { good, dropped } = settledOnly(lots);
  if (dropped) console.log(`[${L}] dropped ${dropped} unsettled/future-dated lots`);
  const poison = poisonedBatch(good);
  if (poison) { console.error(`[${L}] ABORT: $${poison.price} repeats on ${poison.n}/${good.length} new sold rows — poisoned feed, nothing written.`); process.exit(1); }
  const rep = assertInvariants(good);
  if (rep.fatal.length) {
    console.error(`[${L}] refusing to write: ${rep.fatal.length} FATALs`);
    rep.fatal.slice(0, 5).forEach(f => console.error('  ', f));
    process.exit(1);
  }
  if (!good.length) { console.log(`[${L}] nothing new to write — segment untouched.`); return; }
  const r = writeMergedSegment(cfg.segment, good);
  console.log(`[${L}] merged into segment '${cfg.segment}': +${r.added} new, ${r.total} total.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[backfill-struts-wayback] fatal', e); process.exit(1); });
}
