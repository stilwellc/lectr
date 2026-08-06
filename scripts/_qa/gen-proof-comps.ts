/**
 * gen-proof-comps.ts — resolve and persist the ACTUAL comparable sales behind
 * each /about proof case.
 *
 * §04 says "from 18 comparable sales" and, until now, could not show them. The
 * obvious wiring — link the card to /lot?id=<id> — produces a visible
 * self-contradiction: `value` (and with it `poolIds`) is stamped only onto
 * UPCOMING lots by build-market.ts, so these settled lots have no stamp, and
 * LotPage falls through to the client-side gate in signalWithPool, which
 * returns null unless the ratio clears 1.3/0.75. Most cards would link to a
 * page reading "No comparable sales clear the gates for this lot."
 *
 * So the evidence is resolved here, at generation time, using the same
 * point-in-time replay that produced the case (valueOne -> ValueResult.poolIds,
 * strictly sales dated before the lot), and written into proof-cases.json. The
 * deck then renders its own comps from shipped data and stays self-contained —
 * no dependency on the phase-2 shards or the 10MB sold-archive tier, which one
 * of the seven (the Goldin lot) would otherwise require.
 *
 *   npx tsx scripts/_qa/gen-proof-comps.ts          # dry run, prints what it found
 *   npx tsx scripts/_qa/gen-proof-comps.ts --commit # writes proof-cases.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus } from '../corpus-io';
import { prepare, valueOne } from '../backtest-core';
import type { AuctionLot } from '../../app/types';

const COMMIT = process.argv.includes('--commit');
const CASES = path.join(process.cwd(), 'app', 'about', 'proof-cases.json');
/** shown per card — enough to be evidence, few enough to read */
const MAX_SHOWN = 8;

interface Comp {
  title: string; house: string; saleDate: string; priceUsd: number; url: string | null;
}

/**
 * Sotheby's ships bilingual titles — the English lot name, a pipe, then the same
 * thing in Chinese ("...circa 1974 | 愛彼 | royal oak 'a-series jumbo' 型號 5402st
 * 精鋼鍊帶腕錶..."). Rendered raw in a narrow card column that tripled row height
 * for no added information. Drop any pipe-segment that is substantially CJK,
 * then bound the length.
 */
function cleanTitle(raw: string): string {
  const cjk = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/g;
  const kept = String(raw || '')
    .split('|')
    .map((seg) => seg.trim())
    .filter((seg) => {
      if (!seg) return false;
      const hits = (seg.match(cjk) || []).length;
      return hits / seg.length < 0.15;
    });
  const out = (kept.join(' | ') || String(raw || '')).replace(/\s+/g, ' ').trim();
  return out.length > 88 ? out.slice(0, 86).replace(/[\s,;|]+$/, '') + '…' : out;
}

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const log = (m: string) => console.log(m);

const doc = JSON.parse(fs.readFileSync(CASES, 'utf8')) as {
  cases: { id: string; comps: number; title: string; ourValueUsd: number; compRows?: Comp[]; compsShown?: number }[];
};
const wanted = new Set(doc.cases.map((c) => c.id));

const all = readCorpus() as unknown as AuctionLot[];
const byId = new Map(all.map((l) => [l.id, l]));
const prep = prepare(all, log, elapsed);

let ok = 0;
for (const c of doc.cases) {
  const lot = byId.get(c.id);
  if (!lot) { log(`  ✗ ${c.id} — not in corpus`); continue; }

  const v = valueOne(prep, lot as never);
  if (!v || !v.poolIds?.length) { log(`  ✗ ${c.id} — replay returned no pool`); continue; }

  // Resolve pool ids back to lots, keep only settled ones with a price, and
  // order by recency — the engine weights recent sales, so the reader should
  // see them in the order that mattered.
  const rows: Comp[] = v.poolIds
    .map((id: string) => byId.get(id))
    .filter((l): l is AuctionLot => !!l && l.status === 'sold' && !!(l.realizedUsd || l.priceUsd))
    .sort((a, b) => String(b.saleDate).localeCompare(String(a.saleDate)))
    .slice(0, MAX_SHOWN)
    .map((l) => ({
      title: cleanTitle(l.title),
      house: l.auctionHouse,
      saleDate: l.saleDate,
      priceUsd: Math.round((l.realizedUsd || l.priceUsd) as number),
      url: (l as AuctionLot).url ?? null,
    }));

  if (!rows.length) { log(`  ✗ ${c.id} — pool resolved to 0 settled lots`); continue; }

  c.compRows = rows;
  c.compsShown = rows.length;
  // Keep `comps` as the TRUE pool size the engine used; compsShown is what the
  // card displays. Conflating them would overstate or understate the evidence.
  c.comps = v.n;
  ok++;
  log(`  ✓ ${c.id.slice(0, 34).padEnd(34)} pool ${String(v.n).padStart(3)}  showing ${rows.length}  latest ${rows[0].saleDate}`);
}

log(`\n[gen-proof-comps] resolved ${ok}/${doc.cases.length} cases (${elapsed()})`);
if (!COMMIT) { log('[gen-proof-comps] DRY RUN — pass --commit to write'); process.exit(0); }
fs.writeFileSync(CASES, JSON.stringify(doc, null, 2) + '\n');
log(`[gen-proof-comps] wrote ${path.relative(process.cwd(), CASES)}`);
if (ok < doc.cases.length) { log('[gen-proof-comps] WARNING: some cases have no comps — the UI must handle that'); }
void wanted;
