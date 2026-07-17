import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../../components/ArtistNav';
import meta from '../../../public/data/ray/meta.json';
import { Colophon } from '../../components/Terminal';

export const metadata: Metadata = {
  title: 'How we built the pricing engine — and everything it got wrong first',
  description:
    'Seven thousand replayed auction calls, a buyer’s-premium problem hiding in plain sight, and why our best model is the one that admits what it can’t know.',
};

const wrap: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '0 24px' };
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '46px 0 10px' };
const p: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.72, color: 'var(--color-text-secondary)', margin: '0 0 16px' };
const strong: React.CSSProperties = { color: 'var(--color-fg)', fontWeight: 600 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '6px 0 20px', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 12.5 };
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid var(--hairline)', color: 'var(--color-text-secondary)' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-fg)' };
const pullquote: React.CSSProperties = {
  borderLeft: '2px solid var(--color-accent-gold)', padding: '4px 0 4px 20px', margin: '26px 0',
  fontSize: 17, lineHeight: 1.6, color: 'var(--color-fg)', fontWeight: 500,
};

export default function PricingEnginePost() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="blog" />
      <main id="main" style={{ paddingTop: 28, paddingBottom: 60 }}>
        <header style={{ ...wrap, marginBottom: 10 }}>
          <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
            <Link href="/blog" style={{ color: 'inherit', textDecoration: 'none' }}>Notes from the desk</Link> · July 16, 2026
          </p>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 38px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.15, margin: '0 0 14px' }}>
            How we built the pricing engine — and everything it got wrong first
          </h1>
          <p style={{ ...p, fontSize: 16.5, color: 'var(--color-text-secondary)' }}>
            lectr&rsquo;s job is one sentence: read every auction estimate against every hammer, and say —
            before the sale — which lots are priced under where their market actually clears. This is the
            story of building that engine: what we measured, what failed, and the one number that was
            hiding in plain sight.
          </p>
        </header>

        <article style={wrap}>
          <h2 style={h2}>The rule that shaped everything</h2>
          <p style={p}>
            We committed to one discipline before writing any pricing code: <span style={strong}>no claim
            ships without a time-machine test.</span> Every method gets replayed against history — for each
            concluded sale, the engine may only use sales that had already happened on that day, and then
            we score what the lot actually did. No hindsight, no cherry-picking, no &ldquo;backtested on the
            lots it happened to work on.&rdquo; Today that replay covers <span style={strong}>7,760 flagged
            calls</span> across a corpus of 53,000 lots from nine auction houses, back to 2000.
          </p>
          <p style={p}>
            That rule sounds obvious. It is also the reason most of this post is about being wrong.
          </p>

          <h2 style={h2}>Attempt one: price the object</h2>
          <p style={p}>
            The first engine tried to do the intuitive thing — predict the price. Find comparable sales
            (same maker, same kind of object, similar size, scored by how closely the titles and
            structured details agree), take a weighted median, and call that the value.
          </p>
          <p style={p}>
            The replay was humbling. On unique works of art, our absolute prices missed by about
            1.6&times; on median — while the auction houses&rsquo; own estimates missed by 1.3&times;.
            Specialists who handle the object, know the consignor, and set the reserve are simply better
            at absolute pricing than any comps math. We tried a classical hedonic model too (regressing
            price on size, year, medium, house): it lost even harder, off by 1.8&ndash;4&times;.
          </p>
          <div style={pullquote}>
            The market already employs excellent appraisers. The useful question isn&rsquo;t
            &ldquo;what is this worth?&rdquo; — it&rsquo;s &ldquo;is the estimate wrong, and in which direction?&rdquo;
          </div>
          <p style={p}>
            So the engine became <span style={strong}>directional</span>. For every lot we compute where
            its comparable sales actually cleared, divide by the estimate midpoint, and only speak when
            the gap is meaningful. Comps trade at 1.3&times; the ask or more — the lot gets flagged below
            market. Comps sit under 0.75&times; — it&rsquo;s flagged above. That signal survived the time
            machine: flagged lots have beaten unflagged lots in every single year since 2000. You can see
            that chart, year by year, on <Link href="/value" style={{ color: 'var(--color-fg)' }}>the record</Link>.
          </p>

          <h2 style={h2}>The number hiding in plain sight</h2>
          <p style={p}>
            For a while our headline read &ldquo;flagged lots beat their estimates by +40% median.&rdquo;
            True — and misleading, in a way that took a deliberate audit to catch. Auction results are
            published <em>premium-inclusive</em>: the price a buyer pays, including the house&rsquo;s
            ~25% buyer&rsquo;s premium. Estimates are set on <em>hammer</em> — the number the auctioneer
            actually says. Comparing one to the other bakes a hidden +25% into every figure. A lot that
            hammers exactly at its estimate &ldquo;beats&rdquo; it by 25% on paper.
          </p>
          <p style={p}>
            Roughly 70% of our +40% was premium, not edge. So we restated everything at the hammer:
          </p>
          <table style={table}>
            <thead>
              <tr><th style={th}>Measured at the hammer</th><th style={{ ...th, textAlign: 'right' }}>Median vs estimate</th><th style={{ ...th, textAlign: 'right' }}>Failed to sell</th></tr>
            </thead>
            <tbody>
              <tr><td style={td}>Flagged below market</td><td style={tdNum}>+15%</td><td style={tdNum}>9.0%</td></tr>
              <tr><td style={td}>Unflagged</td><td style={tdNum}>−5%</td><td style={tdNum}>15.1%</td></tr>
              <tr><td style={td}>Flagged above market</td><td style={tdNum}>−11%</td><td style={tdNum}>22.7%</td></tr>
            </tbody>
          </table>
          <p style={p}>
            The signal got <em>more</em> convincing, not less. On the honest basis, the above-market
            warning — which had looked wrong at +7% — flips to demonstrably right at −11%. And a new
            statistic emerged once we stopped excluding lots that failed to sell: flagged lots go unsold
            9% of the time, versus 23% for the ones we call overpriced. Every number on lectr now leads
            with the hammer basis. Shrinking your own headline is uncomfortable. It is also the entire
            product.
          </p>

          <h2 style={h2}>What measurement kept, and what it killed</h2>
          <p style={p}>
            Every engine change since has gone through the same replay, A/B-style: same lots, old rule vs
            new rule, adopt only what wins. A few survivors:
          </p>
          <p style={p}>
            <span style={strong}>Recency decay.</span> A comp&rsquo;s weight now halves every two years of
            age (one year for fast-moving memorabilia). The flags it removed had been performing exactly
            like unflagged lots — stale-comp false positives — while the ones it added performed like the
            best of the book.
          </p>
          <p style={p}>
            <span style={strong}>Admitting structure.</span> The original comp gate leaned on wording
            similarity alone. Two listings of the same watch reference, phrased differently, could fail
            to match. Letting strong structured agreement (same model, same reference) carry a comp past
            a lower wording bar added 5% more coverage with identical accuracy.
          </p>
          <p style={p}>
            <span style={strong}>Self-calibration.</span> The &ldquo;chance this beats its high
            estimate&rdquo; percentages users see are refit from the full replay at every nightly build —
            per market, weighted toward recent years. One honest detail we&rsquo;re proud of: when the
            comps-to-estimate gap gets extreme (10&times;+), the measured beat rate <em>drops</em>, and
            the engine now says so instead of extrapolating excitement.
          </p>
          <p style={p}>And the graveyard — ideas that sounded smart and measured worse:</p>
          <table style={table}>
            <thead>
              <tr><th style={th}>Idea</th><th style={th}>Why it died</th></tr>
            </thead>
            <tbody>
              <tr><td style={td}>Machine-learned probability model</td><td style={td}>Worse calibrated out-of-time than a simple step function; every feature except the comps gap itself carried no signal</td></tr>
              <tr><td style={td}>Adjusting for houses that estimate low</td><td style={td}>Actively diluted the signal — estimate-shy makers are largely <em>where the edge comes from</em></td></tr>
              <tr><td style={td}>Absolute hedonic pricing</td><td style={td}>Lost to the houses&rsquo; own estimates by 1.4&ndash;3&times;</td></tr>
              <tr><td style={td}>Image matching for &ldquo;same object&rdquo;</td><td style={td}>Different houses photograph the same object differently; text + structure works, pixels don&rsquo;t</td></tr>
              <tr><td style={td}>Stricter comp gates</td><td style={td}>Cost 7% of coverage for zero accuracy gain — the ranking already did the work</td></tr>
            </tbody>
          </table>

          <h2 style={h2}>The unglamorous truth: fuel beats math</h2>
          <p style={p}>
            After all the modeling, the single biggest improvement to the engine this year was not an
            algorithm. When we audited why lots went unvalued, over half the failures were simple
            scarcity — fewer than two usable comparable sales existed for that maker. So we went and got
            the data: one house&rsquo;s full sale archive turned out to be 19&times; deeper than what we
            had captured, and backfilling it deepened the watch market&rsquo;s comp pools by 60% in an
            afternoon. Every accuracy metric improved, untouched.
          </p>
          <div style={pullquote}>
            If your model is starving, tune the crawler, not the weights.
          </div>

          <h2 style={h2}>Where it stands, and what&rsquo;s next</h2>
          <p style={p}>
            Today: 7,760 replayed calls, flagged lots hammering +15% over their estimates against −5% for
            everything else, 45% beating their high estimate outright, and the lowest fail-to-sell rate
            of any bucket — with every one of those figures recomputed nightly and published, including
            the years and segments where the edge is thinner. Next: guards against the remaining
            false-comp classes (a single print should never be priced off a set of six), honest coverage
            for thin makers, and a bid-momentum signal for bid-driven auctions once enough nightly
            snapshots accrue to test it properly.
          </p>
          <p style={p}>
            The engine will keep changing. The rule won&rsquo;t: measured on history, stated at the
            hammer, wrong in public when it&rsquo;s wrong.
          </p>
          <p style={{ ...p, marginTop: 28 }}>
            <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              See the record
            </Link>
            <Link href="/about" style={{ marginLeft: 18, fontSize: 14, color: 'var(--color-text-muted)' }}>
              Or read the technical walk-through
            </Link>
          </p>
        </article>
      </main>
      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}
