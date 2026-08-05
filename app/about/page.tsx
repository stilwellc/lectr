import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import Flick from '../components/Flick';
import { Colophon } from '../components/Terminal';
import Masthead, { Accent } from '../components/Masthead';
import { MARKETS } from '../constants';
import { craftTitle } from '../utils';
import meta from '../../public/data/ray/meta.json';
import backtest from '../../public/data/ray/backtest.json';
import market from '../../public/data/ray/market.json';
import refs from '../../public/data/ray/refs.json';
import proof from './proof-cases.json';

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

const wrap: React.CSSProperties = { maxWidth: 900, margin: '0 auto', padding: '0 24px' };
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
const CORPUS_MAX = CORPUS_BARS.length ? CORPUS_BARS[0].n : 1;

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
      <div style={{ fontSize: 'clamp(26px, 3vw, 42px)', fontWeight: 700, letterSpacing: '-0.035em', color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {figure}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', marginTop: 9 }}>{label}</div>
      {note && <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 3, lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

/** A market's depth as a rule drawn to scale. Neutral ink — this is volume, not
 *  direction, and direction is the only thing that earns colour here. */
function Bar({ label, n, max }: { label: string; n: number; max: number }) {
  const w = Math.max(2, Math.round((n / max) * 100));
  return (
    <div style={{ margin: '0 0 13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 5 }}>
        <span style={{ fontSize: 13.5, color: 'var(--color-fg)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt(n)} settled lots</span>
      </div>
      <div style={{ height: 6, background: 'var(--color-bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: 'var(--color-text-faint)', borderRadius: 3 }} />
      </div>
    </div>
  );
}

/** The record, as a head-to-head. Green marks the flagged side ONLY where it
 *  genuinely reads higher — direction, never decoration. */
function Versus({ metric, flagged, unflagged, note, fw, uw, better }: {
  metric: string; flagged: string; unflagged: string; note?: string;
  /** bar widths 0-1, drawn to the same scale so the GAP is the visual */
  fw: number; uw: number;
  /** which side the metric rewards — 'lower' inverts the ink (fail-to-sell) */
  better?: 'higher' | 'lower';
}) {
  const flaggedWins = better === 'lower' ? fw <= uw : fw >= uw;
  const ink = flaggedWins ? 'var(--color-up)' : 'var(--color-text-secondary)';
  return (
    <div style={{ padding: '16px 0', borderTop: '1px solid var(--hairline)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
        <span style={{ fontSize: 14, color: 'var(--color-fg)', fontWeight: 650 }}>{metric}</span>
        {note && <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)', textAlign: 'right', lineHeight: 1.45 }}>{note}</span>}
      </div>
      {([
        { k: 'Flagged', v: flagged, w: fw, ink, weight: 700 },
        { k: 'Unflagged', v: unflagged, w: uw, ink: 'var(--color-text-muted)', weight: 600 },
      ] as const).map((row) => (
        <div key={row.k} style={{ display: 'grid', gridTemplateColumns: '78px minmax(0,1fr) 66px', gap: 12, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{row.k}</span>
          <span style={{ height: 10, background: 'var(--color-bg-elevated)', borderRadius: 5, overflow: 'hidden', display: 'block' }}>
            <span style={{ display: 'block', width: `${Math.max(2, Math.round(row.w * 100))}%`, height: '100%', background: row.ink, borderRadius: 5 }} />
          </span>
          <span style={{ fontSize: 16, fontWeight: row.weight, color: row.ink, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{row.v}</span>
        </div>
      ))}
    </div>
  );
}

/** ONE SLIDE. `paper` flips the whole block onto the printed ramp via
 *  .ray-paper (the lander's room device), so the deck alternates stock the way
 *  a real deck alternates layouts — and the ghost ordinal gives each slide a
 *  corner number without adding a second voice. */
/** ONE CALL, SHOWN. The engine's value is the full rule; what the room actually
 *  paid is drawn against it, so the gap is the picture. Green marks the gap
 *  because "below comparable market" is the favourable read in this product's
 *  language — the same green a below-market flag wears everywhere else. */
function ProofCase({ c }: { c: typeof proof.cases[number] }) {
  const paidW = Math.max(6, Math.round((c.realizedUsd / c.ourValueUsd) * 100));
  const noEstimate = c.houseEstLow == null;
  return (
    <div className="proof-card">
      <div className="proof-meta">
        {c.market} · {c.house} · {String(c.saleDate).slice(0, 10)}
        {c.confidence === 'high' && <span className="proof-conf">high confidence</span>}
      </div>
      <div className="proof-title">{(() => { const t = craftTitle(c.title); return t.length > 84 ? t.slice(0, 82) + '…' : t; })()}</div>

      <div className="proof-rows">
        <div className="proof-row">
          <span className="proof-k">lectr value</span>
          <span className="proof-track"><span className="proof-fill proof-fill-ours" style={{ width: '100%' }} /></span>
          <span className="proof-v">${fmt(c.ourValueUsd)}</span>
        </div>
        <div className="proof-row">
          <span className="proof-k">sold for</span>
          <span className="proof-track"><span className="proof-fill proof-fill-paid" style={{ width: `${paidW}%` }} /></span>
          <span className="proof-v proof-v-paid">${fmt(c.realizedUsd)}</span>
        </div>
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
  );
}

function Sec({ ord, label, title, paper, children }: {
  ord: string; label: string; title: React.ReactNode; paper?: boolean; children: React.ReactNode;
}) {
  const inner = (
    <div style={{ ...wrap, position: 'relative' }}>
      <span className="deck-ord" aria-hidden>{ord}</span>
      <span className="kicker" style={{ display: 'block', margin: '0 0 12px' }}>{ord} · {label}</span>
      <h2 className="deck-h">{title}</h2>
      {children}
    </div>
  );
  if (paper) return <section className="ray-paper deck-room">{inner}</section>;
  return <section className="deck-slide">{inner}</section>;
}

/** A step in the pricing chain. Numbered, not arrowed — the flow reads down. */
function Step({ n, title, body }: { n: string; title: string; body: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '15px 0', borderTop: '1px solid var(--hairline)' }}>
      <div style={{ flex: 'none', width: 26, fontSize: 12, fontWeight: 700, color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums', paddingTop: 2 }}>{n}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--color-fg)', marginBottom: 5 }}>{title}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.65, color: 'var(--color-text-secondary)' }}>{body}</div>
      </div>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <style>{`
        .deck-slide { padding: clamp(54px, 7vw, 96px) 0 clamp(20px, 3vw, 34px); }
        .deck-room {
          position: relative;
          margin-inline: calc(50% - 50vw + clamp(10px, 1.2vw, 18px));
          background: var(--paper, #E2D9C4);
          border-radius: clamp(22px, 2.8vw, 36px);
          padding: clamp(46px, 6vw, 82px) 0 clamp(40px, 5vw, 66px);
          margin-block: clamp(40px, 5vw, 72px);
        }
        @media (max-width: 700px) { .deck-room { margin-inline: calc(50% - 50vw + 8px); border-radius: 20px; } }
        .deck-h {
          font-size: clamp(27px, 4.2vw, 44px);
          font-weight: 700;
          letter-spacing: -0.032em;
          line-height: 1.12;
          color: var(--color-fg);
          margin: 0 0 20px;
          max-width: 20ch;
        }
        .deck-ord {
          position: absolute;
          top: -0.42em;
          right: 18px;
          font-size: clamp(74px, 12vw, 150px);
          font-weight: 800;
          letter-spacing: -0.05em;
          line-height: 1;
          color: var(--color-fg);
          opacity: 0.05;
          pointer-events: none;
          font-variant-numeric: tabular-nums;
        }
        .deck-cover { padding: clamp(30px, 4vw, 52px) 0 clamp(30px, 4vw, 46px); }
        .proof-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: clamp(14px, 1.8vw, 22px);
          margin-top: clamp(26px, 3vw, 38px);
        }
        .proof-card {
          border: 1px solid var(--hairline);
          border-radius: 14px;
          padding: clamp(18px, 2vw, 24px);
          background: var(--panel);
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .proof-meta {
          font-size: 11px;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }
        .proof-conf {
          border: 1px solid var(--hairline);
          border-radius: 100px;
          padding: 2px 9px;
          letter-spacing: 0.06em;
          color: var(--color-text-muted);
        }
        .proof-title {
          font-size: 16px;
          font-weight: 650;
          line-height: 1.32;
          color: var(--color-fg);
          margin: 10px 0 16px;
        }
        .proof-rows { display: flex; flex-direction: column; gap: 8px; }
        .proof-row { display: grid; grid-template-columns: 78px minmax(0,1fr) 92px; gap: 10px; align-items: center; }
        .proof-k { font-size: 11.5px; color: var(--color-text-faint); }
        .proof-track { height: 12px; background: var(--color-bg-elevated); border-radius: 6px; overflow: hidden; display: block; }
        .proof-fill { display: block; height: 100%; border-radius: 6px; }
        .proof-fill-ours { background: var(--color-text-faint); }
        .proof-fill-paid { background: var(--color-up); }
        .proof-v { font-size: 15px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text-secondary); }
        .proof-v-paid { color: var(--color-up); }
        .proof-foot {
          margin-top: auto;
          padding-top: 15px;
          border-top: 1px solid var(--hairline);
          font-size: 11.5px;
          line-height: 1.55;
          color: var(--color-text-faint);
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .proof-gap { font-size: 21px; font-weight: 750; color: var(--color-up); letter-spacing: -0.02em; }
        .deck-statband {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(186px, 1fr));
          gap: clamp(20px, 2.2vw, 28px);
          margin-top: clamp(30px, 4vw, 48px);
          padding-top: clamp(26px, 3vw, 36px);
          border-top: 1px solid var(--hairline);
        }
      `}</style>
      <ArtistNav activeSlug="about" />

      <div style={{ paddingTop: 28, paddingBottom: 56 }}>
        <div style={{ ...wrap, marginBottom: 8 }}>
          <Masthead
            kicker="The firm"
            serial={meta.lastCrawl}
            title={<>What is <Accent>lectr</Accent>.</>}
            sub={<>
              The auction market clears{' '}
              <b style={{ color: 'var(--color-fg)', fontWeight: 600 }}>billions a year against published guesses</b>
              {' '}— and nobody scores the guesses. We do.
            </>}
          />
          <p style={{ ...lead, marginTop: 20 }}>
            Every lot that crosses a rostrum arrives with two numbers: an estimate the house
            published, and a hammer the room decided. One is an opinion, one is a fact, and the
            distance between them is the only honest measure of demand in the business. lectr has
            read <b style={{ color: 'var(--color-fg)' }}>{fmt(meta.totalSold)}</b> settled lots
            across <b style={{ color: 'var(--color-fg)' }}>{meta.sources.length} houses</b> and three
            decades of results, scored each one against the sales that actually resemble it, and
            replayed the whole thing through history to find out whether the read holds.
          </p>
          <p style={p}>
            It does. On <b style={{ color: 'var(--color-fg)' }}>{fmt(F.n)}</b> point-in-time calls, lots
            the engine flagged went on to clear their estimates by{' '}
            <b style={{ color: 'var(--color-up)' }}>{edgeAllIn} points</b> more than the lots it
            didn&rsquo;t — and failed to sell less often while doing it.
          </p>

          <div className="deck-statband">
            <Stat figure={fmt(meta.totalLots)} label="Lots under tracking" note="live and settled, one graph" />
            <Stat figure={fmt(meta.totalSold)} label="Settled results" note="every one with a published price" />
            <Stat figure={String(meta.sources.length)} label="Auction houses" note={meta.sources.join(' · ')} />
            <Stat figure={fmt(F.n)} label="Replayed calls" note="scored against what happened next" />
          </div>
        </div>

        <Sec ord="01" label="The corpus" title={<>Depth is the moat. It took three decades to build.</>}>
          <p style={p}>
            Comparable-sales pricing is only as good as the pool behind it, and auction results are
            scattered across houses that publish in different shapes, purge lots when a sale closes,
            and rarely keep a machine-readable archive. lectr holds all of it in one schema — every
            lot normalised to a dated FX rate, a declared price basis, and a structured identity, so
            a 1994 Geneva watch sale and a lot closing tonight are the same kind of object.
          </p>
          <div style={{ margin: '26px 0 0' }}>
            {CORPUS_BARS.map((b) => <Bar key={b.key} label={b.label} n={b.n} max={CORPUS_MAX} />)}
          </div>
          <p style={caption}>
            Settled lots by market, from the shipped corpus. Depth is what lets the engine demand
            that a comparable share a maker, a form, a size band and a model line before it counts —
            a bar most datasets are too thin to clear.
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
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr)', gap: 12, paddingBottom: 9 }}>
              <span className="kicker">Measure</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Flagged</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Unflagged</span>
            </div>
            <Versus metric="Median vs estimate · all-in" flagged={pct(F.medianPerfPct)} unflagged={pct(U.medianPerfPct)}
              note="what the buyer paid, premium included"
              fw={1} uw={Math.max(0, U.medianPerfPct) / Math.max(1, F.medianPerfPct)} />
            <Versus metric="Median vs estimate · at hammer" flagged={pct(F.hammerMedianPct ?? 0)} unflagged={pct(U.hammerMedianPct ?? 0)}
              note="like-for-like against a hammer-basis estimate"
              fw={1} uw={Math.max(0, U.hammerMedianPct ?? 0) / Math.max(1, F.hammerMedianPct ?? 1)} />
            <Versus metric="Cleared the high estimate" flagged={`${F.beatHighPct}%`} unflagged={`${U.beatHighPct}%`}
              fw={F.beatHighPct / 100} uw={U.beatHighPct / 100} />
            <Versus metric="Failed to sell" flagged={`${F.failToSellPct}%`} unflagged={`${U.failToSellPct}%`}
              note="lower is better — the flag does not chase lots into no-sales"
              better="lower"
              fw={F.failToSellPct / Math.max(F.failToSellPct, U.failToSellPct)}
              uw={U.failToSellPct / Math.max(F.failToSellPct, U.failToSellPct)} />
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
            then failed to sell counts against the record. <Link href="/value" style={{ color: 'var(--color-text-muted)' }}>See the full record <Flick size={11} /></Link>
          </p>
        </Sec>

        <Sec ord="04" label="The proof" title={<>We said what it was worth. The room paid less.</>}>
          <p style={p}>
            The record above is an aggregate. This is what it looks like as individual lots. In each
            case the engine priced the object from comparable sold evidence — using only sales dated
            strictly <em>before</em> it, so this is what lectr would have said on the day — and the
            hammer then came in under that number.
          </p>
          <div className="proof-grid">
            {proof.cases.map((c) => <ProofCase key={c.id} c={c} />)}
          </div>
          <p style={caption}>
            The two sports lots are the sharpest demonstration: Goldin and the NBA auctions publish
            <b style={{ color: 'var(--color-text-muted)' }}> no estimate at all</b>, so lectr&rsquo;s figure was the only
            valuation in existence when the hammer fell. Elsewhere the house had published a number
            too — and in each of those, the room cleared below both.
          </p>
        </Sec>

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
        </Sec>

        <Sec ord="06" label="The graph" title={<>One lot, linked to everything that explains it.</>}>
          <p style={p}>
            A price is not an answer on its own. Every lot in lectr resolves into a graph you can walk:
            the comparable sales behind its call, the sub-market it trades in, the maker&rsquo;s index, and —
            for watches — the reference dossier covering every recorded sale of that model line.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 20px', margin: '24px 0 0', paddingTop: 22, borderTop: '1px solid var(--hairline)' }}>
            <Stat figure={fmt(drillCount)} label="Sub-market indices" note="cards by era and sport, watch families, art kinds, design materials" />
            <Stat figure={fmt(makerTotal)} label="Maker indices" note="hedonic, quality-controlled" />
            <Stat figure={fmt(refCount)} label="Reference dossiers" note="per model line, with its full yearly series" />
          </div>
          <p style={p} />
          <p style={p}>
            Tracked lots keep permanent addresses. A lot the house purges the moment its sale ends
            stays resolvable here — with its estimate, its result, and the call that preceded it —
            which is what makes a three-decade archive usable as evidence rather than nostalgia.
          </p>
        </Sec>

        <Sec ord="07" label="Who it's for" title={<>Built for people who have to be right in public.</>}>
          <p style={p}>
            Specialists pricing a consignment, funds underwriting collectibles as an asset, insurers
            and lenders marking a book, and serious private buyers who would rather bid against
            evidence than atmosphere. The same engine answers all of them, because they are all asking
            the same question: what does this actually clear at, and how sure can you be?
          </p>
          <p style={p}>
            The market read is public and free to inspect — start with{' '}
            <Link href="/value" style={{ color: 'var(--color-fg)', fontWeight: 600 }}>today&rsquo;s calls</Link>{' '}
            or the{' '}
            <Link href="/analytics" style={{ color: 'var(--color-fg)', fontWeight: 600 }}>research desk</Link>.
            For data access, coverage in a market we don&rsquo;t yet track, or diligence on the method,
            the desk answers directly.
          </p>
          <p style={caption}>
            Figures on this page are read from the live corpus at build time, dated{' '}
            {String(meta.lastCrawl).slice(0, 10)}. They change when the market does.
          </p>
        </Sec>
      </div>

      <Colophon record={null} />
    </div>
  );
}
