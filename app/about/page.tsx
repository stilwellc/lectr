import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import Flick from '../components/Flick';
import { Colophon } from '../components/Terminal';
import { MARKETS } from '../constants';
import { craftTitle } from '../utils';
import meta from '../../public/data/ray/meta.json';
import backtest from '../../public/data/ray/backtest.json';
import market from '../../public/data/ray/market.json';
import refs from '../../public/data/ray/refs.json';
import proof from './proof-cases.json';
import coverageSnapshot from './coverage.json';
import distribution from './distribution.json';
import { readLiveBook, type LiveBook } from './live';
import PlateImg from '../components/PlateImg';
import DeckFx from './DeckFx';
import { httpsImg, sizedImg } from '../utils';

/**
 * WHAT IS LECTR — the pitch deck.
 *
 * The argument (corpus → engine → record → proof → restraint → graph → stakes)
 * is unchanged from the institutional page it replaces. What changed is the
 * staging: this is the one page on the site allowed to be cinema — a scrolled
 * deck on the deep ground, chapters kept by a fixed rail, numerals that count
 * up to the truth, charts that draw themselves, and the hand-drawn mark given
 * the opening slide. The motion never invents a figure: every animation lands
 * on a value the server rendered from the shipped data.
 *
 * EVERY FIGURE IS DERIVED FROM THE SHIPPED DATA at build time — meta.json,
 * backtest.json, market.json, refs.json. Nothing is typed by hand, so nothing
 * here can quietly go stale the way a hardcoded deck does. This is a server
 * component; those imports never reach the client bundle. The only client JS
 * is DeckFx, which choreographs — it holds no data.
 */

export const metadata: Metadata = {
  title: 'What is lectr — the auction market, priced',
  // Derived, not typed: a previous revision hardcoded the corpus count here
  // and it drifted 772 lots stale within two nightlies.
  description: `lectr reads every published estimate against every realised hammer across ${meta.sources.length} auction houses and three decades — ${Number(meta.totalSold).toLocaleString('en-US')} settled lots — and prices what comes next. The corpus, the value engine, the replayed record, and what it refuses to say.`,
};

const p: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.7, color: 'var(--color-text-secondary)', margin: '0 0 16px' };
const caption: React.CSSProperties = { fontSize: 12.5, color: 'var(--color-text-faint)', margin: '10px 0 0', lineHeight: 1.6 };

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}%`;

/* ── figures, all read from the shipped payloads ─────────────────────────── */
const F = backtest.flagged;
const U = backtest.unflagged;
const edgeAllIn = F.medianPerfPct - U.medianPerfPct;

const marketsRec = market.markets as Record<string, { label?: string; n?: number }>;
const MARKET_LABEL = Object.fromEntries(MARKETS.map((m) => [m.key, m.label]));
const CORPUS_BARS = (['sports', 'culture', 'watches', 'art', 'science', 'design'] as const)
  .map((k) => ({ key: k, label: MARKET_LABEL[k] || marketsRec[k]?.label || k, n: marketsRec[k]?.n || 0 }))
  .filter((b) => b.n > 0)
  .sort((a, b) => b.n - a.n);

// Coverage prefers meta.json's live block (written by every crawl and by
// assemble) and falls back to the committed snapshot. Read through a cast on
// purpose: public/data/ray/ is gitignored and pulled from R2 at build time, so
// tsc infers meta's type from whatever JSON that pull produced. Naming
// meta.coverage directly would break the build on any CI run that happens
// before the first nightly carrying the field.
interface Cov { house: string; first: number; dense: number; last: number; n: number }
const COVERAGE: Cov[] =
  ((meta as Record<string, unknown>).coverage as Cov[] | undefined)?.length
    ? ((meta as Record<string, unknown>).coverage as Cov[])
    : (coverageSnapshot.coverage as Cov[]);
// Measured from the earliest DENSE year, not the earliest record. Christie's
// has a single lot dated 1989; claiming 37 years off it would be exactly the
// overstatement the dense/first split exists to prevent. 1991 -> 2026 = 35.
const ARCHIVE_YEARS = COVERAGE.length
  ? Math.max(...COVERAGE.map((c) => c.last)) - Math.min(...COVERAGE.map((c) => c.dense))
  : 0;

const PROV = proof.provenance.withEstimate;

interface SeriesRow { year: number; flaggedMedianPct: number; unflaggedMedianPct: number; nFlagged: number }

// Prefer the live block and fall back to the committed snapshot — same
// gitignored-payload reasoning as coverage above. Regenerate the snapshot with
// `npx tsx scripts/_qa/gen-distribution.ts`.
type Dist = typeof distribution;
const DIST: Dist = (() => {
  const live = (backtest as Record<string, unknown>).distribution as Dist | undefined;
  return live?.bins?.length && live.summary ? { ...distribution, ...live } : distribution;
})();
const SERIES = ((backtest as Record<string, unknown>).series as SeriesRow[] | undefined) ?? [];

const pts = (d: number) => `${d > 0 ? '+' : ''}${Math.round(d * 10) / 10} pts`;
const RECORD_ROWS = [
  {
    k: 'Median result vs estimate · all-in', note: 'what the buyer paid, premium included',
    lo: U.medianPerfPct, hi: F.medianPerfPct, fmt: pct, edge: pts(F.medianPerfPct - U.medianPerfPct),
  },
  {
    k: 'Median result vs estimate · at hammer', note: 'like-for-like against a hammer-basis estimate',
    lo: U.hammerMedianPct ?? 0, hi: F.hammerMedianPct ?? 0, fmt: pct,
    edge: pts((F.hammerMedianPct ?? 0) - (U.hammerMedianPct ?? 0)),
  },
  {
    k: 'Cleared the high estimate', note: 'share of lots that beat the top of the range',
    lo: U.beatHighPct, hi: F.beatHighPct, fmt: (v: number) => `${v}%`, edge: pts(F.beatHighPct - U.beatHighPct),
  },
  {
    k: 'Failed to sell', note: 'lower is better — the flag does not chase no-sales',
    lo: U.failToSellPct, hi: F.failToSellPct, fmt: (v: number) => `${v}%`, edge: pts(U.failToSellPct - F.failToSellPct),
  },
];

const drillsRec = market.drills as Record<string, { readType: string }[]>;
const allDrills = Object.values(drillsRec).flat();
const drillCount = allDrills.length;
const drillAbstain = allDrills.filter((d) => d.readType === 'descriptive').length;

const makerIdx = market.makerIndex as Record<string, { horizons?: Record<string, { publishable?: boolean }> }>;
const makerTotal = Object.keys(makerIdx).length;
const makerPublish = Object.values(makerIdx).filter((m) =>
  Object.values(m.horizons || {}).some((h) => h?.publishable),
).length;

// refs.json is { generatedAt, refs: [...] } — an Array.isArray() check on the
// wrapper silently yields 0, which shipped a literal "0 Reference dossiers".
const refCount = (refs as { refs?: unknown[] }).refs?.length ?? 0;
const calN = backtest.calibration?.n ?? null;

/* ── DEMO LINKS for §06 — the graph as a tour, not a diagram ─────────────
   Derived, never hardcoded: the maker link must point at a maker whose index
   actually publishes (the node's own claim), and the ref link at a dossier
   that exists in tonight's refs.json. Recognisable names preferred; any
   publishable maker as fallback. */
const DEMO_MAKER =
  ['rolex', 'patek-philippe', 'cartier', 'audemars-piguet'].find((s) => {
    const m = makerIdx[s];
    return m && Object.values(m.horizons || {}).some((h) => h?.publishable);
  })
  ?? Object.entries(makerIdx).find(([, m]) => Object.values(m.horizons || {}).some((h) => h?.publishable))?.[0]
  ?? null;
const DEMO_REF = (refs as { refs?: { key: string; n: number }[] }).refs
  ?.slice().sort((a, b) => b.n - a.n)[0]?.key ?? null;

/* ── THE CURVE: the corpus accumulating, 1989 → today ────────────────────
   Drawn from meta.soldByYear, the same accumulation the OG card plots. The
   hero numeral IS this curve's final value — numeral = line, the product's
   oldest chart law — so the cover's count-up and the stroke drawing itself
   are one statement made twice. */
const CURVE = (() => {
  const sby = ((meta as Record<string, unknown>).soldByYear ?? {}) as Record<string, number>;
  const years = Object.keys(sby).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (years.length < 3) return null;
  const y0 = years[0], y1 = years[years.length - 1];
  const W = 1000, H = 220, PAD = 6;
  let acc = 0;
  const total = years.reduce((t, y) => t + sby[y], 0);
  const ptsArr = years.map((y) => {
    acc += sby[y];
    return { x: ((y - y0) / (y1 - y0)) * W, y: H - PAD - (acc / total) * (H - PAD * 2) };
  });
  const d = ptsArr.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  const last = ptsArr[ptsArr.length - 1];
  const ticks = [1990, 2000, 2010, 2020].filter((y) => y > y0 && y < y1)
    .map((y) => ({ y, x: ((y - y0) / (y1 - y0)) * 100 }));
  return { d, W, H, dotY: (last.y / H) * 100, ticks, y0, y1 };
})();

/* ── THE TAPE: real settled results as connective tissue ─────────────────
   Every chip is a comp row already shipped on this page (proof-cases), so the
   marquee repeats evidence, not decoration — the same lots the calls below
   were argued from. aria-hidden: it duplicates content that appears, fully
   readable, in the comp disclosures. */
const TAPE = (() => {
  // round-robin across the cases so the tape alternates markets — read
  // case-by-case it ran three of the same jersey in a row
  const perCase = proof.cases.map((c) =>
    ((c as { compRows?: { title: string; house: string; priceUsd: number }[] }).compRows ?? [])
      .filter((r) => r.priceUsd > 0)
      .map((r) => ({ t: craftTitle(r.title), h: r.house, p: r.priceUsd })),
  );
  const rows: { t: string; h: string; p: number }[] = [];
  const depth = Math.max(0, ...perCase.map((a) => a.length));
  for (let i = 0; i < depth; i++) for (const a of perCase) { if (a[i]) rows.push(a[i]); }
  const seen = new Set<string>();
  return rows
    .filter((r) => { const k = `${r.t}|${r.p}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((r) => ({ ...r, t: r.t.length > 44 ? `${r.t.slice(0, 42)}…` : r.t }))
    .slice(0, 32);
})();

const CHAPTERS = [
  ['1', 'Corpus'], ['2', 'Engine'], ['3', 'Record'], ['4', 'Proof'],
  ['5', 'Restraint'], ['6', 'Graph'], ['7', 'Stakes'],
] as const;

/* ── presentation primitives ─────────────────────────────────────────────── */

