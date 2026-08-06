import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import Flick from '../components/Flick';
import Masthead, { Underscore } from '../components/Masthead';
import { Colophon } from '../components/Terminal';
import { MARKETS } from '../constants';
import { craftTitle } from '../utils';
import meta from '../../public/data/ray/meta.json';
import backtest from '../../public/data/ray/backtest.json';
import market from '../../public/data/ray/market.json';
import refs from '../../public/data/ray/refs.json';
import proof from './proof-cases.json';
import coverageSnapshot from './coverage.json';
import { readLiveBook, type LiveBook } from './live';
import PlateImg from '../components/PlateImg';
import RayEntrance from '../components/RayEntrance';
import { httpsImg, sizedImg } from '../utils';

/**
 * WHAT IS LECTR — the institutional page.
 *
 * This replaced a seven-section engineering walk-through that published the
 * recipe: adapter names, gate thresholds, the lifecycle state machine, file
 * paths. That is the product. This page makes the case instead — scale, the
 * measured edge, the linkage, and (the part institutions actually test for)
 * what the engine refuses to say.
 *
 * EVERY FIGURE IS DERIVED FROM THE SHIPPED DATA at build time — meta.json,
 * backtest.json, market.json, refs.json. Nothing is typed by hand, so nothing
 * here can quietly go stale the way a hardcoded deck does. This is a server
 * component, so those imports never reach the client bundle.
 */

export const metadata: Metadata = {
  title: 'What is lectr — the auction market, priced',
  description:
    'lectr reads every published estimate against every realised hammer across eight auction houses and three decades — 741,521 settled lots — and prices what comes next. The corpus, the value engine, the replayed record, and what it refuses to say.',
};

// the product's own content column — matches ArtistNav and the Colophon
const wrap: React.CSSProperties = {};
const p: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.7, color: 'var(--color-text-secondary)', margin: '0 0 16px' };
const lead: React.CSSProperties = { ...p, fontSize: 17.5, lineHeight: 1.62, color: 'var(--color-text-secondary)' };
const caption: React.CSSProperties = { fontSize: 12.5, color: 'var(--color-text-faint)', margin: '10px 0 0', lineHeight: 1.6 };

const fmt = (n: number) => n.toLocaleString();
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}%`;

/* ── figures, all read from the shipped payloads ─────────────────────────── */
const F = backtest.flagged;
const U = backtest.unflagged;
const edgeAllIn = F.medianPerfPct - U.medianPerfPct;
const edgeHammer = (F.hammerMedianPct ?? 0) - (U.hammerMedianPct ?? 0);
const edgeBeat = F.beatHighPct - U.beatHighPct;

const marketsRec = market.markets as Record<string, { label?: string; n?: number }>;
// market.json's own labels are lowercase keys ('sports', 'culture'); MARKETS is
// the app's display roster and carries the proper names ("Pop Culture").
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

/* ── presentation primitives ─────────────────────────────────────────────── */

function Stat({ figure, label, note }: { figure: string; label: string; note?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 'clamp(26px, 3vw, 42px)', fontWeight: 700, letterSpacing: '-0.035em', color: 'var(--color-fg)', lineHeight: 1 }}>
        {figure}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', marginTop: 9 }}>{label}</div>
      {note && <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 3, lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

/** THE CORPUS, RANKED. Was a stacked composition bar in a six-step neutral
 *  ramp. Two problems, both measured: the ramp FAILED the categorical palette
 *  floor (worst adjacent pair dE 9.0 against a required 15, and the darkest
 *  step at 2.19:1 on this ground) — and no six-step neutral ramp can pass on a
 *  near-black surface, four is the ceiling. Worse, stacking asks the reader to
 *  compare segment lengths with no common baseline, and at 390px four of six
 *  markets rendered between 4.3 and 30px.
 *
 *  Ranked bars from a common baseline are the most accurate encoding available
 *  and need exactly ONE ink, so the categorical-palette question disappears.
 *  Sorted descending, direct-labelled, square at the baseline with the radius
 *  on the data end only. */
function CorpusBars({ bars, total }: { bars: { key: string; label: string; n: number }[]; total: number }) {
  const max = bars[0]?.n || 1;
  return (
    <div className="corpus">
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

/** ARCHIVE COVERAGE — what each house's record actually spans.
 *
 *  §01 claims three decades. It previously evidenced that claim with a
 *  lots-by-market chart, which is a statement about CATEGORY, not time — and
 *  a lots-per-YEAR chart would have been worse: Goldin alone is 320,745 lots
 *  across 2022-2026 (143,142 in 2023 on its own), so the shape would have been
 *  a picture of one house's card business rather than of the archive's depth.
 *
 *  So depth of coverage is drawn instead, and volume is reported as a number
 *  beside it rather than as a bar length. The faint segment is real but thin
 *  coverage — Christie's has exactly ONE lot dated 1989 against 1,331 in 1991,
 *  and RR Auction has seven years under 25 lots before 2003. Drawing those
 *  solid would let a single record claim a decade.
 */
function CoverageChart({ rows }: { rows: { house: string; first: number; dense: number; last: number; n: number }[] }) {
  const lo = Math.min(...rows.map((r) => r.first));
  const hi = Math.max(...rows.map((r) => r.last));
  const span = Math.max(1, hi - lo);
  const pos = (y: number) => ((y - lo) / span) * 100;
  // decade gridlines, inclusive of the first decade at or after lo
  const decades: number[] = [];
  for (let y = Math.ceil(lo / 10) * 10; y <= hi; y += 10) decades.push(y);
  return (
    <div className="cov">
      <div className="cov-grid" aria-hidden="true">
        {decades.map((y) => (
          <span className="cov-tick" key={y} style={{ left: `${pos(y)}%` }}><i>{y}</i></span>
        ))}
      </div>
      {rows.map((r) => (
        <div className="cov-row" key={r.house}>
          <span className="cov-house">{r.house.replace(/ /g, '\u00a0')}</span>
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

/** THE RECORD AS A SLOPE — ONE shared scale across all four panels.
 *
 *  The first version normalised each panel to its OWN maximum, which encoded
 *  the RATIO lo/hi while every label, the summary and the hero figure speak in
 *  POINTS. Measured, that put a 15.9x scale spread across a 2x2 grid with
 *  identical geometry: the 20-point edge drew 69.8px while the 25-point edge —
 *  the one this whole page is built on — drew 27.6px. The chart contradicted
 *  its own headline. Geometry is now the signed improvement over control on a
 *  single fixed domain, so panel 1 IS the "+25 points" figure, measurable off
 *  the page, and fail-to-sell reads nearly flat — which is the honest picture
 *  and supports its own note better than the exaggeration did.
 */
const SLOPE_DOMAIN = 26;  // percentage points — covers the largest edge (25)

function Slope({ metric, note, lo, hi, fmtV, n, better = 'higher' }: {
  metric: string; note?: string;
  lo: number; hi: number;
  fmtV: (n: number) => string;
  /** sample size — an institutional reader looks for n before the number */
  n?: string;
  better?: 'higher' | 'lower';
}) {
  const delta = better === 'lower' ? lo - hi : hi - lo;   // signed improvement
  const yLo = 86;                                          // shared baseline
  const yHi = 86 - (delta / SLOPE_DOMAIN) * 74;
  const wins = delta >= 0;
  const ink = wins ? 'var(--color-up)' : 'var(--color-text-muted)';
  return (
    <div className="slope">
      <div className="slope-head">
        <span className="slope-metric">{metric}</span>
        {note && <span className="slope-note">{note}{n ? ` · n ${n}` : ''}</span>}
      </div>
      <div className="slope-plot">
        <span className="sr-only">{metric}: unflagged {fmtV(lo)}, flagged {fmtV(hi)}.</span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="slope-svg" aria-hidden>
          <line x1="14" y1={yLo} x2="86" y2={yHi} stroke={ink} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="slope-dot slope-dot-lo" style={{ top: `${yLo}%` }} aria-hidden />
        <span className="slope-dot slope-dot-hi" style={{ top: `${yHi}%`, background: ink }} aria-hidden />
        <span className="slope-val slope-val-lo" style={{ top: `${yLo}%` }}>{fmtV(lo)}</span>
        <span className="slope-val slope-val-hi" style={{ top: `${yHi}%`, color: ink }}>{fmtV(hi)}</span>
      </div>
      <div className="slope-foot kicker"><span>unflagged</span><span>flagged</span></div>
    </div>
  );
}

function ProofCase({ c }: { c: typeof proof.cases[number] }) {
  const paidW = Math.max(6, Math.round((c.realizedUsd / c.ourValueUsd) * 100));
  const noEstimate = c.houseEstLow == null;
  const title = craftTitle(c.title);
  const img = c.imageUrl ? sizedImg(httpsImg(c.imageUrl), 960) : null;
  return (
    <div className="proof-card ray-enter-card">
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
          {/* Always render the tier, never only the flattering one. Showing the
              badge on 5 of 6 cards made its absence on the medium case read as a
              rendering glitch rather than as the engine's own hedge — and the
              hedge is the point this deck is making in §05. */}
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
          <span>
            from {c.comps} comparable sales
            {noEstimate
              ? ' · the house published no estimate — ours was the only valuation'
              : ` · house est $${fmt(c.houseEstLow as number)}–$${fmt(c.houseEstHigh as number)}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/** A slide that is one number. No heading, no ordinal, no chrome — the deck
 *  needs a breath between argued sections, and the edge is the single figure
 *  the whole record reduces to. */
