'use client';

import { useEffect, useState } from 'react';
import CountUp from './CountUp';
import Flick from './Flick';
import { formatPrice } from '../utils';

/**
 * ApprBarometer — the lander's appreciation panel as a PRINTED INSTRUMENT
 * CARD: an ink-drawn barometer gauge on the paper block (needle swings to the
 * market's sales-weighted appreciation), certificate double-rules, and
 * dotted-leader stat rows like a printed appraisal slip. Ink only — the
 * paper band's token flip supplies every color.
 */
export default function ApprBarometer({
  value, marketName, typical, record, typicalLabel = 'Typical sale, past year',
}: {
  value: number;                                 // appreciation %, e.g. 21.7
  marketName: string;
  typical: number | null;                        // 12-month median sale
  record: { priceUsd: number; maker: string } | null;
  typicalLabel?: string;                         // bid markets pass 'Typical sale, recent'
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

  const up = value >= 0;
  const CX = 120, CY = 118, R = 88;
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
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

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 300, marginInline: 'auto' }}>
      {/* etched watermark — the brand glyph in faint ink */}
      <span aria-hidden style={{ position: 'absolute', right: -14, bottom: -8, opacity: 0.055, transform: 'rotate(-8deg)', pointerEvents: 'none' }}>
        <Flick size={150} />
      </span>

      {/* certificate double rule */}
      <div style={{ borderTop: '2px solid currentColor', marginBottom: 2 }} />
      <div style={{ borderTop: '1px solid var(--paper-line)', marginBottom: 12 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        <span>Market barometer</span>
        <span style={{ color: 'var(--paper-muted)', fontWeight: 600 }}>{marketName}</span>
      </div>

      {/* the gauge */}
      <svg viewBox="0 0 240 132" style={{ display: 'block', width: '100%', marginTop: 6 }} aria-hidden>
        {/* dial arc + heated segment from 0 to the needle */}
        <path d={arcPath(-80, 80, R)} fill="none" stroke="var(--paper-line)" strokeWidth={1.4} />
        {Math.abs(target) > 2 && (
          <path d={arcPath(0, target, R)} fill="none" stroke={up ? 'var(--paper-up)' : 'var(--paper-down)'} strokeWidth={2.4} strokeLinecap="round" />
        )}
        {ticks}
        {/* end + zero labels, printed small */}
        <text x={pt(-80, R + 1)[0] - 2} y={pt(-80, R + 1)[1] + 12} fontSize={9} fill="var(--paper-muted)" textAnchor="middle" fontFamily="var(--font-sans), sans-serif">cooling</text>
        <text x={pt(80, R + 1)[0] + 2} y={pt(80, R + 1)[1] + 12} fontSize={9} fill="var(--paper-muted)" textAnchor="middle" fontFamily="var(--font-sans), sans-serif">heating</text>
        <text x={CX} y={CY - R - 6} fontSize={8.5} fill="var(--paper-muted)" textAnchor="middle" fontFamily="var(--font-sans), sans-serif">0</text>
        {/* needle — a drawn pointer with a counterweight tail, swung by CSS */}
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: 'transform 1100ms cubic-bezier(0.22, 0.9, 0.24, 1)' }}>
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
          style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: up ? 'var(--paper-up)' : 'var(--paper-down)', fontVariantNumeric: 'tabular-nums' }}
        />
        <div style={{ fontSize: 11.5, color: 'var(--paper-muted)', marginTop: 6 }}>appreciation · sales-weighted across makers</div>
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
      <div style={{ borderTop: '1px solid var(--paper-line)', marginTop: 14, paddingTop: 7, display: 'flex', justifyContent: 'space-between', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-muted)' }}>
        <span>read nightly from the tape</span>
        <span>no. {new Date().toISOString().slice(0, 10).replace(/-/g, '')}</span>
      </div>
    </div>
  );
}