function Stat({ figure, label, note }: { figure: React.ReactNode; label: string; note?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="dk-stat-fig">{figure}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', marginTop: 9 }}>{label}</div>
      {note && <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 3, lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

/** Ranked bars from a common baseline — the most accurate encoding available,
 *  one ink, sorted descending, square at the baseline with the radius on the
 *  data end only. (The stacked six-step ramp this replaced failed the
 *  categorical palette floor and had no common baseline.) */
function CorpusBars({ bars, total }: { bars: { key: string; label: string; n: number }[]; total: number }) {
  const max = bars[0]?.n || 1;
  return (
    <div className="corpus dk-s">
      {bars.map((b) => (
        <div className="corpus-item" key={b.key}>
          <span className="corpus-label">{b.label}</span>
          <span className="corpus-track">
            <span className="corpus-bar" style={{ width: `${(b.n / max) * 100}%` }} />
          </span>
          <span className="corpus-n">{fmt(b.n)}</span>
          <span className="corpus-pct">{((b.n / total) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

/** ARCHIVE COVERAGE — what each house's record actually spans. The faint
 *  segment is real but thin coverage: Christie's has exactly ONE lot dated
 *  1989 against 1,331 in 1991, and drawing that solid would let a single
 *  record claim a decade. The track is an AXIS, not a bar — only real
 *  coverage gets height. */
function CoverageChart({ rows }: { rows: Cov[] }) {
  const lo = Math.min(...rows.map((r) => r.first));
  const hi = Math.max(...rows.map((r) => r.last));
  const span = Math.max(1, hi - lo);
  const pos = (y: number) => ((y - lo) / span) * 100;
  const decades: number[] = [];
  for (let y = Math.ceil(lo / 10) * 10; y <= hi; y += 10) decades.push(y);
  return (
    <div className="cov dk-s">
      <div className="cov-grid" aria-hidden="true">
        {decades.map((y) => (
          <span className="cov-tick" key={y} style={{ left: `${pos(y)}%` }}><i>{y}</i></span>
        ))}
      </div>
      {rows.map((r) => (
        <div className="cov-row" key={r.house}>
          <span className="cov-house">{r.house.replace(/ /g, ' ')}</span>
          <span className="cov-track">
            {r.dense > r.first && (
              <span className="cov-thin" style={{ left: `${pos(r.first)}%`, width: `${pos(r.dense) - pos(r.first)}%` }} />
            )}
            <span className="cov-solid" style={{ left: `${pos(r.dense)}%`, width: `${Math.max(1.2, pos(r.last) - pos(r.dense))}%` }} />
          </span>
          <span className="cov-from">{r.first}</span>
          <span className="cov-n">{fmt(r.n)}</span>
        </div>
      ))}
    </div>
  );
}

/** THE SHAPE OF THE OUTCOMES — the whole distribution, not just its median,
 *  each arm normalised to its own size (38,734 flagged vs 28,797 controls:
 *  raw counts would draw flagged larger in every bin, including the losing
 *  ones). Control = filled mass, flagged = the butter line — which draws
 *  itself on entry, because the line IS the claim. */
function OutcomeCurve({ dist }: { dist: typeof distribution }) {
  const { bins, summary } = dist;
  const fN = summary.flaggedN, uN = summary.unflaggedN;
  const share = (v: number, n: number) => (v / n) * 100;
  const peak = Math.max(...bins.map((b) => Math.max(share(b.flagged, fN), share(b.unflagged, uN))));
  const top = Math.ceil(peak / 10) * 10;

  const W = 900, H = 300;
  const slot = W / bins.length;
  const y = (v: number) => H - (v / top) * H;

  /* stepped: a histogram is bars, so the outline must be rectilinear — a
     smoothed curve would imply resolution between bins that does not exist */
  const step = (get: (b: typeof bins[number]) => number, close: boolean) => {
    const d: string[] = [];
    bins.forEach((b, i) => {
      const yy = y(get(b));
      d.push(`${i ? 'L' : 'M'} ${i * slot} ${yy}`, `L ${(i + 1) * slot} ${yy}`);
    });
    return close ? `M 0 ${H} L 0 ${y(get(bins[0]))} ${d.slice(1).join(' ')} L ${W} ${H} Z` : d.join(' ');
  };

  const zeroX = 3 * slot;
  const grid = Array.from({ length: top / 10 + 1 }, (_, i) => i * 10);
  const BOUNDS = ['−50%', '−25%', 'mid', '+25%', '+50%', '+100%', '+200%', '+500%'];

  return (
    <figure className="dist">
      <div className="dist-legend">
        <span className="dist-key dist-key-u"><i />Unflagged control<b>{summary.unflaggedBelowPct.toFixed(1)}% below estimate</b></span>
        <span className="dist-key dist-key-f"><i />Flagged by lectr<b>{summary.flaggedBelowPct.toFixed(1)}% below estimate</b></span>
      </div>

      <div className="dist-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="dist-svg" role="img"
             aria-label={`Outcome distribution. Flagged lots: ${summary.flaggedBelowPct.toFixed(1)}% sold below the estimate mid, median +${summary.flaggedMedianPct}%. Unflagged controls: ${summary.unflaggedBelowPct.toFixed(1)}% below, median +${summary.unflaggedMedianPct}%.`}>
          <rect x="0" y="0" width={zeroX} height={H} className="dist-below" />
          {grid.map((g) => <line key={g} x1="0" y1={y(g)} x2={W} y2={y(g)} className="dist-grid" />)}
          <path d={step((b) => share(b.unflagged, uN), true)} className="dist-area-u" />
          <path d={step((b) => share(b.flagged, fN), false)} className="dist-line-f dk-draw" data-draw-dur="1900" />
          <line x1={zeroX} y1="0" x2={zeroX} y2={H} className="dist-zero" />
        </svg>
        {/* Axis labels live in HTML, not SVG: this viewBox is stretched to the
            rail, so SVG text would render ~18px on desktop and ~7px on a phone. */}
        <div className="dist-ylab" aria-hidden>
          {grid.slice(1).reverse().map((g) => (
            <span key={g} style={{ top: `${(y(g) / H) * 100}%` }}>{g}%</span>
          ))}
        </div>
        <div className="dist-xlab" aria-hidden>
          {BOUNDS.map((lab, i) => (
            <span key={lab} className={lab === 'mid' ? 'dist-xlab-zero' : ''}
                  style={{ left: `${((i + 1) / bins.length) * 100}%` }}>{lab}</span>
          ))}
        </div>
      </div>

      <div className="dist-foot" aria-hidden>
        <span className="dist-foot-u">under the estimate</span>
        <span className="dist-foot-o">over it</span>
      </div>
      <figcaption className="dist-cap">
        Where every replayed lot landed against its estimate, as a share of its own arm — the two
        arms differ in size, so raw counts would draw flagged larger in every bin including the
        losing ones. Flagged sits further right, and is below the estimate <b>less</b> often than the
        control: the edge is not bought by taking more risk.
      </figcaption>
    </figure>
  );
}

/** PERSISTENCE — the edge, year by year, from the shipped 27-year replay.
 *  The gap is the subject, so the band between the lines is shaded; both
 *  lines draw on entry, control first, flagged over it. */
function RecordYears({ series }: { series: SeriesRow[] }) {
  const rows = series.filter((r) => Number.isFinite(r.flaggedMedianPct) && Number.isFinite(r.unflaggedMedianPct));
  if (rows.length < 4) return null;
  const W = 900, H = 230;
  const hiRaw = Math.max(...rows.map((r) => Math.max(r.flaggedMedianPct, r.unflaggedMedianPct)));
  const loRaw = Math.min(0, ...rows.map((r) => Math.min(r.flaggedMedianPct, r.unflaggedMedianPct)));
  const hi = Math.ceil(hiRaw / 20) * 20, lo = Math.floor(loRaw / 20) * 20;
  const x = (i: number) => (i / (rows.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (get: (r: typeof rows[number]) => number) =>
    rows.map((r, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(get(r)).toFixed(1)}`).join(' ');
  const band = `${line((r) => r.flaggedMedianPct)} ` +
    rows.slice().reverse().map((r, j) => `L ${x(rows.length - 1 - j).toFixed(1)} ${y(r.unflaggedMedianPct).toFixed(1)}`).join(' ') + ' Z';
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 20) ticks.push(v);
  const years = rows.map((r) => r.year).filter((yr) => yr % 5 === 0);

  return (
    <figure className="yrs">
      <div className="dist-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="dist-svg" role="img"
             aria-label={`Median result versus estimate by sale year, ${rows[0].year} to ${rows[rows.length - 1].year}. The flagged line sits above the unflagged control in every year.`}>
          {ticks.map((t) => (
            <line key={t} x1="0" y1={y(t)} x2={W} y2={y(t)} className={t === 0 ? 'dist-zero-h' : 'dist-grid'} />
          ))}
          <path d={band} className="yrs-band" />
          <path d={line((r) => r.unflaggedMedianPct)} className="yrs-line yrs-line-u dk-draw" data-draw-dur="1400" />
          <path d={line((r) => r.flaggedMedianPct)} className="yrs-line yrs-line-f dk-draw" data-draw-dur="1700" data-draw-delay="250" />
        </svg>
        <div className="dist-ylab" aria-hidden>
          {ticks.slice().reverse().map((t) => (
            <span key={t} style={{ top: `${(y(t) / H) * 100}%` }}>{t > 0 ? `+${t}` : t}%</span>
          ))}
        </div>
        <div className="dist-xlab" aria-hidden>
          {years.map((yr) => (
            <span key={yr} style={{ left: `${(rows.findIndex((r) => r.year === yr) / (rows.length - 1)) * 100}%` }}>{yr}</span>
          ))}
        </div>
      </div>
      <figcaption className="dist-cap">
        Median result against estimate by sale year, {rows[0].year}&ndash;{rows[rows.length - 1].year}. The flagged
        line clears the control in <b>every one of the {rows.length} years</b> on record, through two
        crashes and a boom — the edge is not an artifact of one regime.
      </figcaption>
    </figure>
  );
}

interface CompRow { title: string; house: string; saleDate: string; priceUsd: number; url: string | null }

/** The comps behind one call, as a disclosure. A native <details> rather than
 *  a modal: server component, static export, no client JS needed, and it
 *  stays keyboard- and screen-reader-addressable. The rows are SHIPPED
 *  (scripts/_qa/gen-proof-comps.ts), not linked to /lot?id= — settled lots
 *  carry no `value` stamp, so the lot page would gate to "no comparables"
 *  under a card claiming the opposite. */
function CompTable({ comps, pool, label }: { comps: CompRow[]; pool: number; label: string }) {
  if (!comps.length) return null;
  return (
    <details className="comp-disc">
      <summary>
        <span>{label}{comps.length < pool ? ` · ${comps.length} shown` : ''}</span>
        <span className="comp-caret" aria-hidden>+</span>
      </summary>
      <div className="comp-wrap">
        <table className="comp-table">
          <thead><tr><th>Sold</th><th>Lot</th><th className="comp-num">Price</th></tr></thead>
          <tbody>
            {comps.map((r, i) => (
              <tr key={i}>
                <td className="comp-date">{String(r.saleDate).slice(0, 10)}</td>
                <td className="comp-lot">
                  {r.url
                    ? <a href={r.url} target="_blank" rel="noopener noreferrer">{craftTitle(r.title)}</a>
                    : <span>{craftTitle(r.title)}</span>}
                  <i>{r.house}</i>
                </td>
                <td className="comp-num">${fmt(r.priceUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="comp-note">
          The pool this lot was priced against, most recent first — every one settled <b>before</b> it
          sold. The value is a recency-weighted median over the full {pool}, not over the{' '}
          {comps.length} shown.
        </p>
      </div>
    </details>
  );
}

function ProofCase({ c }: { c: typeof proof.cases[number] }) {
  const paidW = Math.max(6, Math.round((c.realizedUsd / c.ourValueUsd) * 100));
  const noEstimate = c.houseEstLow == null;
  const title = craftTitle(c.title);
  const img = c.imageUrl ? sizedImg(httpsImg(c.imageUrl), 960) : null;
  const comps = ((c as { compRows?: CompRow[] }).compRows ?? []);
  return (
    <div className="proof-card">
      {/* The object first. A price argument about a physical thing should show
          the thing. PlateImg unmounts on a dead hotlink so the monogram behind
          it shows rather than an empty well. */}
      <div className="proof-shot" aria-hidden>
        <span className="proof-mono">{(title || '?').charAt(0)}</span>
        {img && <PlateImg src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </div>

      <div className="proof-body">
        <div className="proof-meta kicker">
          <span>{c.market} · {c.house} · {String(c.saleDate).slice(0, 10)}</span>
          {/* Always render the tier, never only the flattering one — the hedge
              is the point §05 makes. */}
          <span className={`proof-conf${c.confidence === 'high' ? '' : ' proof-conf-mid'}`}>{c.confidence} confidence</span>
        </div>
        <div className="proof-title">{title.length > 76 ? title.slice(0, 74) + '…' : title}</div>

        <div className="proof-figs">
          <span className="proof-fig">
            <span className="proof-fig-k kicker">sold for</span>
            <span className="proof-fig-v">${fmt(c.realizedUsd)}</span>
          </span>
          <span className="proof-fig proof-fig-ref">
            <span className="proof-fig-k kicker">lectr value</span>
            <span className="proof-fig-v">${fmt(c.ourValueUsd)}</span>
          </span>
        </div>
        <div className="proof-bullet" aria-hidden>
          <span className="proof-bullet-paid" style={{ width: `${paidW}%` }} />
          <span className="proof-bullet-ref" />
        </div>

        <div className="proof-foot">
          <span className="proof-gap">{Math.abs(c.discountPct)}% under</span>
          <CompTable comps={comps} pool={c.comps} label={`from ${c.comps} comparable sales`} />
          <span>
            {noEstimate
              ? 'The house published no estimate — ours was the only valuation.'
              : `House est $${fmt(c.houseEstLow as number)}–$${fmt(c.houseEstHigh as number)}.`}
          </span>
        </div>
      </div>
    </div>
  );
}

/** TONIGHT'S BOOK — the one live moment in an otherwise retrospective deck:
 *  the same engine pointed at lots that have not sold yet, where the ratio is
 *  the story — §05's restraint stated as tonight's number. */
function LiveBand({ book }: { book: LiveBook }) {
  const share = (book.called / book.total) * 100;
  // the book is read at BUILD time (live.ts) — "tonight" is the edition the
  // page was built from, so its date prints in the legend (the kicker above
  // the headline is a retired eyebrow: .dk-kick is display:none)
  const asOf = book.generatedAt && !isNaN(Date.parse(book.generatedAt))
    ? new Date(book.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  return (
    <section className="deck-live">
      <div className="rail dk-s">
        <span className="kicker dk-kick">Tonight&rsquo;s book</span>
        <h2 className="deck-h">
          <b data-count>{fmt(book.total)}</b> lots are on the book. lectr has something to say
          about <b data-count>{String(book.called)}</b>.
        </h2>

        <div className="live-ratio" aria-hidden="true">
          {/* the called slice is a hairline against the full book on purpose —
              at 0.5% any "readable minimum" width would be a lie about the ratio */}
          <span className="live-called" style={{ width: `${Math.max(share, 0.35)}%` }} />
        </div>
        <div className="live-legend">
          <span><b>{fmt(book.total - book.called)}</b> no call — the comparable pool doesn&rsquo;t clear the bar</span>
          <span className="live-legend-on"><b>{book.called}</b> called &middot; {share.toFixed(1)}% of the book{asOf && <> &middot; as of {asOf}</>}</span>
        </div>

        <div className="live-split">
          <div className="live-cell">
            <span className="live-n" data-count>{String(book.below)}</span>
            <span className="live-k">trading below where comparables clear</span>
          </div>
          <div className="live-cell">
            <span className="live-n" data-count>{String(book.above)}</span>
            <span className="live-k">trading above it</span>
          </div>
          <div className="live-cell">
            <span className="live-n" data-count>{String(book.high)}</span>
            <span className="live-k">at the high-confidence tier</span>
          </div>
        </div>

        <p style={caption}>
          Both directions are published: a lot trading above where its comparables clear is as much
          of a call as one trading below.
        </p>
      </div>
    </section>
  );
}

/** A lot at full width. The product is about objects; the deck should stop and
 *  look at one. */
function HeroLot({ c }: { c: typeof proof.cases[number] }) {
  const img = c.imageUrl ? sizedImg(httpsImg(c.imageUrl), 1280) : null;
  const comps = ((c as { compRows?: CompRow[] }).compRows ?? []);
  if (!img) return null;
  return (
    <section className="deck-hero">
      <div className="rail dk-s">
        <div className="hero-plate">
          <PlateImg src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </div>
        <p className="hero-cap">
          <b>{craftTitle(c.title)}</b> · {c.house} · {String(c.saleDate).slice(0, 10)} — lectr priced it at{' '}
          <b>${fmt(c.ourValueUsd)}</b> from {c.comps} comparable sales. It sold for{' '}
          <b className="hero-cap-paid">${fmt(c.realizedUsd)}</b>.
        </p>
        <div className="comp-disc-hero">
          <CompTable comps={comps} pool={c.comps} label={`The ${c.comps} sales it was priced against`} />
        </div>
      </div>
    </section>
  );
}

function Sec({ ord, label, title, lede, children }: {
  ord: string; label: string; title: React.ReactNode;
  /** north-star split head: the chapter's opening copy rides the right
      column beside the light headline (stacks under 900px) */
  lede?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="deck-slide" id={`ch-${ord}`} data-ch={ord}>
      <div className="rail dk-s" style={{ position: 'relative' }}>
        <span className="kicker dk-kick">{label}</span>
        {lede != null ? (
          <div className="ns-split">
            <h2 className="deck-h">{title}</h2>
            <p>{lede}</p>
          </div>
        ) : (
          <h2 className="deck-h">{title}</h2>
        )}
        {children}
      </div>
    </section>
  );
}

/** A step in the pricing chain. Numbered, not arrowed — the flow reads down.
 *  The seam above each step draws itself as the block reveals. */
function Step({ n, title, body }: { n: string; title: string; body: React.ReactNode }) {
  return (
    <div className="method-step">
      <div className="method-n">{n}</div>
      <div className="method-t">{title}</div>
      <div className="method-b">{body}</div>
    </div>
  );
}

export default function AboutPage() {
  // Build-time read (server component, output:'export') — see app/about/live.ts
  // for why this is fs and not a JSON import.
  const liveBook = readLiveBook();
  const serial = String(meta.lastCrawl).slice(0, 10).replace(/-/g, '');
  return (
    <div className="deck-scope terminal-shell" style={{ minHeight: '100vh', background: 'var(--color-bg-deep, var(--color-bg))', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      {/* The proof lots hotlink four house CDNs; they stay lazy (the LCP is the
          cover headline) but DNS resolves off the scroll path. */}
      <link rel="preconnect" href="https://sothebys-com.brightspotcdn.com" crossOrigin="" />
      <link rel="dns-prefetch" href="https://images2.bonhams.com" />
      <link rel="dns-prefetch" href="https://d2tt46f3mh26nl.cloudfront.net" />
      <link rel="dns-prefetch" href="https://www.wright20.com" />
      <style dangerouslySetInnerHTML={{ __html: DECK_CSS }} />
      <ArtistNav activeSlug="about" />
      <DeckFx />

      {/* reading progress — the deck's one fixed instrument besides the rail */}
      <span className="dk-prog" aria-hidden />

      {/* chapter rail: which slide owns the viewport */}
      <nav className="dk-rail" aria-label="Chapters">
        {CHAPTERS.map(([ord, lb]) => (
          <a key={ord} href={`#ch-${ord}`} data-for={ord}>
            <i /><span className="dk-rail-lb">{lb}</span>
          </a>
        ))}
      </nav>

      <div style={{ paddingBottom: 56 }}>
        {/* ── COVER — the brand gets the opening slide ─────────────────── */}
        <header className="dk-cover" data-ch="00">
          <div className="rail dk-cover-rail">
            <div className="dk-kickrow">
              {/* the quiet kicker voice (north star); the dated serial keeps
                  the mono instrument register — a data label, not an eyebrow */}
              <span className="ns-kicker" style={{ marginBottom: 0 }}>What is lectr</span>
              <span className="kicker dk-serial">No. {serial}</span>
            </div>
            {/* the hand-drawn mark, writing itself on — the loader's wipe, once */}
            <img className="dk-mark" src="/brand/lectr.png" alt="lectr" />
            <h1 className="dk-h1">
              Every lot arrives with a guess.{' '}
              <span className="dk-h1-line2">We score it against{' '}
                <span className="dk-u"><b data-count>{fmt(meta.totalSold)}</b> results</span>.
              </span>
            </h1>
            <p className="dk-sub">
              lectr is the intelligence desk for the auction market. It has read every settled lot
              across <b>{meta.sources.length} houses</b>, and prices what comes next against the
              sales that resemble it.
            </p>
            <div className="dk-cover-cta">
              <Link href="/value" className="close-cta">See tonight&rsquo;s calls <Flick size={12} /></Link>
              <a href="#ch-01" className="close-alt">How it works</a>
            </div>
            <p className="dk-free">Public and free. No account needed.</p>
            <div className="dk-statband dk-s">
              <Stat figure={<span data-count>{fmt(meta.totalLots)}</span>} label="Lots under tracking" note="live and settled, one graph" />
              <Stat figure={<span data-count>{String(meta.sources.length)}</span>} label="Auction houses" note="named, with their coverage, below" />
              <Stat figure={<span data-count>{fmt(F.n)}</span>} label="Replayed calls" note="scored against what happened next" />
            </div>
          </div>

          {/* the corpus accumulating, 1989 → today. The headline numeral is
              this curve's final value — numeral = line, made once as a count
              and once as a stroke. */}
          {CURVE && (
            <div className="dk-curve" aria-hidden>
              <div className="dk-curve-plot">
                <svg viewBox={`0 0 ${CURVE.W} ${CURVE.H}`} preserveAspectRatio="none">
                  <path d={CURVE.d} className="dk-curve-line dk-draw" data-draw-dur="2800" data-draw-delay="500" />
                </svg>
                <span className="dk-curve-dot" style={{ top: `${CURVE.dotY}%` }} />
              </div>
              <div className="dk-curve-ticks">
                {CURVE.ticks.map((t) => (
                  <span key={t.y} style={{ left: `${t.x}%` }}>{t.y}</span>
                ))}
              </div>
              <span className="dk-curve-cap">settled results, accumulated {CURVE.y0} → {CURVE.y1}</span>
            </div>
          )}
        </header>

        {/* ── THE TAPE — evidence as connective tissue ─────────────────── */}
        {TAPE.length > 8 && (
          <div className="dk-tape" aria-hidden>
            <div className="dk-tape-track">
              {[0, 1].map((dup) => TAPE.map((r, i) => (
                <span className="dk-chip" key={`${dup}-${i}`}>
                  <i>{r.t}</i>
                  <em>{r.h}</em>
                  <b>${fmt(r.p)}</b>
                  <Flick size={9} style={{ opacity: 0.35, marginLeft: 18, marginRight: 18 }} />
                </span>
              )))}
            </div>
          </div>
        )}

        {/* "It took 35 years to build" overclaimed — lectr didn't spend the
            years, the record spans them. Same swagger, honest verb. */}
        <Sec ord="1" label="The corpus" title={<>Depth is the moat. {ARCHIVE_YEARS} years of results, one schema.</>}
          lede={<>
            Comparable-sales pricing is only as good as the pool behind it, and auction results are
            scattered across houses that publish in different shapes, purge lots when a sale closes,
            and rarely keep a machine-readable archive. lectr holds all of it in one schema — every
            lot normalised to a dated FX rate, a declared price basis, and a structured identity, so
            a 1994 Geneva watch sale and a lot closing tonight are the same kind of object.
          </>}>
          <CoverageChart rows={COVERAGE} />
          <div className="cov-split">
            <CorpusBars bars={CORPUS_BARS} total={CORPUS_BARS.reduce((t, b) => t + b.n, 0)} />
          </div>
          <p style={caption}>
            Settled records per house by sale year, then by market. The faint segment is coverage
            that exists but is thin — Christie&rsquo;s has a single lot dated 1989 against 1,331 in
            1991 — so early depth is shown as early depth, not rounded up. Nothing here is licensed:
            every row was crawled, normalised and reconciled lot by lot.{' '}
            <Link href="/blog/q2-2026-science" className="deck-more">What that reconciliation looks like <Flick size={11} /></Link>
          </p>
        </Sec>

        <Sec ord="2" label="The value engine" title={<>What a lot is worth, argued from the sales that resemble it.</>}
          lede={<>
            The engine does not forecast taste. It answers a narrower question with evidence: given
            everything that has actually sold, where should this lot clear — and does the house&rsquo;s
            estimate agree?
          </>}>
          <div className="dk-s" style={{ margin: '20px 0 0' }}>
            <Step n="1" title="Resolve the object"
              body={<>Every lot is parsed into a structured identity — maker, form, model line, reference, edition, dimensions, year, materials — not just a title string. Two lots match on what they <em>are</em>, never on how a cataloguer chose to describe them.</>} />
            <Step n="2" title="Build the comparable pool"
              body={<>Candidates are scored on title similarity <em>and</em> structural agreement, then put through hard gates: a sofa never comps a chair, a Daytona never comps a Datejust. Pools that don&rsquo;t clear the bar are discarded rather than loosened.</>} />
            <Step n="3" title="Price it, with dispersion"
              body={<>A recency-weighted median over the surviving pool, with a dispersion guard that widens or withdraws the read when comparable sales disagree with each other.</>} />
            <Step n="4" title="Call the direction, and rate the confidence"
              body={<>The output is a directional read — trading below or above where comparables clear — carried with a confidence tier calibrated against{calN ? <> {fmt(calN)} scored observations</> : ' the replay'}, and a band showing how tightly reads at that tier have historically landed.</>} />
          </div>
          <p style={caption}>
            Validated by temporal holdout: every call is made using only sales dated strictly before
            the lot in question, so the record below is what the engine would have said at the time —
            not what it can explain in hindsight.{' '}
            <Link href="/blog/how-we-built-the-pricing-engine" className="deck-more">The method in full <Flick size={11} /></Link>
          </p>
        </Sec>

        <Sec ord="3" label="The record" title={<>The whole thesis, replayed against history.</>}
          lede={<>
            {fmt(F.n)} flagged calls and {fmt(U.n)} unflagged controls, each scored on what the lot
            actually did next. Two bases are published side by side, because they answer different
            questions: <b style={{ color: 'var(--color-fg)' }}>all-in</b> is what a buyer paid,
            including the house&rsquo;s premium; <b style={{ color: 'var(--color-fg)' }}>at hammer</b> strips
            the premium out for a like-for-like comparison against an estimate that never included it.
          </>}>
          <OutcomeCurve dist={DIST} />

          {SERIES.length >= 4 && <RecordYears series={SERIES} />}

          <table className="rec-table">
            <caption className="sr-only">The record: unflagged control versus lectr-flagged, same replay, same period.</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="rec-num">Control</th>
                <th scope="col" className="rec-num">Flagged</th>
                <th scope="col" className="rec-num">Edge</th>
              </tr>
            </thead>
            <tbody className="dk-s">
              {RECORD_ROWS.map((r) => (
                <tr key={r.k}>
                  <th scope="row">
                    {r.k}
                    <i>{r.note}</i>
                  </th>
                  <td className="rec-num rec-ctrl">{r.fmt(r.lo)}</td>
                  <td className="rec-num rec-flag">{r.fmt(r.hi)}</td>
                  <td className="rec-num rec-edge">{r.edge}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={caption}>
            Bought-in lots are scored as outcomes rather than dropped, so a flag on something that
            then failed to sell counts against the record. <Link href="/receipts" className="deck-more">See the full record <Flick size={11} /></Link>
          </p>
        </Sec>

        {/* ── STATEMENT — the deck inhales: one number, full frame ──────── */}
        <section className="deck-statement">
          <div className="rail dk-s">
            <div className="statement-fig">+<span data-count>{String(edgeAllIn)}</span><span className="statement-unit">points</span></div>
            <p className="statement-lede">
              is what separates a lot lectr flagged from one it didn&rsquo;t, replayed against every
              sale that came after.
            </p>
            <p className="statement-foot">
              Flagged lots also failed to sell less often than unflagged ones. The edge is not bought
              with risk.
            </p>
          </div>
        </section>

        <Sec ord="4" label="The proof" title={<>We said what it was worth. The room paid less.</>}
          lede={<>
            The record above is an aggregate. This is what it looks like as individual lots: the
            engine priced each object from comparable sold evidence, and the hammer came in under
            that number. Two of the six below carried <b style={{ color: 'var(--color-fg)' }}>no house
            estimate at all</b> — lectr&rsquo;s figure was the only valuation in existence when the
            hammer fell.
          </>}>
          <div className="proof-grid dk-s">
            {proof.cases.filter((c) => !(c as { hero?: boolean }).hero).map((c) => <ProofCase key={c.id} c={c} />)}
          </div>
          <p style={caption}>
            <b style={{ color: 'var(--color-text-muted)' }}>How these were chosen.</b> Of {fmt(PROV.targets)} lots sold
            since 2024 above a $3,000 estimate, the engine priced {fmt(PROV.priced)} from at least eight
            comparable sold lots at non-low confidence — and {fmt(PROV.hits)} of those cleared 30% or more below
            the number. That sweep is exhaustive, not a sample; four of the six above are drawn from it,
            as is the lot below.
          </p>
          <p style={caption}>
            The no-estimate pair come from Goldin and Sotheby&rsquo;s NBA auctions, which publish none.
            That population has not been swept exhaustively, so no rate is claimed for it.
          </p>
        </Sec>

        <HeroLot c={proof.cases.find((x) => (x as { hero?: boolean }).hero) ?? proof.cases[0]} />

        <Sec ord="5" label="Restraint" title={<>The number we are proudest of is how often it says nothing.</>}
          lede={<>
            lectr runs an explicit ladder: a confidence-interval
            index where the data resolves the sign, a measured demand read where coverage allows, and
            below that, no movement number at all.
          </>}>
          <div className="dk-s" style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 20px', margin: '24px 0 0', paddingTop: 22, borderTop: '1px solid var(--hairline)' }}>
            <Stat figure={<><span data-count>{String(makerPublish)}</span> of <span data-count>{String(makerTotal)}</span></>}
              label="Makers clear the 95% bar" note="the rest publish no index — the interval doesn't resolve the sign" />
            <Stat figure={<><span data-count>{String(drillAbstain)}</span> of <span data-count>{String(drillCount)}</span></>}
              label="Sub-markets abstain" note="tracked and searchable, but carrying no movement claim" />
          </div>
          <p style={caption}>
            Every published figure names its
            method and its sample size — and when one drifts, it is restated in public rather than
            quietly patched.{' '}
            <Link href="/blog/corrections" className="deck-more">The corrections register <Flick size={11} /></Link>
          </p>

          <div className="scope-note">
            <span className="kicker" style={{ display: 'block', margin: '0 0 10px' }}>What this does not cover</span>
            <p style={{ ...caption, margin: 0 }}>
              lectr reads <b style={{ color: 'var(--color-text-muted)' }}>auction results only</b> — public sales with a
              published price, at the {meta.sources.length} houses named above. Private treaty, dealer
              inventory, fixed-price and buy-now listings are deliberately out: a price nobody bid
              against is not a comparable, and mixing them in would quietly inflate every figure on
              this page. Fairs, regional and online-only houses are not yet read, so a maker whose
              market lives largely outside these rooms will show thinner coverage here than it has in
              the world. Where that is true, the engine abstains rather than extrapolating.
            </p>
          </div>
        </Sec>

        <Sec ord="6" label="The graph" title={<>One lot, linked to everything that explains it.</>}
          lede={<>
            A price is not an answer on its own. Every lot resolves into a chain you can walk — and
            every step of it is a page, not a footnote. The links below open real ones.
          </>}>
          {/* Each node links to a LIVE example — the graph as a tour, not a
              diagram. Targets are derived (DEMO_MAKER must actually publish;
              DEMO_REF is tonight's deepest dossier) so a link can never demo
              a claim the data no longer makes. */}
          <ol className="chain dk-s">
            <li className="chain-node">
              <Link className="chain-k" href="/value">The lot</Link>
              <span className="chain-v">what it was expected to make, what it made, and the call that preceded it</span>
            </li>
            <li className="chain-node">
              <a className="chain-k" href="#ch-04">Its comparables</a>
              <span className="chain-v">the exact settled sales the call was argued from, each one clickable</span>
            </li>
            <li className="chain-node">
              <Link className="chain-k" href="/analytics">Its sub-market</Link>
              <span className="chain-v">cards by era and sport, watch families, art kinds, design materials</span>
            </li>
            <li className="chain-node">
              {/* plain <a>, not Link: artist routes ship no RSC .txt payload,
                  so Link's viewport prefetch 404s in the console sitewide */}
              <a className="chain-k" href={DEMO_MAKER ? `/${DEMO_MAKER}` : '/makers'}>Its maker</a>
              <span className="chain-v">a quality-controlled index, published only where the interval resolves</span>
            </li>
            <li className="chain-node">
              <Link className="chain-k" href={DEMO_REF ? `/ref?id=${DEMO_REF}` : '/analytics'}>Its reference</Link>
              <span className="chain-v">one of {fmt(refCount)} dossiers, each with the full yearly series for that model line</span>
            </li>
          </ol>

          <p style={p}>
            Tracked lots keep permanent addresses. A lot the house purges the moment its sale ends
            stays resolvable here — with its estimate, its result, and the call that preceded it —
            which is what makes the archive usable as evidence rather than nostalgia.
          </p>
        </Sec>

        <Sec ord="7" label="What it changes" title={<>For the person holding the paddle.</>}
          lede={<>
            A price is only useful if it changes what someone does. Four people ask the same question
            — what does this actually clear at, and how sure can you be — and get four different days
            out of the answer.
          </>}>
          <div className="value-list dk-s">
            {[
              {
                who: 'The specialist',
                job: 'setting a reserve',
                before: 'memory, three catalogues, and a feel for the room',
                after: 'the comparable sales on the page — dated, with their spread — before the consignment conversation',
              },
              {
                who: 'The collector',
                job: 'deciding what to bid',
                before: 'the estimate, the atmosphere, and how badly you want it',
                after: 'where comparable examples actually cleared, which is the difference between conviction and nerve',
              },
              {
                who: 'The lender or insurer',
                job: 'marking a book',
                before: 'a valuation letter that cannot be re-derived',
                after: 'a number defensible line by line — method named, sample size shown, and an abstention where the data will not carry a figure',
              },
              {
                who: 'The seller',
                job: 'choosing where to consign',
                before: 'whichever house asked first',
                after: 'what the object is worth before someone else says, and which house has historically cleared that kind of lot highest',
              },
            ].map((r) => (
              <div className="value-row" key={r.who}>
                <div className="value-head">
                  <span className="value-who">{r.who}</span>
                  <span className="value-job">{r.job}</span>
                </div>
                <div className="value-swap">
                  <span className="value-before"><i>today</i>{r.before}</span>
                  <span className="value-after"><i>with lectr</i>{r.after}</span>
                </div>
              </div>
            ))}
          </div>
        </Sec>

        {liveBook && <LiveBand book={liveBook} />}

        <section className="deck-close">
          <div className="rail dk-s">
            <p className="close-line">
              Stop bidding against a guess.
            </p>
            <p className="close-sub">
              The whole market read is public and free to inspect. Nothing on this page is a
              projection — it is what {fmt(meta.totalSold)} settled results already say.
            </p>
            <div className="close-actions">
              <Link href="/value" className="close-cta">See today&rsquo;s calls <Flick size={12} /></Link>
              <Link href="/analytics" className="close-alt">Open the research desk</Link>
              <Link href="/blog" className="close-alt">Read the notes</Link>
            </div>
            <p style={{ ...caption, marginTop: 26 }}>
              Figures on this page are read from the live corpus at build time, dated{' '}
              {String(meta.lastCrawl).slice(0, 10)}. They change when the market does. Each quarter is
              written up market by market —{' '}
              <Link href="/blog/q2-2026-watches" className="deck-more">watches</Link>,{' '}
              <Link href="/blog/q2-2026-art" className="deck-more">art</Link>,{' '}
              <Link href="/blog/q2-2026-design" className="deck-more">design</Link>,{' '}
              <Link href="/blog/q2-2026-sports" className="deck-more">sports</Link>{' '}and{' '}
              <Link href="/blog/q2-2026-science" className="deck-more">science</Link>.
            </p>
          </div>
        </section>
      </div>

      <Colophon record={F.n > 500 ? { n: F.n, medianPerfPct: F.medianPerfPct } : null} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   THE DECK'S CSS. One block, dangerouslySetInnerHTML (raw-text style children
   break hydration in this repo). Motion grammar throughout is the brand's
   own: clip-path write-on, pen-draw scaleX seams, measured-stroke draws,
   --ease-signature reveals. Everything that moves is gated three ways —
   prefers-reduced-motion, the .dk-anim class DeckFx arms (no JS → no hiding),
   and server-rendered final values.
   ══════════════════════════════════════════════════════════════════════════ */
const DECK_CSS = `
  /* ── deck scale ─────────────────────────────────────────────────── */
  .deck-scope {
    --d-cover: clamp(38px, 6.6vw, 88px);      /* the opening statement */
    --d-figure: clamp(88px, 15vw, 188px);     /* the one-number slide */
    --d-close: clamp(32px, 5.6vw, 64px);      /* closing line */
    --d-h: clamp(29px, 4vw, 54px);            /* chapter headings */
    --d-figure-md: clamp(28px, 3.6vw, 46px);
    --d-figure-sm: clamp(24px, 2.4vw, 30px);
    --d-lead: clamp(16px, 1.5vw, 19px);
    --d-lead-lg: clamp(17px, 1.9vw, 24px);
    --d-body: var(--text-body);
    --d-ui: var(--text-ui);
    --d-cap: var(--text-caption);
    --d-label: var(--text-label);
    --measure: 60ch;
  }
  .deck-scope p, .deck-scope .hero-cap, .deck-scope .method-b,
  .deck-scope .value-what { max-width: var(--measure); }

  /* ── the reveal grammar: hidden ONLY once DeckFx arms .dk-anim ─────
     (no JS, no hiding — the whole deck reads as plain document) */
  @media (prefers-reduced-motion: no-preference) {
    .dk-anim .dk-s > * {
      opacity: 0; transform: translateY(18px);
      transition: opacity .75s var(--ease-signature), transform .75s var(--ease-signature);
    }
    .dk-anim .dk-s.on > * { opacity: 1; transform: none; }

    /* bars grow along the seam, never fade */
    .dk-anim .dk-s .cov-solid, .dk-anim .dk-s .cov-thin,
    .dk-anim .dk-s .corpus-bar, .dk-anim .dk-s .live-called,
    .dk-anim .dk-s .proof-bullet-paid {
      transform: scaleX(0); transform-origin: left;
      transition: transform 1.15s var(--ease-draw) .25s;
    }
    .dk-anim .dk-s.on .cov-solid, .dk-anim .dk-s.on .cov-thin,
    .dk-anim .dk-s.on .corpus-bar, .dk-anim .dk-s.on .live-called,
    .dk-anim .dk-s.on .proof-bullet-paid { transform: none; }

    /* the method seams pen-draw in */
    .dk-anim .dk-s .method-step::before {
      transform: scaleX(0); transform-origin: left;
      transition: transform .9s var(--ease-draw) .15s;
    }
    .dk-anim .dk-s.on .method-step::before { transform: none; }
  }

  /* ── fixed instruments ──────────────────────────────────────────── */
  .dk-prog {
    position: fixed; top: 0; left: 0; right: 0; height: 2px; z-index: 80;
    background: var(--color-butter);
    transform: scaleX(0); transform-origin: left;
    pointer-events: none;
  }
  .dk-rail { display: none; }
  @media (min-width: 1400px) and (min-height: 560px) {
    .dk-rail {
      position: fixed; left: clamp(14px, 1.6vw, 26px); top: 50%;
      transform: translateY(-50%); z-index: 40;
      display: flex; flex-direction: column; gap: 16px;
    }
    .dk-rail a {
      display: flex; align-items: center; gap: 8px;
      font-family: var(--font-mono), monospace; font-size: 10.5px;
      letter-spacing: .08em; text-decoration: none;
      color: var(--color-text-faint);
      transition: color .35s var(--ease-ui);
      /* full-bleed content (the tape) passes under the fixed rail — the blur
         keeps the label legible while anything crosses, and is invisible over
         the flat ground (a tinted pill read as a slab in the cover's light pool) */
      padding: 3px 8px 3px 0; border-radius: 6px;
      backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    }
    .dk-rail a i { display: block; width: 12px; height: 1px; background: currentColor; transition: width .35s var(--ease-ui); }
    .dk-rail a.act { color: var(--color-butter); }
    .dk-rail a.act i { width: 22px; }
    .dk-rail-lb {
      opacity: 0; transform: translateX(-4px);
      transition: opacity .35s var(--ease-ui), transform .35s var(--ease-ui);
    }
    .dk-rail a:hover .dk-rail-lb, .dk-rail a.act .dk-rail-lb { opacity: 1; transform: none; }
  }

  /* ── cover ──────────────────────────────────────────────────────── */
  .dk-cover {
    position: relative;
    min-height: calc(100svh - 64px);
    display: flex; flex-direction: column; justify-content: center;
    padding: clamp(28px, 4vw, 56px) 0 0;
    overflow: hidden;
  }
  /* one warm pool of light behind the mark — the OG card's radial, in situ */
  .dk-cover::before {
    content: ""; position: absolute; inset: -20% -10% auto;
    height: 90%;
    background: none;
    pointer-events: none;
  }
  .dk-cover-rail { position: relative; }
  .dk-kickrow {
    display: flex; justify-content: space-between; align-items: baseline;
    padding-bottom: 12px; margin-bottom: clamp(22px, 3vw, 40px);
    border-bottom: 1px solid var(--hairline);
  }
  .dk-serial { color: var(--color-text-faint); }
  .dk-mark {
    display: block; width: clamp(150px, 20vw, 240px); height: auto;
    margin: 0 0 clamp(18px, 2.4vw, 30px);
  }
  /* NORTH STAR: the cover statement goes LIGHT — impact through lightness,
     never boldness; the numeral carries one ink step more than its words */
  .dk-h1 {
    font-family: var(--font-sans), sans-serif;
    font-size: var(--d-cover); font-weight: 300;
    letter-spacing: -0.03em; line-height: 1.06;
    color: var(--color-fg);
    margin: 0 0 clamp(18px, 2.2vw, 28px);
    max-width: 15ch; text-wrap: balance;
  }
  .dk-h1-line2 { display: block; }
  .dk-h1 b { font-weight: 450; font-variant-numeric: tabular-nums; }
  .dk-u { position: relative; white-space: nowrap; }
  .dk-u::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0.02em; height: 3px;
    background: var(--color-butter-deep);
  }
  .dk-sub {
    font-size: var(--d-lead); line-height: 1.62;
    color: var(--color-text-secondary); max-width: 58ch; margin: 0;
  }
  .dk-sub b { color: var(--color-fg); font-weight: 600; }
  .dk-cover-cta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: clamp(22px, 2.6vw, 32px); }
  .dk-free { font-size: var(--d-cap); color: var(--color-text-faint); margin: 12px 0 0; }
  .dk-statband {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: clamp(20px, 2.2vw, 30px);
    margin-top: clamp(30px, 4vw, 52px);
    padding-top: clamp(18px, 2.2vw, 26px);
    border-top: 1px solid var(--hairline);
  }
  .dk-stat-fig {
    font-size: clamp(26px, 3vw, 44px); font-weight: 600;
    letter-spacing: -0.035em; color: var(--color-fg); line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  /* cover choreography — pure CSS, runs with or without hydration */
  @media (prefers-reduced-motion: no-preference) {
    .dk-mark { clip-path: inset(0 100% 0 0); animation: dkWrite 1.5s var(--ease-draw) .25s forwards; }
    @keyframes dkWrite { to { clip-path: inset(0 0 0 0); } }
    .dk-u::after { transform: scaleX(0); transform-origin: left; animation: dkUnder .9s var(--ease-draw) 1.7s forwards; }
    @keyframes dkUnder { to { transform: scaleX(1); } }
    .dk-kickrow, .dk-h1, .dk-sub, .dk-cover-cta, .dk-free { animation: dkRise .8s var(--ease-signature) both; }
    .dk-h1 { animation-delay: .12s; }
    .dk-sub { animation-delay: .24s; }
    .dk-cover-cta { animation-delay: .34s; }
    .dk-free { animation-delay: .42s; }
    @keyframes dkRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  }

  /* the accumulation curve, pinned under the cover copy */
  .dk-curve { position: relative; margin-top: clamp(26px, 4vh, 56px); }
  .dk-curve-plot { position: relative; }
  .dk-curve svg { display: block; width: 100%; height: clamp(110px, 17vh, 200px); overflow: visible; }
  .dk-curve-line {
    fill: none; stroke: var(--color-butter); stroke-width: 2.5;
    vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round;
    opacity: .92;
  }
  .dk-curve-dot {
    position: absolute; right: -3px; width: 7px; height: 7px; border-radius: 50%;
    background: var(--color-butter); transform: translateY(-50%);
    /* glow retired — flat identification, north star and house law agree */
  }
  @media (prefers-reduced-motion: no-preference) {
    .dk-curve-dot { opacity: 0; animation: dkDot .5s ease 3.1s forwards; }
    @keyframes dkDot { to { opacity: 1; } }
  }
  .dk-curve-ticks { position: relative; height: 16px; margin-top: 4px; }
  .dk-curve-ticks span {
    position: absolute; transform: translateX(-50%);
    font-family: var(--font-mono), monospace; font-size: var(--d-label);
    color: var(--color-text-faint); letter-spacing: .04em;
  }
  .dk-curve-cap {
    position: absolute; right: 0; top: -18px;
    font-family: var(--font-mono), monospace; font-size: var(--d-label);
    letter-spacing: .08em; text-transform: uppercase;
    color: var(--color-text-faint);
  }
  .dk-curve, .dk-curve-ticks { margin-inline: calc(50% - 50vw); padding-inline: 0; }
  .dk-curve-cap { right: var(--gutter, 24px); }

  /* ── the tape ───────────────────────────────────────────────────── */
  .dk-tape {
    overflow: hidden; padding: 13px 0;
    border-block: 1px solid var(--hairline);
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent);
  }
  .dk-tape-track { display: flex; align-items: center; width: max-content; }
  @media (prefers-reduced-motion: no-preference) {
    .dk-tape-track { animation: dkTape 90s linear infinite; }
    .dk-tape:hover .dk-tape-track { animation-play-state: paused; }
    @keyframes dkTape { to { transform: translateX(-50%); } }
  }
  .dk-chip { display: inline-flex; align-items: baseline; white-space: nowrap; font-size: var(--d-cap); }
  .dk-chip i { font-style: normal; color: var(--color-text-faint); }
  .dk-chip em { font-style: normal; color: var(--color-text-faint); opacity: .7; margin-left: 8px; }
  .dk-chip b { color: var(--color-fg); font-weight: 600; margin-left: 8px; font-variant-numeric: tabular-nums; }

  /* ── slides ─────────────────────────────────────────────────────── */
  .deck-slide { padding: clamp(64px, 8vw, 120px) 0 clamp(20px, 2.6vw, 36px); scroll-margin-top: 76px; }
  .dk-kick { display: none; } /* eyebrow above headline — retired */
  .dk-ord {
    position: absolute; right: var(--gutter, 24px); top: clamp(-30px, -3vw, -14px);
    font-family: var(--font-sans), sans-serif;
    font-size: clamp(110px, 15vw, 230px); line-height: 1; font-weight: 400;
    color: color-mix(in srgb, var(--color-fg) 4.5%, transparent);
    pointer-events: none; user-select: none; z-index: 0;
  }
  /* chapter heads: bigger stays, weight drops — the pen, not the marker */
  .deck-h {
    font-family: var(--font-sans), sans-serif;
    font-size: var(--d-h); font-weight: 330;
    letter-spacing: -0.025em; line-height: 1.1;
    color: var(--color-fg);
    margin: 0 0 16px; max-width: 22ch; text-wrap: balance;
    position: relative; z-index: 1;
  }
  .deck-h b { font-weight: 450; font-variant-numeric: tabular-nums; }
  /* split section head — headline left, the lede right (stacks under 900) */
  .deck-slide .ns-split { margin-bottom: 10px; }
  .deck-slide .ns-split .deck-h { margin-bottom: 0; }

  /* ── statement: the deck inhales ────────────────────────────────── */
  .deck-statement {
    min-height: min(78svh, 760px);
    display: grid; align-content: center;
    padding: clamp(52px, 7vw, 100px) 0;
    border-block: 1px solid var(--hairline);
    margin-block: clamp(24px, 3vw, 44px);
    background:
      none;
  }
  .statement-fig {
    font-size: var(--d-figure); font-weight: 800;
    letter-spacing: -0.05em; line-height: 0.92;
    color: var(--color-butter);
    margin-bottom: clamp(18px, 2.2vw, 30px);
    font-variant-numeric: tabular-nums;
  }
  .statement-unit {
    font-size: clamp(22px, 3vw, 40px); font-weight: 650;
    letter-spacing: -0.02em; margin-left: 0.28em;
    color: var(--color-butter-text);
    vertical-align: baseline;
  }
  .statement-lede {
    font-size: var(--d-lead-lg); line-height: 1.45;
    color: var(--color-fg); max-width: 30ch; margin: 0;
    font-weight: 500; text-wrap: balance;
  }
  .statement-foot {
    font-size: var(--d-cap); line-height: 1.6;
    color: var(--color-text-faint); max-width: 52ch; margin: 18px 0 0;
  }

  /* ── hero lot ───────────────────────────────────────────────────── */
  .deck-hero { margin-block: clamp(28px, 3.4vw, 52px); }
  .hero-plate {
    position: relative;
    height: clamp(230px, 30vw, 430px);
    background: var(--panel-mat, var(--color-bg-elevated));
    overflow: hidden;
    border: 1px solid var(--hairline);
    border-radius: 14px;
  }
  .hero-plate img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: clamp(14px, 2vw, 26px); }
  .hero-cap {
    font-size: var(--d-lead); line-height: 1.55;
    color: var(--color-text-secondary); margin: 20px 0 0; max-width: 62ch;
  }
  .hero-cap b { color: var(--color-fg); font-weight: 600; }
  .hero-cap-paid { color: var(--color-fg); }

  /* ── method steps ───────────────────────────────────────────────── */
  .method-step {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr);
    gap: 5px 16px;
    padding: clamp(13px, 1.4vw, 16px) 0;
    position: relative;
  }
  .method-step::before {
    /* the spec-ledger seam — dotted, the invoice grammar */
    content: ""; position: absolute; top: 0; left: 0; right: 0; height: 0;
    border-top: 1px dotted var(--color-border-mid);
  }
  .method-n {
    grid-row: 1; font-size: var(--d-cap); font-weight: 700;
    color: var(--color-butter-deep); font-variant-numeric: tabular-nums; padding-top: 3px;
    font-family: var(--font-mono), monospace;
  }
  .method-t { font-size: var(--d-ui); font-weight: 650; color: var(--color-fg); }
  .method-b {
    grid-column: 2; font-size: var(--d-body); line-height: 1.65;
    color: var(--color-text-secondary);
  }
  @media (min-width: 900px) {
    .method-step { grid-template-columns: 26px 232px minmax(0, 1fr); gap: 0 28px; align-items: baseline; }
    .method-b { grid-column: 3; }
  }

  /* ── value rows ─────────────────────────────────────────────────── */
  .value-list { margin-top: clamp(24px, 3vw, 34px); }
  .value-row {
    display: grid; grid-template-columns: 1fr; gap: 12px;
    padding: clamp(16px, 1.7vw, 20px) 0;
    border-top: 1px solid var(--hairline);
  }
  .value-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
  .value-who { font-size: var(--d-body); font-weight: 700; color: var(--color-fg); letter-spacing: -0.01em; }
  .value-job { font-size: var(--d-cap); color: var(--color-text-faint); }
  .value-swap { display: grid; gap: 10px; }
  .value-before, .value-after {
    font-size: var(--d-body); line-height: 1.6;
    padding-left: 14px; border-left: 2px solid var(--hairline);
    max-width: var(--measure);
    text-wrap: pretty;
  }
  .value-before { color: var(--color-text-faint); }
  .value-after { color: var(--color-text-secondary); border-left-color: var(--color-butter); }
  .value-before i, .value-after i {
    display: block; font-style: normal;
    font-family: var(--font-mono), monospace; font-size: var(--d-label);
    letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--color-text-faint); margin-bottom: 3px;
  }
  .value-after i { color: var(--color-butter-text); }
  @media (min-width: 900px) {
    .value-row { grid-template-columns: 210px minmax(0, 1fr); gap: 0 28px; align-items: start; }
    .value-head { flex-direction: column; gap: 3px; }
    .value-swap { grid-template-columns: 1fr 1fr; gap: 0 22px; }
    .value-before, .value-after { max-width: none; }
  }

  /* ── close ──────────────────────────────────────────────────────── */
  .deck-close {
    padding: clamp(64px, 8vw, 110px) 0 clamp(36px, 4vw, 56px);
    border-top: 1px solid var(--hairline);
    margin-top: clamp(28px, 3vw, 44px);
  }
  .close-line {
    font-family: var(--font-sans), sans-serif;
    font-size: var(--d-close); font-weight: 300;
    letter-spacing: -0.025em; line-height: 1.08;
    color: var(--color-fg);
    margin: 0 0 18px; max-width: 20ch; text-wrap: balance;
  }
  .close-sub {
    font-size: var(--d-lead); line-height: 1.6;
    color: var(--color-text-secondary); max-width: 54ch;
    margin: 0 0 clamp(26px, 3vw, 34px);
  }
  .close-sub b { color: var(--color-fg); }
  .deck-more {
    display: inline; padding: 14px 0; margin: -14px 0;
    color: var(--color-fg); font-weight: 600; text-decoration: none;
    border-bottom: 1px solid var(--hairline);
  }
  .deck-more svg { margin-left: 5px; vertical-align: -1px; }
  .deck-more:hover { border-bottom-color: var(--color-fg); }
  .close-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  @media (max-width: 700px) {
    .close-actions { flex-direction: column; align-items: stretch; }
    .close-cta, .close-alt { justify-content: center; }
  }
  /* the pill era: CTAs go fully round, weight drops off bold, press = 0.98 */
  .close-cta {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--color-butter); color: var(--color-butter-ink, #0F0E0A);
    border: 1px solid transparent; border-radius: 999px; padding: 15px 28px;
    font-size: var(--d-body); font-weight: 500; text-decoration: none;
    transition: transform .25s var(--ease-ui), filter .25s var(--ease-ui);
  }
  .close-cta:hover { transform: translateY(-1px); filter: brightness(1.05); }
  .close-cta:active { transform: scale(0.98); }
  .close-cta svg { transition: transform .25s var(--ease-ui); }
  .close-cta:hover svg { transform: translateX(2px); }
  .close-alt {
    display: inline-flex; align-items: center;
    border: 1px solid var(--hairline); border-radius: 999px;
    padding: 15px 24px; font-size: var(--d-body); font-weight: 500;
    color: var(--color-text-secondary); text-decoration: none;
    transition: color .25s var(--ease-ui), border-color .25s var(--ease-ui), transform .25s var(--ease-ui);
  }
  .close-alt:hover { color: var(--color-fg); border-color: var(--color-border-mid); }
  .close-alt:active { transform: scale(0.98); }

  .scope-note {
    margin-top: clamp(20px, 2.2vw, 26px);
    padding-top: clamp(16px, 1.8vw, 20px);
    border-top: 1px solid var(--hairline);
  }

  /* ── tonight's book ─────────────────────────────────────────────── */
  .deck-live { padding: clamp(48px, 5.5vw, 80px) 0 clamp(16px, 2vw, 24px); }
  .deck-live .dk-kick { margin-bottom: 12px; }
  .live-ratio {
    position: relative; height: 12px; border-radius: 6px; overflow: hidden;
    background: color-mix(in srgb, var(--color-fg) 7%, transparent);
    margin: clamp(24px, 3vw, 32px) 0 10px;
  }
  .live-called { position: absolute; inset: 0 auto 0 0; background: var(--color-butter); border-radius: 6px; }
  .live-legend {
    display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 18px;
    font-size: var(--d-cap); color: var(--color-text-faint);
  }
  .live-legend b { color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
  .live-legend-on b { color: var(--color-butter); }
  .live-split {
    display: grid; grid-template-columns: 1fr; gap: clamp(16px, 2vw, 24px);
    margin: clamp(24px, 2.8vw, 32px) 0 0;
    padding-top: clamp(16px, 1.8vw, 20px);
    border-top: 1px solid var(--hairline);
  }
  .live-cell { display: grid; gap: 6px; align-content: start; }
  .live-n {
    font-size: var(--d-figure-md); font-weight: 750; letter-spacing: -0.03em;
    color: var(--color-fg); line-height: 1; font-variant-numeric: tabular-nums;
  }
  .live-k { font-size: var(--d-cap); line-height: 1.55; color: var(--color-text-secondary); max-width: 30ch; }
  @media (min-width: 760px) { .live-split { grid-template-columns: repeat(3, minmax(0,1fr)); } }

  /* ── comps, inspectable ─────────────────────────────────────────── */
  .comp-disc { margin: 2px 0 0; }
  .comp-disc > summary {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    cursor: pointer; list-style: none;
    padding: 13px 0; margin: -13px 0;
    color: var(--color-text-secondary);
    border-bottom: 1px solid transparent;
  }
  .comp-disc > summary::-webkit-details-marker { display: none; }
  .comp-disc > summary:hover { color: var(--color-fg); }
  .comp-disc > summary:hover .comp-caret { color: var(--color-fg); border-color: var(--color-fg); }
  .comp-disc > summary:focus-visible { outline: 2px solid var(--color-butter); outline-offset: 3px; }
  .comp-caret {
    flex: none; width: 17px; height: 17px; border-radius: 50%;
    border: 1px solid var(--hairline); color: var(--color-text-faint);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; line-height: 1; font-weight: 600;
    transition: transform .18s ease;
  }
  .comp-disc[open] .comp-caret { transform: rotate(45deg); }
  .comp-wrap { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--hairline); }
  .comp-table { width: 100%; border-collapse: collapse; font-size: var(--d-cap); }
  .comp-table th {
    text-align: left; font-weight: 600; padding: 0 0 6px;
    color: var(--color-text-faint); font-size: var(--d-label);
    letter-spacing: 0.08em; text-transform: uppercase;
    border-bottom: 1px solid var(--hairline);
  }
  .comp-table td { padding: 7px 0; border-bottom: 1px solid var(--hairline); vertical-align: top; }
  .comp-table tr:last-child td { border-bottom: none; }
  .comp-date { color: var(--color-text-faint); font-variant-numeric: tabular-nums; white-space: nowrap; padding-right: 12px !important; }
  .comp-lot { color: var(--color-text-secondary); line-height: 1.4; }
  .comp-lot a, .comp-lot > span {
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .comp-lot a { color: var(--color-text-secondary); text-decoration: none; border-bottom: 1px solid var(--hairline); }
  .comp-lot a:hover { color: var(--color-fg); border-bottom-color: var(--color-fg); }
  .comp-lot i { display: block; font-style: normal; color: var(--color-text-faint); font-size: var(--d-label); margin-top: 2px; }
  .comp-num {
    text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums;
    color: var(--color-fg); font-weight: 600; padding-left: 12px !important;
  }
  th.comp-num { color: var(--color-text-faint); font-weight: 600; }
  .comp-note { font-size: var(--d-label); line-height: 1.5; color: var(--color-text-faint); margin: 9px 0 0; }
  .comp-disc-hero { margin-top: 16px; max-width: var(--measure); }
  .comp-disc-hero .comp-table { font-size: var(--d-cap); }
  .comp-disc-hero .comp-lot a, .comp-disc-hero .comp-lot > span { -webkit-line-clamp: 1; }
  .comp-note b { color: var(--color-text-secondary); font-weight: 600; }

  /* ── archive coverage ───────────────────────────────────────────── */
  .cov { margin: clamp(26px, 3vw, 34px) 0 0; position: relative; }
  .cov-grid { position: relative; height: 16px; margin-left: 0; }
  .cov-tick { position: absolute; top: 0; width: 1px; height: 100%; background: var(--hairline); }
  .cov-tick i {
    position: absolute; top: 0; left: 4px; font-style: normal;
    font-family: var(--font-mono), monospace; font-size: var(--d-label);
    color: var(--color-text-faint); letter-spacing: 0.04em;
  }
  .cov-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    grid-template-areas: "house from n" "track track track";
    gap: 7px 10px;
    align-items: baseline;
    padding: 8px 0;
    border-top: 1px solid var(--hairline);
  }
  .cov-house { grid-area: house; font-size: var(--d-ui); font-weight: 650; color: var(--color-fg); }
  .cov-track { grid-area: track; position: relative; display: block; height: 10px; }
  .cov-track::before {
    content: ""; position: absolute; left: 0; right: 0; top: 50%;
    height: 1px; background: var(--hairline);
  }
  .cov-from { grid-area: from; }
  .cov-n { grid-area: n; }
  .cov-from::after { content: " ·"; }
  .cov-thin, .cov-solid { position: absolute; top: 0; height: 100%; border-radius: 5px; }
  .cov-thin { background: color-mix(in srgb, var(--color-fg) 30%, transparent); }
  .cov-solid { background: var(--color-fg); }
  .cov-from, .cov-n {
    font-size: var(--d-cap); color: var(--color-text-faint);
    font-variant-numeric: tabular-nums;
  }
  .cov-n { color: var(--color-text-secondary); }
  @media (min-width: 760px) {
    .cov-grid { margin-left: 132px; margin-right: 148px; }
    .cov-row {
      grid-template-columns: 132px minmax(0, 1fr) 52px 86px;
      grid-template-areas: "house track from n";
      gap: 0 16px; align-items: center; padding: 11px 0;
    }
    .cov-from { text-align: right; }
    .cov-from::after { content: none; }
    .cov-n { text-align: right; }
  }
  .cov-split { margin-top: clamp(34px, 4.5vw, 54px); }

  /* ── the chain ──────────────────────────────────────────────────── */
  .chain { list-style: none; margin: clamp(26px, 3vw, 36px) 0 clamp(22px, 2.5vw, 30px); padding: 0; }
  .chain-node {
    position: relative;
    padding: 0 0 clamp(20px, 2.4vw, 26px) 34px;
    border-left: 1px solid var(--hairline);
    display: grid;
    grid-template-rows: auto auto auto;
    align-content: start;
  }
  .chain-node:last-child { border-left-color: transparent; padding-bottom: 0; }
  .chain-node:last-child::after {
    content: ""; position: absolute; left: -1px; top: 0; width: 1px; height: 10px;
    background: var(--hairline);
  }
  .chain-node::before {
    content: "";
    position: absolute; left: -5px; top: 6px;
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--color-text-faint);
  }
  .chain-node:first-child::before { background: var(--color-butter); }
  .chain-k { display: block; font-size: var(--d-body); font-weight: 700; color: var(--color-fg); letter-spacing: -0.01em; }
  a.chain-k {
    width: fit-content; text-decoration: none;
    border-bottom: 1px solid var(--hairline);
    transition: border-color .25s var(--ease-ui);
  }
  a.chain-k:hover { border-bottom-color: var(--color-fg); }
  .chain-v { display: inline; font-size: var(--d-body); line-height: 1.6; color: var(--color-text-secondary); }
  @media (min-width: 900px) {
    .chain { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 0; }
    .chain-node { border-left: none; border-top: 1px solid var(--hairline); padding: 22px 18px 0 0; }
    .chain-node:last-child { border-top: none; }
    .chain-node:last-child::after {
      content: ""; position: absolute; left: 0; top: -1px; width: 8px; height: 1px;
      background: var(--hairline);
    }
    .chain-node::before { left: 0; top: -5px; }
    .chain-k { font-size: var(--d-ui); }
    .chain-v { display: block; font-size: var(--d-cap); margin-top: 4px; }
  }

  /* ── corpus bars ────────────────────────────────────────────────── */
  .corpus { margin-top: clamp(26px, 3vw, 36px); }
  .corpus-item {
    display: grid;
    grid-template-columns: 96px minmax(0,1fr) auto 52px;
    gap: 14px; align-items: center;
    padding: 10px 0; border-top: 1px solid var(--hairline);
    font-variant-numeric: tabular-nums;
  }
  .corpus-item:last-child { border-bottom: 1px solid var(--hairline); }
  .corpus-label { font-size: var(--d-body); font-weight: 600; color: var(--color-fg); }
  .corpus-track { display: block; height: 14px; }
  .corpus-bar {
    display: block; height: 100%;
    background: var(--color-text-muted);
    border-radius: 0 4px 4px 0;
  }
  .corpus-n { font-size: var(--d-ui); color: var(--color-text-secondary); }
  .corpus-pct { font-size: var(--d-cap); color: var(--color-text-faint); text-align: right; }
  @media (max-width: 620px) {
    .corpus-item { grid-template-columns: 1fr auto; gap: 4px 10px; }
    .corpus-track { grid-column: 1 / -1; }
    .corpus-pct { grid-column: 2; }
  }

  /* ── record charts + table ──────────────────────────────────────── */
  .dist, .yrs { margin: clamp(26px, 3.2vw, 38px) 0 0; padding: 0; }
  .dist-legend { display: flex; flex-wrap: wrap; gap: 8px 26px; margin-bottom: 14px; }
  .dist-key { display: inline-flex; align-items: center; gap: 8px; font-size: var(--d-cap); color: var(--color-text-secondary); }
  .dist-key i { width: 11px; height: 11px; border-radius: 2px; flex: none; }
  .dist-key b { color: var(--color-fg); font-weight: 600; font-variant-numeric: tabular-nums; }
  .dist-key-u i { background: color-mix(in srgb, var(--color-fg) 20%, transparent); border: 1px solid color-mix(in srgb, var(--color-fg) 40%, transparent); }
  .dist-key-f i { background: transparent; border: 2px solid var(--color-butter); }
  .dist-plot { position: relative; padding: 0 0 26px 42px; }
  .dist-svg { display: block; width: 100%; height: clamp(165px, 19vw, 230px); overflow: visible; }
  .yrs .dist-svg { height: clamp(125px, 14vw, 170px); }
  .dist-ylab { position: absolute; left: 0; top: 0; bottom: 26px; width: 38px; }
  .dist-ylab span {
    position: absolute; right: 8px; transform: translateY(-50%);
    font-family: var(--font-mono), monospace; font-size: var(--d-label);
    color: var(--color-text-faint); white-space: nowrap;
  }
  .dist-xlab { position: absolute; left: 42px; right: 0; bottom: 4px; height: 16px; }
  .dist-xlab span {
    position: absolute; transform: translateX(-50%);
    font-family: var(--font-mono), monospace; font-size: var(--d-label);
    color: var(--color-text-faint); white-space: nowrap;
  }
  .dist-xlab-zero { color: var(--color-fg) !important; }
  @media (max-width: 620px) {
    .dist-xlab span { display: none; }
    .dist-xlab span:nth-child(1), .dist-xlab span:nth-child(3),
    .dist-xlab span:nth-child(6), .dist-xlab span:nth-child(8) { display: block; }
  }
  .dist-below { fill: color-mix(in srgb, var(--color-fg) 3%, transparent); }
  .dist-grid { stroke: var(--hairline); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .dist-zero { stroke: var(--color-fg); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.45; vector-effect: non-scaling-stroke; }
  .dist-zero-h { stroke: color-mix(in srgb, var(--color-fg) 45%, transparent); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .dist-area-u { fill: color-mix(in srgb, var(--color-fg) 15%, transparent); stroke: color-mix(in srgb, var(--color-fg) 38%, transparent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .dist-line-f { fill: none; stroke: var(--color-butter); stroke-width: 2.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .dist-foot {
    display: flex; margin: 2px 0 0; padding-left: 42px;
    font-size: var(--d-label); letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--color-text-faint); font-family: var(--font-mono), monospace;
  }
  .dist-foot-u { width: 33.333%; text-align: right; padding-right: 10px; white-space: nowrap; }
  .dist-foot-o { flex: 1; text-align: left; padding-left: 10px; }
  @media (max-width: 620px) { .dist-foot { font-size: 9px; letter-spacing: 0.06em; } }
  .dist-cap { font-size: var(--d-cap); line-height: 1.6; color: var(--color-text-faint); margin: 12px 0 0; max-width: var(--measure); }
  .dist-cap b { color: var(--color-text-secondary); font-weight: 600; }
  .yrs-band { fill: color-mix(in srgb, var(--color-butter) 20%, transparent); }
  .yrs-line { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .yrs-line-u { stroke: color-mix(in srgb, var(--color-fg) 45%, transparent); }
  .yrs-line-f { stroke: var(--color-butter); }

  .rec-table { width: 100%; border-collapse: collapse; margin-top: clamp(30px, 3.6vw, 44px); }
  .rec-table th, .rec-table td { text-align: left; vertical-align: baseline; }
  .rec-table thead th {
    font-size: var(--d-label); letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--color-text-faint); font-weight: 600;
    padding: 0 0 9px; border-bottom: 1px solid var(--hairline);
  }
  .rec-table tbody th {
    font-size: var(--d-body); font-weight: 650; color: var(--color-fg);
    padding: 14px 16px 14px 0; border-bottom: 1px solid var(--hairline);
  }
  .rec-table tbody th i {
    display: block; font-style: normal; font-weight: 400;
    font-size: var(--d-cap); color: var(--color-text-faint); margin-top: 3px;
    max-width: 46ch;
  }
  .rec-table td { padding: 14px 0; border-bottom: 1px solid var(--hairline); }
  .rec-num { text-align: right !important; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .rec-table tbody .rec-num { font-size: var(--d-body); font-weight: 700; padding-left: 14px; }
  .rec-ctrl { color: var(--color-text-faint); }
  .rec-flag { color: var(--color-fg); }
  .rec-edge { color: var(--color-butter); }
  @media (max-width: 560px) {
    .rec-table tbody th i { display: none; }
    .rec-table tbody .rec-num, .rec-table thead th { font-size: var(--d-cap); }
  }

  /* ── proof cards ────────────────────────────────────────────────── */
  .proof-grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: clamp(26px, 3vw, 38px); }
  .proof-card {
    border: 1px solid var(--hairline);
    border-radius: 16px;
    background: var(--panel);
    overflow: hidden;
    min-width: 0;
    display: flex;
    flex-direction: column;
    transition: transform .45s var(--ease-signature), box-shadow .45s var(--ease-signature), border-color .45s var(--ease-signature);
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .proof-card:hover {
      transform: translateY(-4px);
      box-shadow: var(--shadow-pop);
      border-color: var(--color-border-mid);
    }
    .proof-card .proof-shot img { transition: transform 1.1s var(--ease-signature); }
    .proof-card:hover .proof-shot img { transform: scale(1.025); }
  }
  .proof-shot {
    position: relative;
    aspect-ratio: 16 / 10;
    background: var(--panel-mat, var(--color-bg-elevated));
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    border-bottom: 1px solid var(--hairline);
  }
  .proof-shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 10px; }
  @media (min-width: 760px) {
    .proof-shot img { position: sticky; top: 88px; inset: auto; height: 260px; }
    .proof-card:has(details[open]) .proof-shot { padding-block: 18px; }
  }
  .proof-shot:has(img) .proof-mono { display: none; }
  .proof-mono { font-size: var(--d-figure-md); font-weight: 700; color: var(--color-text-faint); opacity: 0.5; }
  .proof-body { padding: 18px 18px 20px; display: flex; flex-direction: column; flex: 1; }
  .proof-meta { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
  .proof-conf { border: 1px solid var(--hairline); border-radius: 999px; padding: 2px 9px; color: var(--color-text-muted); }
  .proof-conf-mid { border-style: dashed; }
  .proof-title { font-size: var(--d-body); font-weight: 650; line-height: 1.3; color: var(--color-fg); margin: 9px 0 15px; }
  .proof-figs { display: flex; gap: 26px; align-items: baseline; margin-bottom: 10px; }
  .proof-fig { display: flex; flex-direction: column; gap: 3px; }
  .proof-fig-k { color: var(--color-text-faint); }
  .proof-fig-v { font-size: var(--d-body); font-weight: 700; color: var(--color-fg); font-variant-numeric: tabular-nums; }
  .proof-fig-ref .proof-fig-v { color: var(--color-text-muted); font-weight: 600; }
  .proof-bullet {
    position: relative; height: 14px; width: 100%;
    background: var(--color-bg-elevated);
    border-radius: 0 4px 4px 0;
  }
  .proof-bullet-paid {
    display: block; height: 100%;
    background: var(--color-text-muted);
    border-radius: 0 4px 4px 0;
  }
  .proof-bullet-ref {
    position: absolute; top: -4px; bottom: -4px; left: calc(100% - 2px);
    width: 2px; background: var(--color-fg);
  }
  .proof-foot {
    margin-top: auto; padding-top: 14px;
    border-top: 1px solid var(--hairline);
    font-size: var(--d-label); line-height: 1.55; color: var(--color-text-faint);
    display: flex; flex-direction: column; gap: 5px;
  }
  .proof-gap { font-size: var(--d-figure-sm); font-weight: 750; color: var(--color-up); letter-spacing: -0.025em; line-height: 1; }
  @media (min-width: 760px) {
    .proof-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: clamp(16px, 1.8vw, 22px); align-items: start; }
    .proof-card { flex-direction: row; }
    .proof-shot {
      aspect-ratio: auto;
      flex: 0 0 34%;
      border-bottom: none;
      border-right: 1px solid var(--hairline);
      align-self: stretch;
    }
    .proof-body { padding: 20px 20px 22px; }
  }
  @media (min-width: 1180px) {
    .proof-shot { flex-basis: 36%; }
  }
`;