function Statement({ figure, lede, foot }: { figure: string; lede: React.ReactNode; foot?: string }) {
  return (
    <section className="deck-statement ray-enter">
      <div className="rail">
        <div className="statement-fig">{figure}</div>
        <p className="statement-lede">{lede}</p>
        {foot && <p className="statement-foot">{foot}</p>}
      </div>
    </section>
  );
}

/** TONIGHT'S BOOK — the one live moment in an otherwise retrospective deck.
 *
 *  Everything before this proves the engine was right about sales that already
 *  happened. This is the same engine pointed at lots that have not sold yet,
 *  and it is deliberately the section where the ratio is the story: on a book of
 *  several thousand, the engine speaks about a couple of dozen. That is §05's
 *  claim ("proudest of how often it says nothing") stated as tonight's number
 *  rather than as a principle.
 */
function LiveBand({ book }: { book: LiveBook }) {
  const pct = (book.called / book.total) * 100;
  return (
    <section className="deck-live ray-enter">
      <div className="rail">
        <span className="kicker" style={{ display: 'block', margin: '0 0 12px' }}>Tonight&rsquo;s book</span>
        <h2 className="deck-h">
          {fmt(book.total)} lots are on the book. lectr has something to say about {book.called}.
        </h2>

        <div className="live-ratio" aria-hidden="true">
          {/* the called slice is a hairline against the full book on purpose —
              at 0.5% any "readable minimum" width would be a lie about the ratio */}
          <span className="live-called" style={{ width: `${Math.max(pct, 0.35)}%` }} />
        </div>
        <div className="live-legend">
          <span><b>{fmt(book.total - book.called)}</b> no call — the comparable pool doesn&rsquo;t clear the bar</span>
          <span className="live-legend-on"><b>{book.called}</b> called &middot; {pct.toFixed(1)}% of the book</span>
        </div>

        <div className="live-split">
          <div className="live-cell">
            <span className="live-n">{book.below}</span>
            <span className="live-k">trading below where comparables clear</span>
          </div>
          <div className="live-cell">
            <span className="live-n">{book.above}</span>
            <span className="live-k">trading above it</span>
          </div>
          <div className="live-cell">
            <span className="live-n">{book.high}</span>
            <span className="live-k">at the high-confidence tier</span>
          </div>
        </div>

        <p style={caption}>
          Read from the upcoming book at build time{book.generatedAt ? `, ${book.generatedAt.slice(0, 10)}` : ''}. Both
          directions are published: a lot trading above where its comparables clear is as much of a
          call as one trading below, and the deck would be worth less if it only showed the flattering
          side. <Link href="/" className="deck-more">See today&rsquo;s calls <Flick size={11} /></Link>
        </p>
      </div>
    </section>
  );
}

