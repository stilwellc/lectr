import Link from 'next/link';
import ArtistNav from '../../components/ArtistNav';
import Flick from '../../components/Flick';
import { Colophon } from '../../components/Terminal';
import Masthead, { Accent } from '../../components/Masthead';

const wrap: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '0 24px' };
const p: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.72, color: 'var(--color-text-secondary)', margin: '0 0 16px' };
const strong: React.CSSProperties = { color: 'var(--color-fg)', fontWeight: 600 };

/** the fixed date this register was first swept — every entry below is dated */
const SWEPT = '2026-08-02';
function fmtLong(date: string): string {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/* ── a single reconciliation, as a certificate line: the claim struck through
      into the current truth. The arrow is the ledger's own mono voice. ── */
function Rec({ where, claim, truth }: { where: string; claim: React.ReactNode; truth: React.ReactNode }) {
  return (
    <li style={{ margin: '0 0 18px', listStyle: 'none' }}>
      <span className="kicker" style={{ display: 'block', margin: '0 0 6px' }}>{where}</span>
      <span style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--color-text-secondary)', display: 'block' }}>
        <span style={{ color: 'var(--color-text-faint)', textDecoration: 'line-through', textDecorationColor: 'var(--hairline)' }}>{claim}</span>
        <span aria-hidden style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--color-text-faint)', padding: '0 8px' }}>&rarr;</span>
        <span style={strong}>{truth}</span>
      </span>
    </li>
  );
}

export default function CorrectionsRegister() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="blog" />
      <div style={{ paddingTop: 28, paddingBottom: 60 }}>
        <div style={{ ...wrap, marginBottom: 26 }}>
          <p style={{ margin: '0 0 18px' }}>
            <Link href="/blog" style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
              <Flick size={11} style={{ transform: 'scaleX(-1)', marginLeft: 0, marginRight: 2 }} /> All notes
            </Link>
          </p>
          {/* the certificate masthead — dated the day of the sweep */}
          <Masthead
            kicker="Notes from the desk · Corrections register"
            serial={SWEPT}
            title={<>We keep the <Accent>receipts</Accent>.</>}
            sub={<>
              A standing, dated log of when a published figure gets reconciled against the live engine.
              The engine refits nightly; editorial is periodic; when the two drift apart, the gap is
              logged here rather than quietly patched.
            </>}
          />
          <p style={{ ...p, fontSize: 16, marginTop: 18 }}>
            Our posts quote real numbers from the engine at the time they&rsquo;re written, and the engine
            keeps moving. That is a feature, not a defect — but it means a figure printed in April can read
            differently in August. Rather than silently edit the old copy, we sweep every published figure
            against the current build and log what changed, in full, on the date we did it.
          </p>
        </div>

        <article style={wrap}>
          <div style={{ borderTop: '2px solid var(--color-fg)', paddingTop: 20 }}>
            <p className="kicker" style={{ margin: '0 0 10px' }}>{fmtLong(SWEPT)}</p>
            <h2 style={{ fontFamily: 'var(--font-serif), serif', fontSize: 24, fontWeight: 400, letterSpacing: '-0.015em', margin: '0 0 14px', lineHeight: 1.2 }}>
              Reconciled the editorial figures to the live build
            </h2>
            <p style={p}>
              On this date we swept every published figure across the notes and the systems pages against
              the current engine and updated the ones that had drifted. Each reconciliation below is stated
              as the original claim reconciled to the current truth — neutral, and exact.
            </p>

            <ul style={{ padding: 0, margin: '22px 0 0' }}>
              <Rec
                where="Quarterly notes · index cards"
                claim="the art quarter carried $240M at 56% sell-through"
                truth="realigned to $508.8M at 66% — and the watches, sports, design and science cards were re-synced to the figures that stand in their own posts"
              />
              <Rec
                where="About page · sources"
                claim="the sources list named nine houses, including Heritage and Bruun Rasmussen"
                truth="corrected to the eight houses actually crawled; Heritage and Bruun Rasmussen were never integrated, and RR Auction — with its 30-year sold archive — is now credited"
              />
              <Rec
                where="About page · payload sizes"
                claim="first paint fetches ~400 KB; the history shards run ~9 MB"
                truth="~8 MB across the five JSON files actually loaded on first paint, and ~290 MB of history shards at the current build — now fetched on demand, not eagerly"
              />
              <Rec
                where="Engine post · watches quarter note · per-maker index"
                claim="Cartier +52.9%, Rolex +25.1%, Patek −18.2% (five-year, 95% CI)"
                truth="refreshed to the current build: Cartier +51.2%, Rolex +23.6%, Patek −12.9% (five-year, 95% CI)"
              />
              <Rec
                where="Engine post · shorter-window reads"
                claim="a three-year read on Rolex and a one-year read on Patek had resolved the sign"
                truth="both intervals now span zero, so the copy was changed to say the engine abstains — we would rather print “we can’t call this yet” than a stale number"
              />
            </ul>
          </div>

          {/* the standing note — what this register is, going forward */}
          <div style={{ marginTop: 40, paddingTop: 22, borderTop: '1px solid var(--hairline)' }}>
            <p className="kicker" style={{ margin: '0 0 10px' }}>Standing note</p>
            <p style={{ ...p, marginBottom: 0 }}>
              This register updates whenever a published figure is reconciled. The engine refits nightly,
              editorial is periodic, and the gap between them is logged here — dated, in full — rather than
              quietly patched. <span style={strong}>The confidence is in the openness:</span> a figure that
              drifts is not an error to hide, it&rsquo;s a receipt to keep.
            </p>
          </div>
        </article>
      </div>
      <Colophon record={null} />
    </div>
  );
}
