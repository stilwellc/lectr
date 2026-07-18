'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import CountUp from './CountUp';
import Flick from './Flick';
import { formatPrice } from '../utils';

/**
 * ApprBarometer — the lander's appreciation panel as a PRINTED INSTRUMENT
 * CARD: an ink-drawn barometer gauge on the paper block (needle swings to the
 * market's sales-weighted appreciation), certificate double-rules, and
 * dotted-leader stat rows like a printed appraisal slip. Ink only — the
 * paper band's token flip supplies every color.
 *
 * Two faces from one component:
 *   .ray-baro-desktop — the full portrait certificate (≥900px)
 *   .ray-baro-pocket  — a compact landscape POCKET BAROMETER (<900px):
 *     half-arc gauge on the left, certificate column on the right, one
 *     dotted-leader row, dated microtype footer. Replaces the old sentence
 *     banner so the mobile majority gets the instrument too.
 */
export default function ApprBarometer({
  value, marketName, typical, record, typicalLabel = 'Typical sale, past year', serial,
}: {
  value: number;                                 // appreciation %, e.g. 21.7
  marketName: string;
  typical: number | null;                        // 12-month median sale
  record: { priceUsd: number; maker: string } | null;
  typicalLabel?: string;                         // bid markets pass 'Typical sale, recent'
  /** the edition serial (YYYYMMDD, lastCrawl-derived) — ONE date across the
   *  page's instruments. Falls back to the client clock when absent. */
  serial?: string;
}) {
  // needle: clamp ±40% → ±80° from vertical; start parked at the low stop
  const clamped = Math.max(-40, Math.min(40, value));
  const target = (clamped / 40) * 80;
  const [angle, setAngle] = useState(-80);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setAngle(target); return; }
    const t = setTimeout(() => setAngle(target), 120);
    return () => clearTimeout(t);
  }, [target]);

  // sub-480px third face: one ruled paper line; tap swaps in the full pocket
  // card, tap again folds it back. 480–899px keeps the pocket card untouched.
  const [tiny, setTiny] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 479px)');
    const apply = () => setTiny(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const up = value >= 0;
  const heat = up ? 'var(--paper-up)' : 'var(--paper-down)';
  const serialText = serial ? `no. ${serial}` : '';
  const swing = 'transform 1100ms cubic-bezier(0.22, 0.9, 0.24, 1)';
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;

  /* ————— portrait face geometry ————— */
  const CX = 120, CY = 118, R = 88;
  const pt = (deg: number, r: number) => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))] as const;
  const arcPath = (a0: number, a1: number, r: number) => {
    const [x0, y0] = pt(a0, r); const [x1, y1] = pt(a1, r);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const ticks = [];
  for (let v = -40; v <= 40; v += 10) {
    const a = (v / 40) * 80;
    const major = v % 20 === 0;
    const [x0, y0] = pt(a, R - (major ? 12 : 7));
    const [x1, y1] = pt(a, R);
    ticks.push(<line key={v} x1={x0} y1={y0} x2={x1} y2={y1} stroke="currentColor" strokeWidth={major ? 1.4 : 0.8} opacity={major ? 0.55 : 0.3} />);
  }
  const [nx, ny] = pt(0, R - 20); // needle drawn vertical, rotated via CSS

  /* ————— pocket face geometry — same dial language, ~1/2 scale ————— */
  const PX = 60, PY = 66, PR = 46;
  const ppt = (deg: number, r: number) => [PX + r * Math.cos(rad(deg)), PY + r * Math.sin(rad(deg))] as const;
  const parc = (a0: number, a1: number, r: number) => {
    const [x0, y0] = ppt(a0, r); const [x1, y1] = ppt(a1, r);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const pticks = [];
  for (let v = -40; v <= 40; v += 20) {           // majors only on the pocket dial
    const a = (v / 40) * 80;
    const [x0, y0] = ppt(a, PR - 8);
    const [x1, y1] = ppt(a, PR);
    pticks.push(<line key={v} x1={x0} y1={y0} x2={x1} y2={y1} stroke="currentColor" strokeWidth={1.2} opacity={0.55} />);
  }
  const [pnx, pny] = ppt(0, PR - 13);

  const microcap: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' };
  const footRow: CSSProperties = {
    borderTop: '1px solid var(--paper-line)', display: 'flex', justifyContent: 'space-between',
    fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-muted)',
  };

  return (
    <>
      {/* face switch — the component carries its own media split so the aside
          just renders it once; globals.css stays untouched */}
      <style>{`.ray-baro-pocket{display:none}@media (max-width:899px){.ray-baro-desktop{display:none}.ray-baro-pocket{display:flex}}`}</style>

      {/* ————————— PORTRAIT CERTIFICATE (desktop) ————————— */}
      <div className="ray-baro-desktop" style={{ width: '100%' }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 300, marginInline: 'auto' }}>
          {/* etched watermark — the brand glyph in faint ink */}
          <span aria-hidden style={{ position: 'absolute', right: -14, bottom: -8, opacity: 0.055, transform: 'rotate(-8deg)', pointerEvents: 'none' }}>
            <Flick size={150} />
          </span>

          {/* certificate double rule */}
          <div style={{ borderTop: '2px solid currentColor', marginBottom: 2 }} />
          <div style={{ borderTop: '1px solid var(--paper-line)', marginBottom: 12 }} />
          <div style={{ ...microcap, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span>Market barometer</span>
            <span style={{ color: 'var(--paper-muted)', fontWeight: 600 }}>{marketName}</span>
          </div>

          {/* the gauge */}
          <svg viewBox="0 0 240 132" style={{ display: 'block', width: '100%', marginTop: 6 }} aria-hidden>
            {/* dial arc + heated segment from 0 to the needle */}
            <path d={arcPath(-80, 80, R)} fill="none" stroke="var(--paper-line)" strokeWidth={1.4} />
            {Math.abs(target) > 2 && (
              <path d={arcPath(0, target, R)} fill="none" stroke={heat} strokeWidth={2.4} strokeLinecap="round" />
            )}
            {ticks}
            {/* zero label only — the chart's heating badge owns the word
                "heating"; the barometer keeps its ticks and its number */}
            <text x={CX} y={CY - R - 6} fontSize={8.5} fill="var(--paper-muted)" textAnchor="middle" fontFamily="var(--font-sans), sans-serif">0</text>
            {/* needle — a drawn pointer with a counterweight tail, swung by CSS */}
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: swing }}>
              <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              <line x1={CX} y1={CY} x2={CX} y2={CY + 14} stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" opacity={0.85} />
            </g>
            <circle cx={CX} cy={CY} r={4.4} fill="currentColor" />
            <circle cx={CX} cy={CY} r={1.6} fill="var(--paper)" />
          </svg>

          {/* the reading */}
          <div style={{ textAlign: 'center', marginTop: -6 }}>
            <CountUp
              to={value}
              format={n => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`}
              duration={1100}
              style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: heat, fontVariantNumeric: 'tabular-nums' }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--paper-muted)', marginTop: 6 }}>appreciation · annualized, 3-yr window · sales-weighted</div>
          </div>

          {/* printed stat rows with dotted leaders */}
          <div style={{ marginTop: 18, borderTop: '1px solid var(--paper-line)', paddingTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '9px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--paper-muted)' }}>{typicalLabel}</span>
              <span aria-hidden style={{ flex: 1, borderBottom: '1px dotted var(--paper-line)', transform: 'translateY(-3px)' }} />
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{typical != null ? formatPrice(typical) : '—'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0 2px', fontSize: 13 }}>
              <span style={{ color: 'var(--paper-muted)' }}>Record sale</span>
              <span aria-hidden style={{ flex: 1, borderBottom: '1px dotted var(--paper-line)', transform: 'translateY(-3px)' }} />
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{record ? formatPrice(record.priceUsd) : '—'}</span>
            </div>
            {record && (
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--paper-muted)', marginTop: 1 }}>{record.maker}</div>
            )}
          </div>

          {/* certificate footer rule + microtype */}
          <div style={{ ...footRow, marginTop: 14, paddingTop: 7 }}>
            <span>read nightly from the tape</span>
            <span>{serialText}</span>
          </div>
        </div>
      </div>

      {/* ————————— COMPACT LINE (sub-480px, collapsed) ————————— */}
      {tiny && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label={`Barometer — appreciation ${up ? '+' : ''}${value.toFixed(1)} percent. Expand the instrument.`}
          style={{
            display: 'flex', alignItems: 'baseline', gap: 8, width: '100%',
            background: 'none', border: 'none', borderTop: '2px solid currentColor',
            borderBottom: '1px solid var(--paper-line)', margin: 0, padding: '9px 0 8px',
            color: 'inherit', cursor: 'pointer', fontFamily: 'var(--font-sans), sans-serif', textAlign: 'left',
          }}
        >
          <span style={{ ...microcap, whiteSpace: 'nowrap' }}>Barometer</span>
          <span aria-hidden style={{ flex: 1, borderBottom: '1px dotted var(--paper-line)', transform: 'translateY(-3px)' }} />
          <span style={{ fontSize: 12, color: 'var(--paper-muted)', whiteSpace: 'nowrap' }}>appreciation</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: heat, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {up ? '+' : ''}{value.toFixed(1)}%
          </span>
          <Flick size={10} style={{ flex: 'none', alignSelf: 'center' }} />
        </button>
      )}

      {/* ————————— POCKET BAROMETER (mobile, landscape) ————————— */}
      <div
        className="ray-baro-pocket"
        // sub-480px: the line face stands in until tapped open; tapping the
        // opened pocket folds it back to the line. 480–899px: untouched.
        onClick={tiny ? () => setExpanded(false) : undefined}
        role={tiny ? 'button' : undefined}
        aria-label={tiny ? 'Collapse the barometer' : undefined}
        style={{
          flexDirection: 'column', width: '100%', textAlign: 'left',
          ...(tiny && !expanded ? { display: 'none' } : null),
          ...(tiny ? { cursor: 'pointer' } : null),
        }}
      >
        {/* certificate double rule */}
        <div style={{ borderTop: '2px solid currentColor', marginBottom: 2 }} />
        <div style={{ borderTop: '1px solid var(--paper-line)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '7px 0 8px' }}>
          {/* compact half-arc gauge */}
          <svg viewBox="0 0 120 84" style={{ display: 'block', flex: '0 0 40%', maxWidth: 128, minWidth: 96, height: 'auto' }} aria-hidden>
            <path d={parc(-80, 80, PR)} fill="none" stroke="var(--paper-line)" strokeWidth={1.3} />
            {Math.abs(target) > 2 && (
              <path d={parc(0, target, PR)} fill="none" stroke={heat} strokeWidth={2.2} strokeLinecap="round" />
            )}
            {pticks}
            <text x={PX} y={PY - PR - 5} fontSize={8} fill="var(--paper-muted)" textAnchor="middle" fontFamily="var(--font-sans), sans-serif">0</text>
            {/* needle + counterweight, same 1100ms swing */}
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${PX}px ${PY}px`, transition: swing }}>
              <line x1={PX} y1={PY} x2={pnx} y2={pny} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
              <line x1={PX} y1={PY} x2={PX} y2={PY + 10} stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" opacity={0.85} />
            </g>
            <circle cx={PX} cy={PY} r={3.6} fill="currentColor" />
            <circle cx={PX} cy={PY} r={1.3} fill="var(--paper)" />
          </svg>

          {/* certificate column */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...microcap, whiteSpace: 'nowrap' }}>Market barometer</div>
            <div style={{ ...microcap, color: 'var(--paper-muted)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{marketName}</div>
            <div style={{ marginTop: 6 }}>
              <CountUp
                to={value}
                format={n => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`}
                duration={1100}
                style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: heat, fontVariantNumeric: 'tabular-nums' }}
              />
              <div style={{ fontSize: 10.5, color: 'var(--paper-muted)', marginTop: 4 }}>appreciation · annualized, 3-yr window · sales-weighted</div>
            </div>
            {typical != null && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--paper-muted)', whiteSpace: 'nowrap' }}>Typical sale</span>
                <span aria-hidden style={{ flex: 1, borderBottom: '1px dotted var(--paper-line)', transform: 'translateY(-3px)' }} />
                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(typical)}</span>
              </div>
            )}
          </div>
        </div>

        {/* footer hairline + microtype */}
        <div style={{ ...footRow, paddingTop: 6 }}>
          <span>read nightly</span>
          <span>{serialText}</span>
        </div>
      </div>
    </>
  );
}