/** A lot at full width. The product is about objects; the deck should stop and
 *  look at one. Caption sits under the plate so the image is never covered. */
function HeroLot({ c }: { c: typeof proof.cases[number] }) {
  const img = c.imageUrl ? sizedImg(httpsImg(c.imageUrl), 1280) : null;
  if (!img) return null;
  return (
    <section className="deck-hero ray-enter">
      <div className="rail">
      <div className="hero-plate">
        <PlateImg src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </div>
        <p className="hero-cap">
          <b>{craftTitle(c.title)}</b> · {c.house} · {String(c.saleDate).slice(0, 10)} — lectr priced it at{' '}
          <b>${fmt(c.ourValueUsd)}</b> from {c.comps} comparable sales. It sold for{' '}
          <b className="hero-cap-paid">${fmt(c.realizedUsd)}</b>.
        </p>
      </div>
    </section>
  );
}

function Sec({ ord, label, title, paper, children }: {
  ord: string; label: string; title: React.ReactNode; paper?: boolean; children: React.ReactNode;
}) {
  const inner = (
    <div className="rail" style={{ position: 'relative' }}>
      <span className="kicker" style={{ display: 'block', margin: '0 0 12px' }}>{ord} · {label}</span>
      <h2 className="deck-h">{title}</h2>
      {children}
    </div>
  );
  if (paper) return <section className="ray-paper deck-room ray-enter">{inner}</section>;
  return <section className="deck-slide ray-enter">{inner}</section>;
}

