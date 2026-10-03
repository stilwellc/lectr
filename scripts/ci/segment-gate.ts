/**
 * segment-gate.ts — the PER-HOUSE integrity gate on segment writes.
 *
 * assemble's corpus-wide shrink gate (>10%) is blind to one house collapsing:
 * Hake's losing every row is 0.03% of a 1.1M-lot corpus. This gate runs at
 * `data-store.sh push-segment` time — the moment a writer (the nightly crawl
 * leg, a heal, a backfill) is about to replace latest/segments/<house> — and
 * compares the new file against the stats of the segment it pulled:
 *
 *   ROWS     settled rows (everything but 'upcoming') may not drop > 5%.
 *            Upcoming rows are excluded on purpose: the live snapshot is
 *            REPLACED nightly, so a sale closing legitimately removes them.
 *   SOLD     the house may not lose more than 200 sold rows.
 *   PRICES   (≥ 200 priced sold rows on both sides) the sold median must stay
 *            within ×0.67–×1.5 of the baseline, the p90 within ×0.5–×2, and
 *            the share of sold rows sitting on ONE price may not rise > 5pt
 *            (the stamped-feed bleed shape the sentinel hunts corpus-wide).
 *
 * A blocked house keeps its LAST-GOOD segment; the rest of the night (and the
 * publish) proceeds. Override for a deliberate shrink (a dedupe heal):
 * SEGMENT_SHRINK_OK=1.
 *
 *   npx tsx scripts/ci/segment-gate.ts stats <file.ndjson.gz>          → JSON stats on stdout
 *   npx tsx scripts/ci/segment-gate.ts check <house> <prev-stats.json> <file.ndjson.gz>
 *        exit 0 pass · 3 BLOCKED (writes data/qa/leg-health-gate.json) · 1 tool error
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';

export interface SegmentStats {
  rows: number;
  upcoming: number;
  settled: number;
  sold: number;
  priced: number;
  medianUsd: number | null;
  p90Usd: number | null;
  /** share of priced sold rows on the single most common price (0–1) */
  topPriceShare: number | null;
}

export const GATE_DEFAULTS = {
  maxSettledDropPct: 5,
  maxSoldLoss: 200,
  minPricedForPriceCheck: 200,
  medianBand: [0.67, 1.5] as [number, number],
  p90Band: [0.5, 2] as [number, number],
  maxTopShareRisePt: 5,
};
export type GateOpts = typeof GATE_DEFAULTS;

const quantile = (sorted: Float64Array, q: number): number | null => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
};

/** Accumulate stats row by row (streaming — a Goldin segment is ~400k rows). */
export function statsAccumulator() {
  let rows = 0, upcoming = 0, sold = 0;
  let prices = new Float64Array(1024);
  let priced = 0;
  return {
    add(l: { status?: unknown; priceUsd?: unknown; realizedUsd?: unknown }) {
      rows++;
      if (l.status === 'upcoming') { upcoming++; return; }
      if (l.status !== 'sold') return;
      sold++;
      const p = typeof l.realizedUsd === 'number' && l.realizedUsd > 0 ? l.realizedUsd : typeof l.priceUsd === 'number' && l.priceUsd > 0 ? l.priceUsd : null;
      if (p == null) return;
      if (priced === prices.length) { const n = new Float64Array(prices.length * 2); n.set(prices); prices = n; }
      prices[priced++] = p;
    },
    done(): SegmentStats {
      const s = prices.slice(0, priced).sort();
      let top = 0;
      for (let i = 0, run = 0; i < s.length; i++) { run = i > 0 && s[i] === s[i - 1] ? run + 1 : 1; if (run > top) top = run; }
      return {
        rows, upcoming, settled: rows - upcoming, sold, priced,
        medianUsd: quantile(s, 0.5), p90Usd: quantile(s, 0.9),
        topPriceShare: priced ? Math.round(top / priced * 1e4) / 1e4 : null,
      };
    },
  };
}

export function statsOfRows(rows: Array<Record<string, unknown>>): SegmentStats {
  const a = statsAccumulator();
  for (const r of rows) a.add(r);
  return a.done();
}

