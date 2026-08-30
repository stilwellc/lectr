'use client';

/**
 * THE STYLEGUIDE — every north-star primitive rendered once, on one page.
 * Two jobs: (1) taste decisions get made HERE first, against the real
 * tokens, before they ship to a surface; (2) the nightly screenshot rig
 * captures this route, so any drift in the primitives shows up as one
 * diff. Not linked from the nav; noindex. docs/NORTHSTAR_UI.md is the law
 * this page demonstrates.
 */

import Masthead from '../components/Masthead';
import FigCap from '../components/FigCap';
import {
  CellGrid, Cell, ColorCell, FigureCell, StatRow, AnnoChip,
  FigReplay, FigPools, FigCorpus, FigGate, FigCalib, FigTape,
} from '../components/cells';
import { useState } from 'react';

function Room({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="ns-plate" style={{ margin: '44px 0 0', paddingTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <h2 className="ray-h2">{title}</h2>
        {note && <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', textAlign: 'right' }}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

export default function Styleguide() {
  const [tab, setTab] = useState(0);
  return (
    <div className="terminal-shell" style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div className="rail" style={{ paddingTop: 40, paddingBottom: 96, maxWidth: 1200 }}>
        <Masthead
          kicker="Internal"
          title="The styleguide."
          sub={<>Every primitive once — taste gets decided here before it ships. The law lives in docs/NORTHSTAR_UI.md.</>}
        />

        <Room title="Type" note="authority through lightness — display never exceeds 400">
          <div style={{ display: 'grid', gap: 14 }}>
            <span style={{ fontSize: 52, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.06 }}>Display 300 · the page statement</span>
            <span style={{ fontSize: 30, fontWeight: 350, letterSpacing: '-0.025em' }}>Room head 350 · .ray-h2</span>
            <span className="ns-kicker" style={{ marginBottom: 0 }}>The kicker — quiet gray, sentence case, never tracked</span>
            <span style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--color-text-secondary)', maxWidth: 560 }}>
              Body secondary at 15/1.6 — the reading voice. Numerals that count money ride the mono register:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-fg)' }}>1,122,103</span>.
            </span>
          </div>
        </Room>

        <Room title="Controls" note="pill geometry · 150ms house curve · scale(0.98) press">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <button className="ray-call-btn ray-call-btn-primary" type="button">Primary ink</button>
            <button className="ray-call-btn ray-call-btn-quiet" type="button">Ring quiet</button>
            <span className="ray-call-btn" style={{ background: 'var(--color-bg-deep)', color: 'var(--color-fg)', cursor: 'default' }}>Cream tertiary</span>
          </div>
        </Room>

        <Room title="The ledgers" note="byline · dotted spec rows">
          <div className="ns-byline" style={{ marginBottom: 22 }}>
            <div><span className="k">On the book</span><span className="v">1,122,103</span></div>
            <div><span className="k">Sub-markets tracked</span><span className="v">100</span></div>
            <div><span className="k">The record</span><span className="v" style={{ color: 'var(--color-up)' }}>+41%</span></div>
            <div><span className="k">Makers ranked</span><span className="v">54</span></div>
          </div>
          <div style={{ maxWidth: 560 }}>
            <div className="ns-ledger-row"><span style={{ color: 'var(--color-text-muted)', fontSize: 13.5 }}>Price movement</span><span style={{ fontSize: 13.5 }}>hedonic, IRLS-weighted, refit nightly</span></div>
            <div className="ns-ledger-row"><span style={{ color: 'var(--color-text-muted)', fontSize: 13.5 }}>The record</span><span style={{ fontSize: 13.5 }}>every flag replayed, never backfilled</span></div>
            <div className="ns-ledger-row"><span style={{ color: 'var(--color-text-muted)', fontSize: 13.5 }}>Data</span><span style={{ fontSize: 13.5 }}>public results, 17 houses</span></div>
          </div>
        </Room>

        <Room title="The cells" note="quiet numeral cells · ONE forced-color cell per grid · lamp-lawful dirs">
          <CellGrid min={260}>
            <ColorCell dir="up" span={2} stat="4.6×" label="The color cell · up" body="Omnichannel atmosphere, pixel-static grain, right-oriented read." href="#" />
            <Cell stat="158" statNote="flagged on the book tonight" mark={<FigGate size={96} />} label="Quiet cell" body="Big mono numeral leads; the figure watermarks the corner." href="#" />
            <ColorCell dir="down" stat="−12%" label="The color cell · down" body="The red ground exists only for a real down-read." />
            <ColorCell dir="ink" stat="3,141" label="The color cell · ink" body="Neutral drama when no direction is earned." />
          </CellGrid>
        </Room>

        <Room title="The figures" note="patent drawings — 1px solid ink + dotted construction">
          <CellGrid min={220}>
            <FigureCell figure={<FigReplay />} label="FigReplay" body="The replay — a hammer curve past its estimate." />
            <FigureCell figure={<FigPools />} label="FigPools" body="The comp pool — nested rings, one lot marked." />
            <FigureCell figure={<FigCorpus />} label="FigCorpus" body="The corpus — a wireframe archive cube." />
            <FigureCell figure={<FigGate />} label="FigGate" body="The gate — many in, one call leaves." />
            <FigureCell figure={<FigCalib />} label="FigCalib" body="Calibration — dotted promise, solid measure." />
            <FigureCell figure={<FigTape />} label="FigTape" body="The tape — one result steps off the line." />
          </CellGrid>
        </Room>

        <Room title="The cockpit grammar" note="stat tabs w/ active underline · annotation chip">
          <div className="glass glass-quiet" style={{ padding: 'var(--card-pad)', maxWidth: 640 }}>
            <StatRow
              active={tab}
              onSelect={setTab}
              stats={[
                { label: 'Sell-through', value: '99%' },
                { label: 'Market depth', value: '44,508' },
                { label: 'Hottest month', value: 'Jan +4%' },
              ]}
            />
            <div style={{ position: 'relative', height: 120, borderBottom: '1px solid var(--chart-grid)' }}>
              <svg width="100%" height="120" preserveAspectRatio="none" viewBox="0 0 600 120">
                <polyline points="0,80 60,78 120,84 180,70 240,40 300,52 360,66 420,60 480,58 540,50 600,44" fill="none" stroke="var(--color-fg)" strokeWidth="1.6" />
              </svg>
              <span style={{ position: 'absolute', right: 8, top: 4 }}>
                <AnnoChip k="2026 Q2" v={tab === 1 ? '44,508 settled' : '99% found a buyer'} dir="up" />
              </span>
            </div>
            <FigCap>The styleguide's dummy pane — the shape is the spec, the numbers are props.</FigCap>
          </div>
        </Room>

        <Room title="Wells & plates" note="cream explains · white measures">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div className="ns-well">
              <div className="ns-well-label">The cream well</div>
              <div className="ns-well-body">Explanation surfaces — borderless, gray label over ink body.</div>
            </div>
            <div className="glass glass-quiet" style={{ padding: 'var(--card-pad)' }}>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>The white card</div>
              <div style={{ fontSize: 14.5 }}>Instruments — data lives on white with the lift shadow.</div>
            </div>
          </div>
        </Room>
      </div>
    </div>
  );
}