/** A step in the pricing chain. Numbered, not arrowed — the flow reads down. */
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
  return (
    <div className="deck-scope" style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      {/* The proof lots hotlink four house CDNs. They sit well below the fold, so
          they stay lazy — the LCP element here is the cover headline, and eager
          images would compete with it. dns-prefetch takes the DNS round-trip off
          the scroll instead; Sotheby's carries three of the seven, so it earns a
          full preconnect. */}
      <link rel="preconnect" href="https://sothebys-com.brightspotcdn.com" crossOrigin="" />
      <link rel="dns-prefetch" href="https://images2.bonhams.com" />
      <link rel="dns-prefetch" href="https://d2tt46f3mh26nl.cloudfront.net" />
      <link rel="dns-prefetch" href="https://www.wright20.com" />
      <style dangerouslySetInnerHTML={{ __html: `
        .deck-slide { padding: clamp(54px, 7vw, 96px) 0 clamp(20px, 3vw, 34px); }
        .deck-room {
          position: relative;
          margin-inline: calc(50% - 50vw + clamp(10px, 1.2vw, 18px));
          background: var(--paper, #E2D9C4);
          border-radius: 10px;
          padding: clamp(46px, 6vw, 82px) 0 clamp(40px, 5vw, 66px);
          margin-block: clamp(40px, 5vw, 72px);
        }
        @media (max-width: 700px) { .deck-room { margin-inline: calc(50% - 50vw + 8px); border-radius: 8px; } }
        .deck-h {
          /* Fraunces is this product's display voice — Masthead sets its h1 in
             it and the lander uses it for every room title. Eight Inter-700
             heads was the house style of a generic dark SaaS page, not lectr. */
          font-family: var(--font-serif-display), Georgia, serif;
          font-size: var(--d-h);
          font-weight: 400;
          letter-spacing: -0.015em;
          line-height: 1.12;
          color: var(--color-fg);
          margin: 0 0 20px;
          max-width: 24ch;
          text-wrap: balance;
        }
        .deck-cover { padding: clamp(30px, 4vw, 52px) 0 clamp(30px, 4vw, 46px); }
        /* ── THE DECK SCALE ───────────────────────────────────────────────
           Six ad-hoc sizes collapsed into a declared ramp. Three of these are
           the design system's own tokens; the two display sizes are deliberate
           deck-register extensions above --text-hero-num, declared here rather
           than sprinkled as loose clamp() values. */
        .deck-scope {
          --d-figure: clamp(64px, 15vw, 132px);   /* the one-number slide */
          --d-display: clamp(38px, 10vw, 76px);  /* cover statement */
          --d-close: clamp(30px, 7vw, 50px);    /* closing line */
          --d-figure-md: clamp(28px, 3.6vw, 46px);/* card-level figures: chain nodes, plate marks */
          --d-figure-sm: clamp(24px, 2.4vw, 30px);/* the gap callout on a proof card */
          --d-h: var(--text-title-1);             /* every slide heading */
          --d-lead: clamp(16px, 1.5vw, 19px);     /* slide opening paragraph */
          --d-lead-lg: clamp(17px, 1.9vw, 24px);  /* the statement slide's larger lede */
          --d-body: var(--text-body);             /* running copy: 15.5 */
          --d-ui: var(--text-ui);                 /* labels in components: 13.5 */
          --d-cap: var(--text-caption);           /* captions: 12.5 */
          --d-label: var(--text-label);           /* mono kickers: 10.5 */
        }

        /* ── COVER: a statement with air around it ─────────────────────── */
        .deck-cover-wrap { padding: clamp(40px, 8vh, 96px) 0 clamp(30px, 4vw, 52px); }
        .cover-h {
          font-size: var(--d-display);
          font-weight: 700;
          letter-spacing: -0.042em;
          line-height: 1.03;
          color: var(--color-fg);
          margin: 0 0 clamp(20px, 2.4vw, 30px);
          max-width: 18ch;
        }
        .cover-h-em { color: var(--color-fg); }
        .cover-sub {
          font-size: var(--d-lead);
          line-height: 1.62;
          color: var(--color-text-secondary);
          max-width: 58ch;
          margin: 0;
        }
        .cover-sub b { color: var(--color-fg); font-weight: 600; font-variant-numeric: tabular-nums; }

        /* ── STATEMENT: the deck exhales ───────────────────────────────── */
        .deck-statement {
          padding: clamp(60px, 9vw, 130px) 0;
          display: grid;
          align-content: center;
          min-height: 72vh;
          border-block: 1px solid var(--hairline);
          margin-block: clamp(30px, 4vw, 56px);
        }
        .statement-fig {
          font-size: var(--d-figure);
          font-weight: 800;
          letter-spacing: -0.05em;
          line-height: 0.92;
          color: var(--color-fg);
          margin-bottom: clamp(16px, 2vw, 26px);
        }
        .statement-lede {
          font-size: var(--d-lead-lg);
          line-height: 1.45;
          color: var(--color-fg);
          max-width: 30ch;
          margin: 0;
          font-weight: 500;
          text-wrap: balance;
        }
        .statement-foot {
          font-size: var(--d-cap);
          line-height: 1.6;
          color: var(--color-text-faint);
          max-width: 52ch;
          margin: 18px 0 0;
        }

        /* ── HERO LOT: stop and look at the object ─────────────────────── */
        .deck-hero { margin-block: clamp(40px, 6vw, 84px); }
        .hero-plate {
          position: relative;
          height: clamp(260px, 48vh, 540px);
          background: var(--panel-mat, var(--color-bg-elevated));
          overflow: hidden;
          border: 1px solid var(--hairline);
          border-radius: 8px;
        }
        .hero-plate img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: clamp(14px, 2vw, 26px); }
        .hero-cap {
          font-size: var(--d-lead);
          line-height: 1.55;
          color: var(--color-text-secondary);
          margin: 20px 0 0;
          max-width: 62ch;
        }
        .hero-cap b { color: var(--color-fg); font-weight: 600; }
        .hero-cap-paid { color: var(--color-fg); }

        /* ── MEASURE ──────────────────────────────────────────────────
           Prose ran the full 1088px column — ~140 characters per line, about
           double the readable maximum. It was the loudest "unfinished" signal
           on the page. Grids keep the full column; only running text is capped.

           One token, because two different caps read as a mistake. 60ch of the
           "0" glyph measures ~75 actual characters in this face (lowercase runs
           narrower than a figure) — verified by counting rendered lines, not by
           trusting the unit. */
        .deck-scope { --measure: 60ch; }
        .deck-scope p,
        .deck-scope .hero-cap,
        .deck-scope .method-b,
        .deck-scope .value-what { max-width: var(--measure); }

        /* ── METHOD: the four steps ───────────────────────────────────── */
        .method-step {
          display: grid;
          grid-template-columns: 26px minmax(0, 1fr);
          gap: 5px 16px;
          padding: clamp(15px, 1.7vw, 20px) 0;
          border-top: 1px solid var(--hairline);
        }
        .method-n {
          grid-row: 1; font-size: var(--d-cap); font-weight: 700;
          color: var(--color-text-faint); font-variant-numeric: tabular-nums; padding-top: 3px;
        }
        .method-t { font-size: var(--d-ui); font-weight: 650; color: var(--color-fg); }
        .method-b {
          grid-column: 2; font-size: var(--d-body); line-height: 1.65;
          color: var(--color-text-secondary);
        }
        @media (min-width: 900px) {
          /* Title to its own column: the four steps then read as a table of
             method, and the body inherits a natural measure instead of a cap. */
          .method-step { grid-template-columns: 26px 232px minmax(0, 1fr); gap: 0 28px; align-items: baseline; }
          .method-b { grid-column: 3; }
        }

        /* ── VALUE: who, and what changes for them ────────────────────── */
        .value-list { margin-top: clamp(24px, 3vw, 34px); }
        .value-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          padding: clamp(20px, 2.2vw, 26px) 0;
          border-top: 1px solid var(--hairline);
        }
        .value-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
        .value-who { font-size: var(--d-body); font-weight: 700; color: var(--color-fg); letter-spacing: -0.01em; }
        .value-job { font-size: var(--d-cap); color: var(--color-text-faint); }
        .value-swap { display: grid; gap: 10px; }
        /* The swap IS the argument, so before and after are given equal room and
           differentiated by ink rather than by size — the old version was one
           muted paragraph per person and read as a list of blurbs. */
        .value-before, .value-after {
          font-size: var(--d-body); line-height: 1.6;
          padding-left: 14px; border-left: 2px solid var(--hairline);
          max-width: var(--measure);
          text-wrap: pretty; /* these run 1-3 lines; single-word last lines were common */
        }
        .value-before { color: var(--color-text-faint); }
        .value-after { color: var(--color-text-secondary); border-left-color: var(--color-butter); }
        .value-before i, .value-after i {
          display: block; font-style: normal;
          font-family: var(--font-mono), monospace; font-size: var(--d-label);
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-text-faint); margin-bottom: 3px;
        }
        .value-after i { color: var(--color-butter); }
        .value-after b { color: var(--color-fg); font-weight: 600; }
        @media (min-width: 900px) {
          .value-row { grid-template-columns: 210px minmax(0, 1fr); gap: 0 28px; align-items: start; }
          .value-head { flex-direction: column; gap: 3px; }
          .value-swap { grid-template-columns: 1fr 1fr; gap: 0 22px; }
          .value-before, .value-after { max-width: none; }
        }

        /* ── CLOSE: one line, one action ──────────────────────────────── */
        .deck-close {
          padding: clamp(64px, 9vw, 132px) 0 clamp(48px, 6vw, 84px);
          border-top: 1px solid var(--hairline);
          margin-top: clamp(40px, 5vw, 70px);
        }
        .close-line {
          font-family: var(--font-serif-display), Georgia, serif;
          font-size: var(--d-close);
          font-weight: 400;
          letter-spacing: -0.015em;
          line-height: 1.1;
          color: var(--color-fg);
          margin: 0 0 18px;
          max-width: 22ch;
          text-wrap: balance;
        }
        .close-sub {
          font-size: var(--d-lead);
          line-height: 1.6;
          color: var(--color-text-secondary);
          max-width: 54ch;
          margin: 0 0 clamp(26px, 3vw, 34px);
        }
        .close-sub b { color: var(--color-fg); }
        /* Inline "read on" link. It was a 123x15 target inside a caption —
           below any usable tap size on a phone, and indistinguishable from the
           muted prose around it. */
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
        .close-cta {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--color-fg); color: var(--color-bg);
          border: 1px solid transparent; border-radius: 8px; padding: 15px 26px;
          font-size: var(--d-body); font-weight: 650; text-decoration: none;
        }
        .close-alt {
          display: inline-flex; align-items: center;
          border: 1px solid var(--hairline); border-radius: 8px;
          padding: 15px 24px; font-size: var(--d-body); font-weight: 600;
          color: var(--color-text-secondary); text-decoration: none;
        }
        .close-alt:hover { color: var(--color-fg); }

        /* An explicit scope disclosure, in the section about restraint —
           "8 houses" reads as complete unless you say what it isn't. */
        .scope-note {
          margin-top: clamp(26px, 3vw, 34px);
          padding-top: clamp(20px, 2.4vw, 26px);
          border-top: 1px solid var(--hairline);
        }

        /* ── TONIGHT'S BOOK ───────────────────────────────────────────── */
        .deck-live { padding: clamp(54px, 7vw, 96px) 0 clamp(20px, 3vw, 34px); }
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
          margin: clamp(28px, 3.4vw, 40px) 0 0;
          padding-top: clamp(22px, 2.6vw, 30px);
          border-top: 1px solid var(--hairline);
        }
        .live-cell { display: grid; gap: 6px; align-content: start; }
        .live-n {
          font-size: var(--d-figure-md); font-weight: 750; letter-spacing: -0.03em;
          color: var(--color-fg); line-height: 1; font-variant-numeric: tabular-nums;
        }
        .live-k { font-size: var(--d-cap); line-height: 1.55; color: var(--color-text-secondary); max-width: 30ch; }
        @media (min-width: 760px) { .live-split { grid-template-columns: repeat(3, minmax(0,1fr)); } }

        /* ── ARCHIVE COVERAGE ─────────────────────────────────────────── */
        .cov { margin: clamp(26px, 3vw, 34px) 0 0; position: relative; }
        .cov-grid { position: relative; height: 16px; margin-left: 0; }
        .cov-tick { position: absolute; top: 0; width: 1px; height: 100%; background: var(--hairline); }
        .cov-tick i {
          position: absolute; top: 0; left: 4px; font-style: normal;
          font-family: var(--font-mono), monospace; font-size: var(--d-label);
          color: var(--color-text-faint); letter-spacing: 0.04em;
        }
        .cov-row {
          /* Phone: house and its two figures share one line, the bar takes the
             next. Stacking all four put every row near 210px tall and left the
             year and the count reading as two unlabelled numbers. */
          display: grid;
          grid-template-columns: 1fr auto auto;
          grid-template-areas: "house from n" "track track track";
          gap: 9px 10px;
          align-items: baseline;
          padding: 11px 0;
          border-top: 1px solid var(--hairline);
        }
        .cov-house { grid-area: house; }
        .cov-track { grid-area: track; }
        .cov-from { grid-area: from; }
        .cov-n { grid-area: n; }
        .cov-from::after { content: " ·"; }
        .cov-house { font-size: var(--d-ui); font-weight: 650; color: var(--color-fg); }
        /* The track is an AXIS, not a bar. Filling it edge-to-edge made every
           row look like it had coverage from 1989: a house whose record starts
           in 2013 drew the same dark pill from the left as Christie's thin
           1989-91 segment, so "thin" and "absent" were indistinguishable — which
           is precisely the distinction this chart exists to make. Only real
           coverage gets height now; the axis is a hairline through the middle. */
        .cov-track { position: relative; display: block; height: 10px; }
        .cov-track::before {
          content: ""; position: absolute; left: 0; right: 0; top: 50%;
          height: 1px; background: var(--hairline);
        }
        .cov-thin, .cov-solid { position: absolute; top: 0; height: 100%; border-radius: 5px; }
        /* one ink for both: the difference between real and thin coverage is
           density, not category, so it is carried by opacity rather than hue */
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

        /* ── THE CHAIN: the graph, drawn ──────────────────────────────── */
        .chain { list-style: none; margin: clamp(26px, 3vw, 36px) 0 clamp(22px, 2.5vw, 30px); padding: 0; }
        .chain-node {
          position: relative;
          padding: 0 0 clamp(20px, 2.4vw, 26px) 34px;
          border-left: 1px solid var(--hairline);
          display: grid;
          grid-template-rows: auto auto auto;
          align-content: start;
        }
        /* The rule must stop AT the final dot, not before it (an orphaned last
           link) and not past it (a chain running off-page). Height-independent:
           kill the border, then draw a stub down to the dot's centre. */
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
        .chain-node:first-child::before { background: var(--color-fg); }
        .chain-k { display: block; font-size: var(--d-body); font-weight: 700; color: var(--color-fg); letter-spacing: -0.01em; }
        .chain-n {
          display: inline-block; margin-top: 6px; margin-right: 8px;
          font-size: var(--d-figure-md); font-weight: 750; letter-spacing: -0.03em;
          color: var(--color-fg); line-height: 1;
        }
        .chain-v { display: inline; font-size: var(--d-body); line-height: 1.6; color: var(--color-text-secondary); }
        @media (min-width: 900px) {
          /* the chain lies down: five steps across, the rule running through
             them, so the linkage reads as a flow rather than a list */
          .chain { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 0; }
          .chain::before { display: none; }
          .chain-node { border-left: none; border-top: 1px solid var(--hairline); padding: 22px 18px 0 0; }
          /* the rule stops at the last dot rather than running on to the
             container edge, which read as "continues off-page" */
          .chain-node:last-child { border-top: none; }
          .chain-node:last-child::after {
            content: ""; position: absolute; left: 0; top: -1px; width: 8px; height: 1px;
            background: var(--hairline);
          }
          .chain-node::before { left: 0; top: -5px; }
          .chain-k { font-size: var(--d-ui); }
          .chain-v { display: block; font-size: var(--d-cap); margin-top: 4px; }
          .chain-n { display: block; margin: 8px 0 0; }
        }

        /* ── CORPUS: ranked, one ink, common baseline ─────────────────── */
        .corpus { margin-top: clamp(26px, 3vw, 36px); }
        .corpus-item {
          display: grid;
          grid-template-columns: 96px minmax(0,1fr) auto 52px;
          gap: 14px; align-items: center;
          padding: 13px 0; border-top: 1px solid var(--hairline);
          font-variant-numeric: tabular-nums;
        }
        .corpus-item:last-child { border-bottom: 1px solid var(--hairline); }
        .corpus-label { font-size: var(--d-body); font-weight: 600; color: var(--color-fg); }
        .corpus-track { display: block; height: 14px; }
        .corpus-bar {
          display: block; height: 100%;
          background: var(--color-text-muted);
          border-radius: 0 4px 4px 0;   /* square at the baseline, rounded at the data end */
        }
        .corpus-n { font-size: var(--d-ui); color: var(--color-text-secondary); }
        .corpus-pct { font-size: var(--d-cap); color: var(--color-text-faint); text-align: right; }
        @media (max-width: 620px) {
          .corpus-item { grid-template-columns: 1fr auto; gap: 4px 10px; }
          .corpus-track { grid-column: 1 / -1; }
          .corpus-pct { grid-column: 2; }
        }

        /* ── RECORD: control to flagged, drawn as a move ──────────────── */
        .slope-grid { display: grid; grid-template-columns: 1fr; gap: clamp(22px, 2.6vw, 30px); margin-top: clamp(24px, 3vw, 34px); }
        @media (min-width: 780px) { .slope-grid { grid-template-columns: repeat(2, minmax(0,1fr)); gap: clamp(26px, 3vw, 40px); } }
        .slope { border-top: 1px solid var(--hairline); padding-top: 16px; }
        .slope-head { margin-bottom: 10px; }
        .slope-metric { display: block; font-size: var(--d-body); font-weight: 650; color: var(--color-fg); }
        .slope-note { display: block; font-size: var(--d-cap); line-height: 1.5; color: var(--color-text-faint); margin-top: 3px; }
        /* the shared-delta rewrite lifted the data off the ceiling, so the plot
           no longer needs 108px of which 66-84% was empty */
        .slope-plot { position: relative; height: 84px; }
        .slope-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
        .slope-dot {
          position: absolute; width: 8px; height: 8px; border-radius: 50%;
          transform: translate(-50%, -50%); background: var(--color-text-muted);
          /* a surface ring keeps the dot legible where the line passes under it */
          box-shadow: 0 0 0 2px var(--color-bg);
        }
        .slope-dot-lo { left: 14%; }
        .slope-dot-hi { left: 86%; }
        /* Labels HANG OFF their dots rather than pinning to the panel edges.
           Edge-pinning put the dot on top of the glyph at 390px — measured 7.1px
           of overlap, which destroyed the +/- sign. */
        .slope-val {
          position: absolute;
          font-size: var(--d-body); font-weight: 700; font-variant-numeric: tabular-nums;
          color: var(--color-text-muted); white-space: nowrap;
        }
        .slope-val-lo { left: 14%; transform: translate(calc(-100% - 12px), -50%); }
        .slope-val-hi { left: 86%; transform: translate(12px, -50%); }
        .slope-foot { display: flex; justify-content: space-between; margin-top: 4px; }

        .deck-statband {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: clamp(20px, 2.2vw, 28px);
          /* No rule of its own: Masthead already closes the opening frame with
             one, and a second hairline 49px below it read as an accident. The
             stats hang off that shared seam instead. */
          margin-top: clamp(44px, 5.5vw, 76px);
        }

        /* ── THE PROOF CARDS ────────────────────────────────────────────
           Two DIFFERENT compositions, not one squeezed. Phone: the object
           leads as a full-width plate, the argument reads beneath it in a
           single column. Desktop: the plate stands beside the argument so a
           card is scannable in one glance and two fit per row. */
        .proof-grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: clamp(26px, 3vw, 38px); }
        .proof-card {
          border: 1px solid var(--hairline);
          border-radius: 16px;
          background: var(--panel);
          overflow: hidden;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .proof-shot {
          position: relative;
          aspect-ratio: 4 / 3;
          background: var(--panel-mat, var(--color-bg-elevated));
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          border-bottom: 1px solid var(--hairline);
        }
        .proof-shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 10px; }
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
        /* ONE mark: what the room paid, measured against lectr's value as the
           reference tick at 100%. The gap between bar end and tick IS the
           discount, so the number and the picture are the same statement. */
        .proof-bullet {
          position: relative; height: 14px; width: 100%;
          background: var(--color-bg-elevated);
          border-radius: 0 4px 4px 0;
        }
        .proof-bullet-paid {
          display: block; height: 100%;
          background: var(--color-text-muted);
          border-radius: 0 4px 4px 0;   /* square at the baseline */
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
          .proof-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: clamp(16px, 1.8vw, 22px); }
          .proof-card { flex-direction: row; }
          .proof-row { grid-template-columns: 58px minmax(0,1fr) 78px; gap: 8px; }
          .proof-track { height: 14px; border-radius: 7px; }
          .proof-fill { border-radius: 7px; }
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
          .proof-row { grid-template-columns: 64px minmax(0,1fr) 88px; }

        }
` }} />
      <ArtistNav activeSlug="about" />

      <RayEntrance animate>
      <div style={{ paddingTop: 28, paddingBottom: 56 }}>
        <div className="deck-cover-wrap ray-enter">
          <div className="rail">
            {/* The same opening frame six other pages use — mono kicker, dated
                serial, the enclosing hairlines, the Fraunces h1 and ONE butter
                accent. This page had a bespoke Inter slab instead, which is why
                it read as a deck ABOUT lectr rather than a lectr page. */}
            <Masthead
              kicker="What is lectr"
              serial={meta.lastCrawl}
              title={<>Every lot arrives with a guess. We score it against{' '}
                <Underscore>{fmt(meta.totalSold)} results</Underscore>.</>}
              sub={<>An auction estimate is an opinion. A hammer is a fact. lectr has read every
                settled lot across <b>{meta.sources.length} houses</b> and three decades, and prices
                what comes next against the sales that actually resemble it.</>}
            />

            <div className="deck-statband">
              <Stat figure={fmt(meta.totalLots)} label="Lots under tracking" note="live and settled, one graph" />
              <Stat figure={fmt(meta.totalSold)} label="Settled results" note="every one with a published price" />
              <Stat figure={String(meta.sources.length)} label="Auction houses" note={meta.sources.map((h) => h.replace(/ /g, '\u00a0')).join(' · ')} />
              <Stat figure={fmt(F.n)} label="Replayed calls" note="scored against what happened next" />
            </div>
          </div>
        </div>

        <Sec ord="01" label="The corpus" title={<>Depth is the moat. It took {ARCHIVE_YEARS} years to build.</>}>
          <p style={p}>
            Comparable-sales pricing is only as good as the pool behind it, and auction results are
            scattered across houses that publish in different shapes, purge lots when a sale closes,
            and rarely keep a machine-readable archive. lectr holds all of it in one schema — every
            lot normalised to a dated FX rate, a declared price basis, and a structured identity, so
            a 1994 Geneva watch sale and a lot closing tonight are the same kind of object.
          </p>
          <CoverageChart rows={COVERAGE} />
          <p style={caption}>
            Settled records per house, by sale year. The faint segment is coverage that exists but is
            thin — Christie&rsquo;s has a single lot dated 1989 against 1,331 in 1991 — so early depth
            is shown as early depth rather than rounded up. Nothing here is licensed: every row was
            crawled, normalised and reconciled lot by lot.
          </p>

          <div className="cov-split">
            <CorpusBars bars={CORPUS_BARS} total={CORPUS_BARS.reduce((t, b) => t + b.n, 0)} />
          </div>
          <p style={caption}>
            And by market. Depth is what lets the engine demand that a comparable share a maker, a
            form, a size band and a model line before it counts — a bar most datasets are too thin
            to clear.
          </p>
        </Sec>

        <Sec paper ord="02" label="The value engine" title={<>What a lot is worth, argued from the sales that resemble it.</>}>
          <p style={p}>
            The engine does not forecast taste. It answers a narrower question with evidence: given
            everything that has actually sold, where should this lot clear — and does the house&rsquo;s
            estimate agree?
          </p>
          <div style={{ margin: '20px 0 0' }}>
            <Step n="01" title="Resolve the object"
              body={<>Every lot is parsed into a structured identity — maker, form, model line, reference, edition, dimensions, year, materials — not just a title string. Two lots match on what they <em>are</em>, never on how a cataloguer chose to describe them.</>} />
            <Step n="02" title="Build the comparable pool"
              body={<>Candidates are scored on title similarity <em>and</em> structural agreement, then put through hard gates: a sofa never comps a chair, a Daytona never comps a Datejust. Pools that don&rsquo;t clear the bar are discarded rather than loosened.</>} />
            <Step n="03" title="Price it, with dispersion"
              body={<>A recency-weighted median over the surviving pool, with a dispersion guard that widens or withdraws the read when comparable sales disagree with each other.</>} />
            <Step n="04" title="Call the direction, and rate the confidence"
              body={<>The output is a directional read — trading below or above where comparables clear — carried with a confidence tier calibrated against{calN ? <> {fmt(calN)} scored observations</> : ' the replay'}, and a band showing how tightly reads at that tier have historically landed.</>} />
          </div>
          <p style={caption}>
            Validated by temporal holdout: every call is made using only sales dated strictly before
            the lot in question, so the record below is what the engine would have said at the time —
            not what it can explain in hindsight.
          </p>
        </Sec>

        <Sec ord="03" label="The record" title={<>The whole thesis, replayed against history.</>}>
          <p style={p}>
            {fmt(F.n)} flagged calls and {fmt(U.n)} unflagged controls, each scored on what the lot
            actually did next. Two bases are published side by side, because they answer different
            questions: <b style={{ color: 'var(--color-fg)' }}>all-in</b> is what a buyer paid,
            including the house&rsquo;s premium; <b style={{ color: 'var(--color-fg)' }}>at hammer</b> strips
            the premium out for a like-for-like comparison against an estimate that never included it.
          </p>
          <div style={{ marginTop: 24 }}>
            <div className="slope-grid">
              <Slope metric="Median vs estimate · all-in" note="what the buyer paid, premium included"
                lo={U.medianPerfPct} hi={F.medianPerfPct} fmtV={pct} n={fmt(F.n)} />
              <Slope metric="Median vs estimate · at hammer" note="like-for-like against a hammer-basis estimate"
                lo={U.hammerMedianPct ?? 0} hi={F.hammerMedianPct ?? 0} fmtV={pct} n={fmt(F.n)} />
              <Slope metric="Cleared the high estimate" note="share of lots that beat the top of the range"
                lo={U.beatHighPct} hi={F.beatHighPct} fmtV={(v) => `${v}%`} n={fmt(F.n)} />
              <Slope metric="Failed to sell" note="lower is better — the flag does not chase no-sales"
                lo={U.failToSellPct} hi={F.failToSellPct} fmtV={(v) => `${v}%`} n={fmt(F.nBoughtIn ?? 0)} better="lower" />
            </div>
          </div>
          <div style={{ marginTop: 22, padding: '18px 20px', border: '1px solid var(--hairline)', borderRadius: 10, background: 'var(--panel)' }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 6 }}>The edge, stated plainly</div>
            <div style={{ fontSize: 15.5, lineHeight: 1.65, color: 'var(--color-text-secondary)' }}>
              <b style={{ color: 'var(--color-up)' }}>{edgeAllIn} points</b> all-in,{' '}
              <b style={{ color: 'var(--color-up)' }}>{edgeHammer} points</b> at hammer, and{' '}
              <b style={{ color: 'var(--color-up)' }}>{edgeBeat} points</b> on the rate of clearing the
              high estimate — flagged over unflagged, on the same replay, over the same period.
            </div>
          </div>
          <p style={caption}>
            Bought-in lots are scored as outcomes rather than dropped, so a flag on something that
            then failed to sell counts against the record. <Link href="/value" className="deck-more">See the full record <Flick size={11} /></Link>
          </p>
        </Sec>

        <Statement
          figure={`+${edgeAllIn} points`}
          lede={<>is what separates a lot lectr flagged from one it didn&rsquo;t — measured across {fmt(F.n)} calls replayed through history, against {fmt(U.n)} controls.</>}
          foot="Flagged lots also failed to sell less often than unflagged ones. The edge is not bought with risk."
        />

        <Sec ord="04" label="The proof" title={<>We said what it was worth. The room paid less.</>}>
          <p style={p}>
            The record above is an aggregate. This is what it looks like as individual lots. In each
            case the engine priced the object from comparable sold evidence — using only sales dated
            strictly <em>before</em> it, so this is what lectr would have said on the day — and the
            hammer then came in under that number.
          </p>
          <div className="proof-grid">
            {proof.cases.filter((c) => !(c as { hero?: boolean }).hero).map((c) => <ProofCase key={c.id} c={c} />)}
          </div>
          <p style={caption}>
            <b style={{ color: 'var(--color-text-muted)' }}>How these were chosen.</b> Of {fmt(PROV.targets)} lots sold
            since 2024 above a $3,000 estimate, the engine priced {fmt(PROV.priced)} from at least eight
            comparable sold lots at non-low confidence — and {fmt(PROV.hits)} of those cleared 30% or more below
            the number. That sweep is exhaustive, not a sample. Four of the six above are drawn from it,
            as is the lot below; the other two come from houses that publish{' '}
            <b style={{ color: 'var(--color-text-muted)' }}>no estimate at all</b> (Goldin, Sotheby&rsquo;s NBA
            auctions), where lectr&rsquo;s figure was the only valuation in existence when the hammer fell.
            That population has not been swept exhaustively, so no rate is claimed for it.
          </p>
        </Sec>

        <HeroLot c={proof.cases.find((x) => (x as { hero?: boolean }).hero) ?? proof.cases[0]} />

        <Sec paper ord="05" label="Restraint" title={<>The number we are proudest of is how often it says nothing.</>}>
          <p style={p}>
            Anything can print a percentage. The expensive part is knowing when a figure isn&rsquo;t
            supported — and refusing to publish it. lectr runs an explicit ladder: a confidence-interval
            index where the data resolves the sign, a measured demand read where coverage allows, and
            below that, no movement number at all.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 20px', margin: '24px 0 0', paddingTop: 22, borderTop: '1px solid var(--hairline)' }}>
            <Stat figure={`${makerPublish} of ${makerTotal}`} label="Makers clear the 95% bar" note="the rest publish no index — the interval doesn't resolve the sign" />
            <Stat figure={`${drillAbstain} of ${drillCount}`} label="Sub-markets abstain" note="tracked and searchable, but carrying no movement claim" />
          </div>
          <p style={caption}>
            Where a market is too thin, too mixed, or too young to hold quality constant, the engine
            says so in the interface instead of estimating around it. Every published figure names its
            method and its sample size.
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

        <Sec ord="06" label="The graph" title={<>One lot, linked to everything that explains it.</>}>
          <p style={p}>
            A price is not an answer on its own. Every lot resolves into a chain you can walk — and
            every step of it is a page, not a footnote.
          </p>

          <ol className="chain">
            <li className="chain-node">
              <span className="chain-k">The lot</span>
              <span className="chain-n">{fmt(meta.totalLots)}</span>
              <span className="chain-v">tracked lots, each with its estimate, its result, and the call that preceded it</span>
            </li>
            <li className="chain-node">
              <span className="chain-k">Its comparables</span>
              <span className="chain-n">{fmt(meta.totalSold)}</span>
              <span className="chain-v">settled sales to argue from — the exact ones used are clickable</span>
            </li>
            <li className="chain-node">
              <span className="chain-k">Its sub-market</span>
              <span className="chain-n">{fmt(drillCount)}</span>
              <span className="chain-v">indices — cards by era and sport, watch families, art kinds, design materials</span>
            </li>
            <li className="chain-node">
              <span className="chain-k">Its maker</span>
              <span className="chain-n">{fmt(makerTotal)}</span>
              <span className="chain-v">quality-controlled indices, published only where the interval resolves</span>
            </li>
            <li className="chain-node">
              <span className="chain-k">Its reference</span>
              <span className="chain-n">{fmt(refCount)}</span>
              <span className="chain-v">dossiers, each with the full yearly series for that model line</span>
            </li>
          </ol>

          <p style={p}>
            Tracked lots keep permanent addresses. A lot the house purges the moment its sale ends
            stays resolvable here — with its estimate, its result, and the call that preceded it —
            which is what makes a three-decade archive usable as evidence rather than nostalgia.
          </p>
        </Sec>

        <Sec ord="07" label="What it changes" title={<>What it changes, for the person holding the paddle.</>}>
          <p style={p}>
            A price is only useful if it changes what someone does. Four people ask the same question
            — what does this actually clear at, and how sure can you be — and get four different days
            out of the answer.
          </p>
          {/* Four people, each shown as the swap they actually make. The
              before/after pair is the composition: this is the section that
              answers what the product changes, and it was the only one on the
              page carrying no structure at all. */}
          <div className="value-list">
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

        <section className="deck-close ray-enter">
          <div className="rail">
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
            </div>
            <p style={{ ...caption, marginTop: 26 }}>
              Figures on this page are read from the live corpus at build time, dated{' '}
              {String(meta.lastCrawl).slice(0, 10)}. They change when the market does.
            </p>
          </div>
        </section>
      </div>
      </RayEntrance>

      <Colophon record={null} />
    </div>
  );
}
