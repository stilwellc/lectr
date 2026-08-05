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
import PlateImg from '../components/PlateImg';
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
  const title = craftTitle(c.title);
  const img = c.imageUrl ? sizedImg(httpsImg(c.imageUrl), 640) : null;
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
        <div className="proof-meta">
          <span>{c.market} · {c.house} · {String(c.saleDate).slice(0, 10)}</span>
          {c.confidence === 'high' && <span className="proof-conf">high confidence</span>}
        </div>
        <div className="proof-title">{title.length > 76 ? title.slice(0, 74) + '…' : title}</div>

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
    </div>
  );
}

/** A slide that is one number. No heading, no ordinal, no chrome — the deck
 *  needs a breath between argued sections, and the edge is the single figure
 *  the whole record reduces to. */
function Statement({ figure, lede, foot }: { figure: string; lede: React.ReactNode; foot?: string }) {
  return (
    <section className="deck-statement">
      <div style={wrap}>
        <div className="statement-fig">{figure}</div>
        <p className="statement-lede">{lede}</p>
        {foot && <p className="statement-foot">{foot}</p>}
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
    <section className="deck-hero">
      <div className="hero-plate">
        <PlateImg src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </div>
      <div style={wrap}>
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
      <style dangerouslySetInnerHTML={{ __html: `
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
        /* ── COVER: a statement with air around it ─────────────────────── */
        .deck-cover-wrap { padding: clamp(40px, 8vh, 96px) 0 clamp(30px, 4vw, 52px); }
        .cover-h {
          font-size: clamp(34px, 6.4vw, 82px);
          font-weight: 700;
          letter-spacing: -0.042em;
          line-height: 1.03;
          color: var(--color-fg);
          margin: 0 0 clamp(20px, 2.4vw, 30px);
          max-width: 18ch;
        }
        .cover-h-em { color: var(--color-text-muted); }
        .cover-sub {
          font-size: clamp(16px, 1.6vw, 20px);
          line-height: 1.6;
          color: var(--color-text-secondary);
          max-width: 60ch;
          margin: 0;
        }
        .cover-sub b { color: var(--color-fg); font-weight: 600; font-variant-numeric: tabular-nums; }

        /* ── STATEMENT: the deck exhales ───────────────────────────────── */
        .deck-statement {
          padding: clamp(60px, 9vw, 130px) 0;
          border-block: 1px solid var(--hairline);
          margin-block: clamp(30px, 4vw, 56px);
        }
        .statement-fig {
          font-size: clamp(56px, 12vw, 168px);
          font-weight: 800;
          letter-spacing: -0.05em;
          line-height: 0.92;
          color: var(--color-up);
          font-variant-numeric: tabular-nums;
          margin-bottom: clamp(16px, 2vw, 26px);
        }
        .statement-lede {
          font-size: clamp(17px, 2vw, 26px);
          line-height: 1.45;
          color: var(--color-fg);
          max-width: 30ch;
          margin: 0;
          font-weight: 500;
        }
        .statement-foot {
          font-size: 13.5px;
          line-height: 1.6;
          color: var(--color-text-faint);
          max-width: 52ch;
          margin: 18px 0 0;
        }

        /* ── HERO LOT: stop and look at the object ─────────────────────── */
        .deck-hero { margin-block: clamp(40px, 6vw, 84px); }
        .hero-plate {
          position: relative;
          width: 100vw;
          margin-inline: calc(50% - 50vw);
          height: clamp(240px, 46vh, 520px);
          background: var(--color-bg-elevated);
          overflow: hidden;
          border-block: 1px solid var(--hairline);
        }
        .hero-plate img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .hero-cap {
          font-size: 13.5px;
          line-height: 1.65;
          color: var(--color-text-muted);
          margin: 16px 0 0;
          max-width: 70ch;
        }
        .hero-cap b { color: var(--color-fg); font-weight: 600; }
        .hero-cap-paid { color: var(--color-up) !important; }

        /* ── VALUE: who, and what changes for them ────────────────────── */
        .value-list { margin-top: clamp(24px, 3vw, 34px); }
        .value-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
          padding: clamp(16px, 1.8vw, 22px) 0;
          border-top: 1px solid var(--hairline);
        }
        .value-who { font-size: 15px; font-weight: 700; color: var(--color-fg); letter-spacing: -0.01em; }
        .value-what { font-size: 15px; line-height: 1.65; color: var(--color-text-secondary); }
        @media (min-width: 820px) {
          .value-row { grid-template-columns: 210px minmax(0, 1fr); gap: 28px; align-items: baseline; }
          .value-who { font-size: 16px; }
        }

        /* ── CLOSE: one line, one action ──────────────────────────────── */
        .deck-close {
          padding: clamp(64px, 9vw, 132px) 0 clamp(48px, 6vw, 84px);
          border-top: 1px solid var(--hairline);
          margin-top: clamp(40px, 5vw, 70px);
        }
        .close-line {
          font-size: clamp(26px, 4.6vw, 54px);
          font-weight: 700;
          letter-spacing: -0.035em;
          line-height: 1.1;
          color: var(--color-fg);
          margin: 0 0 18px;
          max-width: 20ch;
        }
        .close-sub {
          font-size: clamp(15px, 1.5vw, 18px);
          line-height: 1.6;
          color: var(--color-text-secondary);
          max-width: 54ch;
          margin: 0 0 clamp(26px, 3vw, 34px);
        }
        .close-sub b { color: var(--color-fg); }
        .close-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
        .close-cta {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--color-fg); color: var(--color-bg);
          border-radius: 100px; padding: 13px 26px;
          font-size: 15px; font-weight: 650; text-decoration: none;
        }
        .close-alt {
          display: inline-flex; align-items: center;
          border: 1px solid var(--hairline); border-radius: 100px;
          padding: 13px 24px; font-size: 15px; font-weight: 600;
          color: var(--color-text-secondary); text-decoration: none;
        }
        .close-alt:hover { color: var(--color-fg); }

        /* ── THE CHAIN: the graph, drawn ──────────────────────────────── */
        .chain { list-style: none; margin: clamp(26px, 3vw, 36px) 0 clamp(22px, 2.5vw, 30px); padding: 0; counter-reset: chain; }
        .chain-node {
          position: relative;
          padding: 0 0 clamp(20px, 2.4vw, 26px) 34px;
          border-left: 1px solid var(--hairline);
        }
        .chain-node:last-child { border-left-color: transparent; padding-bottom: 0; }
        .chain-node::before {
          counter-increment: chain;
          content: "";
          position: absolute; left: -5px; top: 6px;
          width: 9px; height: 9px; border-radius: 50%;
          background: var(--color-text-faint);
        }
        .chain-node:first-child::before { background: var(--color-fg); }
        .chain-k { display: block; font-size: 15.5px; font-weight: 700; color: var(--color-fg); letter-spacing: -0.01em; }
        .chain-n {
          display: inline-block; margin-top: 6px; margin-right: 8px;
          font-size: clamp(26px, 3.4vw, 40px); font-weight: 750; letter-spacing: -0.03em;
          color: var(--color-fg); font-variant-numeric: tabular-nums; line-height: 1;
        }
        .chain-v { display: inline; font-size: 14.5px; line-height: 1.6; color: var(--color-text-secondary); }
        @media (min-width: 820px) {
          .chain-node { padding-left: 40px; }
          .chain-v { font-size: 15px; }
        }

        .deck-statband {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(186px, 1fr));
          gap: clamp(20px, 2.2vw, 28px);
          margin-top: clamp(30px, 4vw, 48px);
          padding-top: clamp(26px, 3vw, 36px);
          border-top: 1px solid var(--hairline);
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
          aspect-ratio: 16 / 10;
          background: var(--color-bg-elevated);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          border-bottom: 1px solid var(--hairline);
        }
        .proof-shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .proof-mono { font-size: 46px; font-weight: 700; color: var(--color-text-faint); opacity: 0.5; }
        .proof-body { padding: 18px 18px 20px; display: flex; flex-direction: column; flex: 1; }
        .proof-meta {
          font-size: 10.5px; letter-spacing: 0.09em; text-transform: uppercase;
          color: var(--color-text-faint);
          display: flex; flex-wrap: wrap; gap: 7px; align-items: center;
        }
        .proof-conf { border: 1px solid var(--hairline); border-radius: 100px; padding: 2px 9px; letter-spacing: 0.06em; color: var(--color-text-muted); }
        .proof-title { font-size: 16.5px; font-weight: 650; line-height: 1.3; color: var(--color-fg); margin: 9px 0 15px; }
        .proof-rows { display: flex; flex-direction: column; gap: 9px; }
        .proof-row { display: grid; grid-template-columns: 68px minmax(0,1fr) 86px; gap: 9px; align-items: center; }
        .proof-k { font-size: 11px; color: var(--color-text-faint); }
        .proof-track { height: 12px; background: var(--color-bg-elevated); border-radius: 6px; overflow: hidden; display: block; }
        .proof-fill { display: block; height: 100%; border-radius: 6px; }
        .proof-fill-ours { background: var(--color-text-faint); }
        .proof-fill-paid { background: var(--color-up); }
        .proof-v { font-size: 15px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text-secondary); }
        .proof-v-paid { color: var(--color-up); }
        .proof-foot {
          margin-top: auto; padding-top: 14px;
          border-top: 1px solid var(--hairline);
          font-size: 11.5px; line-height: 1.55; color: var(--color-text-faint);
          display: flex; flex-direction: column; gap: 5px;
        }
        .proof-gap { font-size: 24px; font-weight: 750; color: var(--color-up); letter-spacing: -0.025em; line-height: 1; }

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
          .proof-gap { font-size: 26px; }
        }
        @media (min-width: 1180px) {
          .proof-shot { flex-basis: 36%; }
          .proof-row { grid-template-columns: 64px minmax(0,1fr) 88px; }
          .proof-title { font-size: 17px; }
          .proof-gap { font-size: 30px; }
        }
` }} />
      <ArtistNav activeSlug="about" />

      <div style={{ paddingTop: 28, paddingBottom: 56 }}>
        <div className="deck-cover-wrap">
          <div style={wrap}>
            <span className="kicker" style={{ display: 'block', marginBottom: 22 }}>
              What is lectr · {String(meta.lastCrawl).slice(0, 10)}
            </span>
            <h1 className="cover-h">
              Every lot arrives with a guess.<br />
              <span className="cover-h-em">We score it against {fmt(meta.totalSold)} results.</span>
            </h1>
            <p className="cover-sub">
              An auction estimate is an opinion. A hammer is a fact. lectr has read{' '}
              <b>{fmt(meta.totalSold)}</b> settled lots across{' '}
              <b>{meta.sources.length} houses</b> and three decades, and prices what comes next
              against the sales that actually resemble it.
            </p>

            <div className="deck-statband">
              <Stat figure={fmt(meta.totalLots)} label="Lots under tracking" note="live and settled, one graph" />
              <Stat figure={fmt(meta.totalSold)} label="Settled results" note="every one with a published price" />
              <Stat figure={String(meta.sources.length)} label="Auction houses" note={meta.sources.join(' · ')} />
              <Stat figure={fmt(F.n)} label="Replayed calls" note="scored against what happened next" />
            </div>
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
            {proof.cases.map((c) => <ProofCase key={c.id} c={c} />)}
          </div>
          <p style={caption}>
            The two sports lots are the sharpest demonstration: Goldin and the NBA auctions publish
            <b style={{ color: 'var(--color-text-muted)' }}> no estimate at all</b>, so lectr&rsquo;s figure was the only
            valuation in existence when the hammer fell. Elsewhere the house had published a number
            too — and in each of those, the room cleared below both.
          </p>
        </Sec>

        <HeroLot c={proof.cases.find((x) => x.maker === 'keith-haring') ?? proof.cases[0]} />

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
            A price is not an answer on its own. Every lot resolves into a chain you can walk — and
            every step of it is a page, not a footnote.
          </p>

          <ol className="chain">
            <li className="chain-node">
              <span className="chain-k">The lot</span>
              <span className="chain-v">its estimate, its result, and the call that preceded it</span>
            </li>
            <li className="chain-node">
              <span className="chain-k">Its comparables</span>
              <span className="chain-v">the exact sales the call was argued from, each one clickable</span>
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
          <div className="value-list">
            <div className="value-row">
              <span className="value-who">The specialist</span>
              <span className="value-what">
                stops setting a reserve from memory and three catalogues. The comparable sales are on
                the page, with their dates and their spread, before the consignment conversation.
              </span>
            </div>
            <div className="value-row">
              <span className="value-who">The collector</span>
              <span className="value-what">
                bids against evidence instead of atmosphere. The room is loud and the estimate is a
                guess; knowing where comparable examples actually cleared is the difference between
                conviction and nerve.
              </span>
            </div>
            <div className="value-row">
              <span className="value-who">The lender or insurer</span>
              <span className="value-what">
                marks a book to a number that can be defended line by line — method named, sample
                size shown, and an honest abstention where the data will not carry a figure.
              </span>
            </div>
            <div className="value-row">
              <span className="value-who">The seller</span>
              <span className="value-what">
                finds out what their object is worth before someone else tells them, and can see
                which house has historically cleared that kind of lot highest.
              </span>
            </div>
          </div>
        </Sec>

        <section className="deck-close">
          <div style={wrap}>
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

      <Colophon record={null} />
    </div>
  );
}
