import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import { Colophon } from '../components/Terminal';
import meta from '../../public/data/ray/meta.json';
// build-time only — server component imports never ship to the client bundle
import backtest from '../../public/data/ray/backtest.json';
import market from '../../public/data/ray/market.json';

export const metadata: Metadata = {
  title: 'How lectr calls it — the method',
  description:
    'Plain-English methodology: how comparables are chosen, when the indices publish, how cards are keyed to the same object, how every call is replayed against history — and why lectr stays silent on most lots.',
};

/**
 * /method — the methodology as a page, in the certificate voice. This is
 * MethodologyNote grown up: the same doctrine ("Same form, always. Silent
 * over wrong."), with the real gates and the real numbers, readable at a
 * shared URL instead of a popover.
 */

// the confidence gate, measured from the data at build: how many tracked
// makers actually publish an index right now
const makerIndex = (market as { makerIndex?: Record<string, { horizons?: Record<string, { publishable?: boolean } | null> }> }).makerIndex || {};
const trackedMakers = Object.keys(makerIndex).length;
const publishingMakers = Object.values(makerIndex).filter(
  m => Object.values(m.horizons || {}).some(h => h?.publishable)
).length;
const replayN = (backtest as { flagged?: { n?: number } }).flagged?.n ?? 0;

const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: 'var(--color-text-secondary)', margin: '0 0 14px' };
const liStyle: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.6, color: 'var(--color-text-secondary)', margin: '0 0 10px', paddingLeft: 18, position: 'relative' };

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li style={liStyle}>
      <span aria-hidden style={{ position: 'absolute', left: 2, top: 9, width: 5, height: 5, borderRadius: 100, background: 'var(--color-up)' }} />
      {children}
    </li>
  );
}

function Section({ ord, label, title, children }: { ord: string; label: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rail" style={{ paddingBlock: '26px 8px', maxWidth: 'min(100%, calc(760px + 48px))' }}>
      <div className="kicker" style={{ marginBottom: 8 }}>{ord} · {label}</div>
      <h2 style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 12px', color: 'var(--color-fg)' }}>{title}</h2>
      {children}
    </section>
  );
}

export default function MethodPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug={null} />

      <section className="rail" style={{ paddingTop: 24 }}>
        <Masthead
          kicker="The method · how lectr calls it"
          title={<>Same form, always. <Accent>Silent over wrong.</Accent></>}
          sub={
            <>
              Every number lectr prints is measured from public auction records — estimates and results are
              the houses&rsquo; own, converted to USD, and every claim is replayed against {replayN.toLocaleString()} historical
              sales before it&rsquo;s allowed to speak.
            </>
          }
        />
      </section>

      <Section ord="01" label="Comparables" title="How comps are chosen">
        <p style={p}>
          A deal flag means the median of a lot&rsquo;s <b style={{ color: 'var(--color-fg)' }}>true comparables</b> sits
          well above the estimate midpoint — and a comparable has to earn the name:
        </p>
        <ul style={{ listStyle: 'none', margin: '0 0 6px', padding: 0 }}>
          <Rule><b style={{ color: 'var(--color-fg)' }}>Same form, always.</b> Works are classified into 26 forms — paintings, works on paper, prints, posters, photographs, editioned objects, stools, benches, chairs, tables, case pieces and more. Stools comp stools. A poster never prices a screenprint.</Rule>
          <Rule><b style={{ color: 'var(--color-fg)' }}>Same edition, first.</b> If the exact work has sold three or more times, those sales alone make the call — what did <i>this</i> work last hammer for.</Rule>
          <Rule><b style={{ color: 'var(--color-fg)' }}>Sized, when measurable.</b> When both works carry dimensions, a 40-inch bench never comps a ten-footer, and a miniature never prices a mural.</Rule>
          <Rule><b style={{ color: 'var(--color-fg)' }}>Confidence, stated.</b> Every call carries a meter (●●●●). Very high means this exact work has sold three or more times; high means a large tight pool; low means the call passed the guards but the evidence is thin.</Rule>
          <Rule><b style={{ color: 'var(--color-fg)' }}>Medians, never means.</b> One record price can&rsquo;t drag a pool; one fire-sale can&rsquo;t sink it.</Rule>
        </ul>
      </Section>

      <Section ord="02" label="Indices" title="When an index is allowed to publish">
        <p style={p}>
          Price indices are fit per maker (hedonic — controlling for form, size and period), and a horizon
          publishes <b style={{ color: 'var(--color-fg)' }}>only when its confidence interval resolves the sign</b> of
          the move. If the data can&rsquo;t tell up from down, lectr doesn&rsquo;t guess.
        </p>
        <p style={p}>
          Right now that gate passes{' '}
          <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{publishingMakers} of {trackedMakers}</b>{' '}
          tracked makers. The other {trackedMakers - publishingMakers} show measured demand or descriptive
          reads instead — never a dressed-up index.
        </p>
      </Section>

      <Section ord="03" label="Cards & objects" title="How cards are keyed">
        <p style={p}>
          Sports cards and repeat objects are matched to the <b style={{ color: 'var(--color-fg)' }}>same physical
          object</b> — same card, same grade; photo-, edition- or serial-justified matches for objects — never
          fuzzy title echo. Same-object resales power the grade ladder, the &ldquo;this exact item last sold
          for&rdquo; moment, and the provenance trail on every lot page. Card markets index by repeat sales
          (Bailey–Muth–Nourse), which is immune to what happened to come up for sale.
        </p>
      </Section>

      <Section ord="04" label="The replay" title="Every call, scored against history">
        <p style={p}>
          Every night the entire method is replayed <b style={{ color: 'var(--color-fg)' }}>point-in-time</b> across{' '}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{replayN.toLocaleString()}</span> historical sales — each call
          made using only the sales that had already happened, then scored against what actually hammered.
          No hindsight, no survivorship. The results, including the failures, are public on{' '}
          <Link href="/record" style={{ color: 'var(--color-butter-text)', textDecoration: 'none' }}>the record</Link>.
        </p>
      </Section>

      <Section ord="05" label="Abstention" title="Silent over wrong">
        <p style={p}>
          Fewer than three true comps, or a pool that disagrees with itself, and lectr says nothing at all.
          Most lots get no call — <b style={{ color: 'var(--color-fg)' }}>silence over noise</b>. When you do see
          a flag, it exists because the evidence cleared every gate above.
        </p>
      </Section>

      <section className="rail" style={{ paddingBlock: '30px 64px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Link href="/record" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none' }}>
          See the record <Flick size={11} />
        </Link>
        <Link href="/value" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none', border: '1px solid var(--color-border)' }}>
          The live calls
        </Link>
        <Link href="/about" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none', border: '1px solid var(--color-border)' }}>
          For engineers <Flick size={11} />
        </Link>
      </section>

      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}