export async function statsOfFile(file: string): Promise<SegmentStats> {
  const a = statsAccumulator();
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    const v = JSON.parse(t);
    if (Array.isArray(v)) for (const x of v) a.add(x); else a.add(v);
  }
  return a.done();
}

export function segmentGateVerdict(prev: SegmentStats | null, next: SegmentStats, opts: Partial<GateOpts> = {}): { ok: boolean; reasons: string[] } {
  const o = { ...GATE_DEFAULTS, ...opts };
  const reasons: string[] = [];
  if (!prev || !prev.rows) return { ok: true, reasons: ['no baseline (first write of this segment)'] };
  // an all-live house (Hake's: 1,984 upcoming, 0 settled) has no settled
  // baseline to shrink from — an EMPTIED segment is still a collapse
  if (prev.rows >= 100 && next.rows === 0) reasons.push(`segment emptied (${prev.rows} rows → 0)`);
  if (prev.settled > 0 && next.settled < prev.settled * (1 - o.maxSettledDropPct / 100)) {
    reasons.push(`settled rows ${prev.settled} → ${next.settled} (−${((1 - next.settled / prev.settled) * 100).toFixed(1)}% > ${o.maxSettledDropPct}%)`);
  }
  if (prev.sold - next.sold > o.maxSoldLoss) reasons.push(`lost ${prev.sold - next.sold} sold rows (${prev.sold} → ${next.sold}; max ${o.maxSoldLoss})`);
  if (prev.priced >= o.minPricedForPriceCheck && next.priced >= o.minPricedForPriceCheck) {
    const band = (a: number | null, b: number | null, [lo, hi]: [number, number], label: string) => {
      if (!a || !b) return;
      const r = b / a;
      if (r < lo || r > hi) reasons.push(`${label} $${Math.round(a)} → $${Math.round(b)} (×${r.toFixed(2)} outside ×${lo}–×${hi})`);
    };
    band(prev.medianUsd, next.medianUsd, o.medianBand, 'sold median');
    band(prev.p90Usd, next.p90Usd, o.p90Band, 'sold p90');
    if (prev.topPriceShare != null && next.topPriceShare != null && (next.topPriceShare - prev.topPriceShare) * 100 > o.maxTopShareRisePt) {
      reasons.push(`one price now holds ${(next.topPriceShare * 100).toFixed(1)}% of sold rows (was ${(prev.topPriceShare * 100).toFixed(1)}%) — stamped-price shape`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

async function cli() {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'stats' && a) { process.stdout.write(JSON.stringify(await statsOfFile(a)) + '\n'); return 0; }
  if (cmd === 'check' && a && b && c) {
    const house = a;
    let prev: SegmentStats | null = null;
    try { prev = fs.existsSync(b) ? JSON.parse(fs.readFileSync(b, 'utf8')) : null; } catch { prev = null; }
    const next = await statsOfFile(c);
    const v = segmentGateVerdict(prev, next);
    const fmt = (s: SegmentStats | null) => s ? `rows ${s.rows} (settled ${s.settled}, sold ${s.sold}) · median $${Math.round(s.medianUsd || 0)} · p90 $${Math.round(s.p90Usd || 0)}` : 'none';
    console.log(`[segment-gate] ${house}: baseline ${fmt(prev)} → new ${fmt(next)}`);
    if (v.ok) { console.log(`[segment-gate] ${house}: PASS${v.reasons.length ? ` (${v.reasons.join('; ')})` : ''}`); return 0; }
    const why = `per-house shrink gate: ${v.reasons.join('; ')} — last-good segment kept`;
    console.log(`::error title=segment gate blocked ${house}::${why}`);
    try {
      fs.mkdirSync(path.join('data', 'qa'), { recursive: true });
      fs.writeFileSync(path.join('data', 'qa', 'leg-health-gate.json'), JSON.stringify({ house, ok: false, fetched: 0, parsed: next.rows, settled: next.sold, reason: why }, null, 2) + '\n');
    } catch { /* advisory */ }
    return 3;
  }
  console.error('usage: segment-gate.ts stats <file> | check <house> <prev-stats.json> <file>');
  return 1;
}

if (process.env.RAY_SKIP_MAIN !== '1') cli().then(code => process.exit(code), e => { console.error(`[segment-gate] ${(e as Error).message}`); process.exit(1); });
