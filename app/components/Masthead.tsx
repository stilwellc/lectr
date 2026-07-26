import React from 'react';

/**
 * Masthead — the page header as a CERTIFICATE, in the same instrument
 * language as the barometer, the settlement slip and the ledger band:
 * a butter microcap kicker with a right-aligned dated serial (or a live
 * datum), a hairline rule, one confident statement h1 carrying exactly
 * ONE accent, an optional data-inflected subline, and a closing hairline
 * before the content. Rhythm: kicker → 10px → h1 → 8px → sub → 26px → rule.
 *
 * No hooks — renders identically from server (blog/about) and client
 * pages. Every page composes its own statement; the grammar is shared,
 * the sentence never is.
 */

/* label voice = the global .kicker class (mono microcap, terminal reference);
   only per-slot color/numeric overrides live inline here */

/** ONE accent, option A: the key word set in text-safe butter. */
export function Accent({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--color-butter-text)' }}>{children}</span>;
}

/** ONE accent, option B: the ceremonial 3px butter-deep stroke under the key word. */
export function Underscore({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ borderBottom: '3px solid var(--color-butter-deep)', paddingBottom: 4 }}>
      {children}
    </span>
  );
}

export default function Masthead({
  kicker,
  serial,
  datum,
  title,
  sub,
  style,
}: {
  kicker: string;
  /** ISO date/datetime (lastCrawl where available) → "NO. YYYYMMDD"; defaults to build date */
  serial?: string;
  /** a live figure for the right slot — replaces the serial when supplied */
  datum?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const no = (serial || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
  return (
    <header className="ray-masthead" style={style}>
      <style>{`
        .ray-masthead-h1 { font-size: clamp(32px, 5vw, 44px); }
        @media (max-width: 480px) {
          .ray-masthead-h1 { font-size: clamp(26px, 8vw, 31px); }
        }
      `}</style>

      {/* certificate kicker row: butter microcap + dated serial, ruled under */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '2px 18px',
          paddingBottom: 8,
          borderBottom: '1px solid var(--hairline, var(--color-border))',
        }}
      >
        <span className="kicker" style={{ color: 'var(--color-butter-text)' }}>{kicker}</span>
        <span
          className="kicker"
          style={{
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {datum ?? `No. ${no}`}
        </span>
      </div>

      {/* the statement */}
      <h1
        className="ray-masthead-h1"
        style={{
          margin: '10px 0 0',
          fontFamily: 'var(--font-serif), serif',
          fontWeight: 400,
          letterSpacing: '-0.015em',
          lineHeight: 1.16,
          color: 'var(--color-fg)',
          maxWidth: 760,
        }}
      >
        {title}
      </h1>

      {sub != null && (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 15.5,
            lineHeight: 1.6,
            color: 'var(--color-text-secondary)',
            maxWidth: 640,
          }}
        >
          {sub}
        </p>
      )}

      {/* closing hairline before the content */}
      <div aria-hidden style={{ marginTop: 26, borderTop: '1px solid var(--hairline, var(--color-border))' }} />
    </header>
  );
}
