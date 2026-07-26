'use client';

import { toneOf } from '../utils';

/**
 * SettlementSlip — the lander's closing instrument: the concluded-sales
 * summary as a printed settlement on the paper band, in the same certificate
 * language as the barometer and the ledger line. Dotted-leader rows, an
 * ink-outline archive control, and the dated microtype footer. The archive
 * itself (a dark table) renders BELOW the band — never on the paper.
 */
export interface SlipLine {
  k: string;
  v: string;
  /** signed reading → print-green/red via the band's token flip; 0 stays ink */
  signed?: number;
}

export default function SettlementSlip({
  marketName, lines, archiveOpen, onToggleArchive, serial,
}: {
  marketName: string;
  lines: SlipLine[];
  archiveOpen: boolean;
  onToggleArchive: () => void;
  serial: string; // YYYYMMDD from lastCrawl
}) {
  return (
    <div className="ray-band" style={{ marginTop: 34, paddingBlock: '22px 16px' }}>
      <section className="rail">
        <div style={{ borderTop: '2px solid currentColor', marginBottom: 2 }} />
        <div style={{ borderTop: '1px solid var(--paper-line)', marginBottom: 10 }} />
        <div className="kicker" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: 'inherit', marginBottom: 6 }}>
          <span>The settlement</span>
          <span style={{ color: 'var(--paper-muted)' }}>{marketName}</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px 40px', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 340px', maxWidth: 560 }}>
            {lines.map(line => (
              <div key={line.k} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', fontSize: 13.5 }}>
                <span style={{ color: 'var(--paper-muted)' }}>{line.k}</span>
                <span aria-hidden style={{ flex: 1, borderBottom: '1px dotted var(--paper-line)', transform: 'translateY(-3px)' }} />
                <span style={{
                  fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: line.signed == null || toneOf(line.signed) === 'flat'
                    ? 'var(--paper-ink)'
                    : toneOf(line.signed) === 'up' ? 'var(--paper-up)' : 'var(--paper-down)',
                }}>{line.v}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="kicker"
            onClick={onToggleArchive}
            aria-expanded={archiveOpen}
            style={{
              background: 'none', cursor: 'pointer',
              border: '1px solid var(--paper-ink)', borderRadius: 100,
              padding: '9px 20px',
              color: 'var(--paper-ink)',
              marginBottom: 7, whiteSpace: 'nowrap',
            }}
          >
            {archiveOpen ? 'Hide the archive' : 'Show the archive'}
          </button>
        </div>

        <div className="kicker" style={{ borderTop: '1px solid var(--paper-line)', marginTop: 8, paddingTop: 7, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--paper-muted)' }}>
          <span>settled nightly, every hammer on the book</span>
          <span>no. {serial}</span>
        </div>
      </section>
    </div>
  );
}
