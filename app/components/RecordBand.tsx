'use client';

import React from 'react';
import { toneOf } from '../utils';

/**
 * RecordBand — the certificate ledger as ONE component: the double rule, the
 * microcap title row, a centered ruled row of figures (the lander's LEDGER
 * composition), and the dated microtype footer. It prints in INK ONLY — it
 * never renders the paper itself. Callers supply the paper ground: either the
 * full-bleed `.ray-band` (lander / value) or a bordered `.ray-paper` card
 * (maker pages, analytics), and the token flip does the rest.
 */
export interface RecordCell {
  k: string;
  /** the 27px numeral — a static print or a CountUp, both inherit the ink */
  v: React.ReactNode;
  /** the small caption under the numeral — string or a live link */
  sub?: React.ReactNode;
  /** signed reading → print-green/red from the paper ramp; 0/absent stays ink */
  signed?: number;
}

export default function RecordBand({
  title, context, serial, cells, footer,
}: {
  title: string;
  context?: string;
  /** certificate number, YYYYMMDD — defaults to today's date */
  serial?: string;
  cells: RecordCell[];
  footer?: string;
}) {
  // no client-clock fallback: an SSG page would mint a build-day serial and
  // hydrate against a client-day one (React #418/#425). No serial → no line.
  const no = serial || null;
  return (
    <div className="ray-recband">
      {/* dangerouslySetInnerHTML, NOT a text child: React escapes text
          children ('>' became '&gt;') but browsers never decode entities
          inside <style>, so the SSG HTML and the client render diverged and
          every maker page failed hydration (React #418/#423/#425). __html
          serializes raw and React skips child diffing — deterministic. */}
      <style dangerouslySetInnerHTML={{ __html: `
        /* the ruled row — 1px hairlines drawn by the gap+background trick,
           exactly like the lander ledger; auto-fit gives 2-up on phones */
        .ray-recband-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 1px;
          background: var(--paper-line);
        }
        .ray-recband-cell {
          background: var(--paper);
          text-align: center;
          padding: 15px 14px 17px;
          min-width: 0;
        }
        .ray-recband-k {
          color: var(--paper-muted);
          font-size: 10.5px; font-weight: 700;
          letter-spacing: 0.13em; text-transform: uppercase;
          margin-bottom: 8px;
        }
        .ray-recband-v {
          font-size: 27px; font-weight: 700;
          letter-spacing: -0.02em; line-height: 1.1;
          font-variant-numeric: tabular-nums;
        }
        .ray-recband-s { color: var(--paper-muted); font-size: 11.5px; margin-top: 6px; }
        .ray-recband-s a { color: inherit; text-underline-offset: 3px; }
        @media (max-width: 899px) {
          /* 2x2: reserve two label lines so the numerals share a baseline */
          .ray-recband-k { min-height: 2.6em; }
        }
      ` }} />

      {/* certificate double rule + microcap title row */}
      <div style={{ borderTop: '2px solid currentColor', marginBottom: 2 }} />
      <div style={{ borderTop: '1px solid var(--paper-line)', marginBottom: 10 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
        <span>{title}</span>
        {context && <span style={{ color: 'var(--paper-muted)', fontWeight: 600, textAlign: 'right' }}>{context}</span>}
      </div>

      {/* the figures, ruled and centered like a catalogue's front matter */}
      <div className="ray-recband-grid">
        {cells.map(cell => {
          const tone = cell.signed == null ? 'flat' : toneOf(cell.signed);
          return (
            <div key={cell.k} className="ray-recband-cell">
              <div className="ray-recband-k">{cell.k}</div>
              <div
                className="ray-recband-v"
                style={{ color: tone === 'up' ? 'var(--paper-up)' : tone === 'down' ? 'var(--paper-down)' : 'var(--paper-ink)' }}
              >
                {cell.v}
              </div>
              {cell.sub != null && <div className="ray-recband-s">{cell.sub}</div>}
            </div>
          );
        })}
      </div>

      {/* microtype footer, dated like every certificate on the site */}
      <div style={{ borderTop: '1px solid var(--paper-line)', marginTop: 2, paddingTop: 7, display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-muted)' }}>
        <span>{footer}</span>
        <span style={{ whiteSpace: 'nowrap' }}>no. {no}</span>
      </div>
    </div>
  );
}
