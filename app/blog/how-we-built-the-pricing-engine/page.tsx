import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../../components/ArtistNav';
import meta from '../../../public/data/ray/meta.json';
import { Colophon } from '../../components/Terminal';

export const metadata: Metadata = {
  title: 'How we built the price-movement engine — a hedonic index that abstains',
  description:
    'The math behind lectr\'s appreciation numbers: a per-maker Huber-robust hedonic log-price regression that controls for the within-maker mix, and a confidence gate that publishes a return only when its 95% CI resolves the sign. The result is that almost everything abstains — and the few makers that clear the bar (Rolex, Patek, Cartier) are the whole point.',
};

const wrap: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '0 24px' };
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '46px 0 10px' };
const p: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.72, color: 'var(--color-text-secondary)', margin: '0 0 16px' };
const strong: React.CSSProperties = { color: 'var(--color-fg)', fontWeight: 600 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '6px 0 20px', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 12.5 };
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid var(--hairline)', color: 'var(--color-text-secondary)' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-fg)' };

/** Display math, terminal style: mono, centered, framed on the elevated ground. */
function Formula({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <figure style={{ margin: '18px 0 20px' }}>
      <div style={{
        border: '1px solid var(--hairline)', borderRadius: 10, background: 'var(--color-bg-elevated)',
        padding: '16px 18px', overflowX: 'auto',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: 14.5, lineHeight: 1.9,
          color: 'var(--color-fg)', whiteSpace: 'pre', textAlign: 'center', minWidth: 'fit-content', margin: '0 auto',
        }}>{children}</div>
      </div>
      {caption && (
        <figcaption style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-text-muted)', margin: '8px 4px 0' }}>{caption}</figcaption>
      )}
    </figure>
  );
}

const V = ({ children }: { children: React.ReactNode }) => (
  <code style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: '0.92em', color: 'var(--color-fg)' }}>{children}</code>
);

export default function PricingEnginePost() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="blog" />
      <main id="main" style={{ paddingTop: 28, paddingBottom: 60 }}>
        <header style={{ ...wrap, marginBottom: 10 }}>
          <p className="kicker" style={{ margin: '0 0 14px' }}>
            <Link href="/blog" style={{ color: 'inherit', textDecoration: 'none' }}>Notes from the desk</Link> · July 24, 2026 · technical
          </p>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 38px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.15, margin: '0 0 14px' }}>
            How we built the price-movement engine
          </h1>
          <p style={{ ...p, fontSize: 16.5 }}>
            An index that says how much a market has actually moved is easy to fake and hard to earn.
            Ours is a per-maker hedonic regression with a confidence gate bolted to the front of it —
            and the gate&rsquo;s job is to make the engine <span style={strong}>shut up</span>. Across
            everything we track, only three makers currently clear the bar. That is the feature, not the
            bug, and this is how it works.
          </p>
        </header>

        <article style={wrap}>
          <h2 style={h2}>0 · The number we refuse to fake</h2>
          <p style={p}>
            &ldquo;This market is up 40%&rdquo; is the single most abused sentence in collectibles. A
            median sale price jumps because a marquee quarter over-sampled expensive lots; a cohort
            index rounds and drifts; a partial quarter reports half its sales and prints a spike. None of
            those is price movement. Price movement is what a <em>like-for-like</em> object did over
            time — the same reference, the same form, the same size — with the changing <em>mix</em> of
            what happened to sell held constant. Everything below is one apparatus for estimating that
            one quantity, and refusing to state it when we can&rsquo;t.
          </p>

          <h2 style={h2}>1 · The hedonic price-movement index</h2>
          <p style={p}>
            The engine is a <span style={strong}>hedonic log-price regression</span>, fit per maker in{' '}
            <V>scripts/hedonic-index.ts</V>. We regress the log of the realized price on a set of quality
            controls plus a dummy for every calendar quarter. The quarter coefficients are the pure time
            effect — the price movement of a like-for-like lot — because the quality dummies absorb the
            mix:
          </p>
          <Formula caption="τ_q = the coefficient on quarter q's dummy; the other terms are the like-for-like controls. A quarter's τ is the log-price of a fixed lot in that quarter — mix already differenced out — so it is movement, not composition.">
{`ln R_i  =  α  +  Σ_q τ_q · 1[quarter_i = q]

            +  β·refModel_i + β·form_i + β·size_i
            +  β·decade_i  + β·house_i  +  ε_i`}
          </Formula>
          <p style={p}>
            For a per-maker index the maker is constant, so its dummy drops and the{' '}
            <span style={strong}>within-maker</span> drivers carry the mix: a watch reference (a Daytona
            vs a Datejust), a furniture model (a Conoid bench vs a slab table), the form, the size, the
            object&rsquo;s decade, and the auction house. That is exactly what a naive median can&rsquo;t
            give you — if a quarter happens to sell more Daytonas, the median jumps even when nothing
            appreciated; the hedonic <V>τ</V> doesn&rsquo;t, because the reference dummy already ate it.
          </p>
          <p style={p}>
            Auction tails are heavy — a handful of whale lots would drag ordinary least squares — so the
            fit is <span style={strong}>Huber IRLS</span>: five reweighting passes that trust residuals
            inside a robust band and down-weight everything outside it, with a tiny ridge on the
            non-intercept coefficients for numerical stability. The design matrix is sparse (each lot
            lights up ~6 dummies out of a few hundred columns), so we never materialize the dense{' '}
            <V>n×p</V> matrix; we accumulate <V>X&rsquo;WX</V> and <V>X&rsquo;Wy</V> over each row&rsquo;s
            nonzeros and solve the small system by Cholesky (via <V>ml-matrix</V>, eigen-pseudo-inverse
            fallback):
          </p>
          <Formula caption="β̂ from the Huber-weighted normal equations; the index level rebases quarter τ to 100 at the base quarter. The 95% CI on any horizon comes straight from the covariance Cov(β̂) = σ̂²·(X'WX+ridge)⁻¹.">
{`β̂        =  ( X'WX + λI )⁻¹ X'Wy

index_q  =  100 · exp( τ_q − τ_base )

change%  =  100 · ( exp( τ_end − τ_start ) − 1 )`}
          </Formula>

          <h2 style={h2}>2 · Confidence gating — the part that abstains</h2>
          <p style={p}>
            Here is the whole thesis. A horizon — 1Y, 3Y, 5Y — publishes a return{' '}
            <span style={strong}>only when its 95% confidence interval resolves the sign</span>. If the
            interval straddles zero, we don&rsquo;t say &ldquo;roughly flat&rdquo; and we don&rsquo;t
            round toward a story. We <span style={strong}>abstain</span>: the horizon is marked
            not-publishable with a human-readable reason, and the site says so out loud.
          </p>
          <Formula caption="Δln with standard error se from the covariance of the two quarter coefficients. A horizon publishes only if the CI clears zero AND its half-width isn't larger than the point estimate (a wide interval that happens to miss zero is still noise).">
{`publish(h)  ⟺   CI₉₅( Δln )  excludes 0
              ∧   half-width  <  2 · | change% |`}
          </Formula>
          <p style={p}>
            The sign gate is the headline, but it&rsquo;s the last of a stack. A horizon also has to end
            on a <span style={strong}>complete, dense</span> quarter (we never end on the current stub
            quarter, and the endpoint&rsquo;s volume must be ≥60% of its trailing-4-quarter median, which
            catches a half-reported latest quarter); it needs enough distinct references or forms that
            the within-maker mix is actually controlled; and it fails on a{' '}
            <span style={strong}>composition break</span> — any single source or house that is &gt;40% of
            one endpoint but &lt;12% of the other, which is how an archive backfill or a house
            entering/leaving would otherwise leak into the &ldquo;time&rdquo; effect. Clear all of them,
            and only then does the CI get a vote.
          </p>
          <p style={p}>
            The consequence is deliberate and severe. The market-level index abstains almost everywhere.
            Most per-maker indices abstain. Every composite we assemble bottom-up from makers abstains
            when it can&rsquo;t seat enough measurable components. We publish{' '}
            <span style={strong}>less, on purpose</span> — because a confident-looking wrong number is
            worse than an honest blank.
          </p>

          <h2 style={h2}>3 · The verified movers</h2>
          <p style={p}>
            The makers that clear the bar are the entire product. As of this writing there are{' '}
            <span style={strong}>three</span>, all watches, each surfaced at the longest horizon whose CI
            resolves (5Y &gt; 3Y &gt; 1Y) — the numbers below are read straight out of{' '}
            <V>makerIndex</V> in <V>market.json</V>:
          </p>
          <table style={table}>
            <thead>
              <tr><th style={th}>Maker</th><th style={{ ...th, textAlign: 'right' }}>horizon</th><th style={{ ...th, textAlign: 'right' }}>change</th><th style={{ ...th, textAlign: 'right' }}>95% CI</th><th style={{ ...th, textAlign: 'right' }}>lots</th></tr>
            </thead>
            <tbody>
              <tr><td style={td}>Cartier</td><td style={tdNum}>5Y</td><td style={tdNum}>+52.9%</td><td style={tdNum}>[19, 96]</td><td style={tdNum}>9,187</td></tr>
              <tr><td style={td}>Rolex</td><td style={tdNum}>5Y</td><td style={tdNum}>+25.1%</td><td style={tdNum}>[12, 39]</td><td style={tdNum}>21,098</td></tr>
              <tr><td style={td}>Patek Philippe</td><td style={tdNum}>3Y</td><td style={tdNum}>−18.2%</td><td style={tdNum}>[−26, −9]</td><td style={tdNum}>24,325</td></tr>
            </tbody>
          </table>
          <p style={p}>
            Rolex also publishes a 3Y (<V>+14.6%</V>, CI <V>[2, 28]</V>) and Patek a 1Y
            (<V>−9.6%</V>, CI <V>[−18, −1]</V>) — same maker, shorter windows, still resolved. Everything
            else — every artist, every design name, every sports and science bucket —{' '}
            <span style={strong}>abstains</span>, and the &ldquo;verified movers&rdquo; panel simply says
            so where a market has none. Three intervals that resolve the sign, standing behind real
            money, is the honest yield of a very large corpus.
          </p>

          <h2 style={h2}>4 · Demand vs ROI: two reads, and the divergence flag</h2>
          <p style={p}>
            The hedonic index is one of two market reads, and they check each other.{' '}
            <span style={strong}>Demand</span> (<V>app/lib/demand.ts</V>) is the median percent a lot
            sold <em>over its own estimate midpoint</em>, trailing twelve months. It&rsquo;s mix-proof by
            construction — a $900 print and a $3M canvas each beating ask by 60% count identically — which
            makes it a fast, wide signal. But it is a <span style={strong}>relative</span> beat, and the
            houses set the bar. A market can run &ldquo;hot&rdquo; on demand while the specialists quietly
            trim estimates: the lots keep beating ask, but ask keeps falling.
          </p>
          <p style={p}>
            That is exactly what the hedonic ROI is the <span style={strong}>absolute</span> check for.
            When demand is positive but the appreciation trend is meaningfully negative, the lander flags
            it — <V>roiFlag = &lsquo;beating soft estimates&rsquo;</V> (<V>IndexHero.tsx</V>) — so a buyer
            reads the heat correctly: it&rsquo;s clearing a softening bar, not real strength. Demand
            answers &ldquo;are lots beating the ask?&rdquo;; the hedonic index answers &ldquo;is the ask
            worth beating?&rdquo; The divergence is the interesting part.
          </p>

          <h2 style={h2}>5 · Sub-markets: the strongest honest read</h2>
          <p style={p}>
            Not everything is a maker, and not every maker earns an index. So every tracked slug is a
            &ldquo;sub-market&rdquo; (<V>scripts/sub-markets.ts</V>) that carries the{' '}
            <span style={strong}>strongest honest read its data supports</span>, and no stronger:
          </p>
          <table style={table}>
            <thead>
              <tr><th style={th}>read</th><th style={th}>when</th><th style={th}>what it shows</th></tr>
            </thead>
            <tbody>
              <tr><td style={td}><V>index</V></td><td style={td}>a real maker with a publishable CI&rsquo;d horizon</td><td style={td}>the verified price move + interval (Rolex, Patek, Cartier)</td></tr>
              <tr><td style={td}><V>demand</V></td><td style={td}>the slug carries estimates across enough quarters</td><td style={td}>quarterly median %-over-estimate (hammer basis)</td></tr>
              <tr><td style={td}><V>descriptive</V></td><td style={td}>no estimates, or not a maker</td><td style={td}>typical price · all-time record · volume — no appreciation</td></tr>
            </tbody>
          </table>
          <p style={p}>
            The last row is the discipline. A collectible <em>bucket</em> — meteorites, game-used,
            tickets-passes, trophies — is tagged <V>entityClass:&lsquo;category&rsquo;</V> in the type
            system: its lots are mutually incomparable objects under one thematic slug, so a
            like-for-like index is impossible (it posts <V>+900%</V> artifacts). The maker index refuses
            those at the door and they fall to a descriptive read: a typical price and a record, and{' '}
            <span style={strong}>no appreciation number at all</span>. There is no honest way to say a
            &ldquo;meteorites index is up 30%,&rdquo; so we don&rsquo;t.
          </p>

          <h2 style={h2}>6 · Why not a naive market index</h2>
          <p style={p}>
            This engine replaced a legacy cohort/appreciation index, and the replacement is a reaction to
            specific artifacts that index produced — the reasons a marketplace-wide &ldquo;the whole
            market is up X%&rdquo; number is a lie waiting to happen:
          </p>
          <table style={table}>
            <thead>
              <tr><th style={th}>Artifact</th><th style={th}>What it did</th></tr>
            </thead>
            <tbody>
              <tr><td style={td}>Seasonal cohort swing</td><td style={td}>A marquee-sale quarter over-samples expensive makers; the index jumps with the mix, not the market</td></tr>
              <tr><td style={td}>Partial-quarter endpoints</td><td style={td}>A half-reported latest quarter prints a spike or crater that reverses when the rest of the sales land</td></tr>
              <tr><td style={td}>Integer rounding / mean-pinning</td><td style={td}>Rounding and mean sensitivity manufacture motion out of a thin, heavy-tailed quarter</td></tr>
              <tr><td style={td}>Backfill composition breaks</td><td style={td}>An archive backfill floods one endpoint with one source; the &ldquo;change&rdquo; is the flood, not price</td></tr>
              <tr><td style={td}>Card-dominated &lsquo;all&rsquo;</td><td style={td}>Sports-cards are 71–92% of the whole-corpus quarters under one slug — a shift in <em>which</em> cards sold masquerades as market movement</td></tr>
            </tbody>
          </table>
          <p style={p}>
            The honest engine answers each of these by <em>abstaining</em> rather than emitting a
            confident number. That card-dominance case is live: the market-wide <V>&lsquo;all&rsquo;</V>{' '}
            index refuses every horizon because one maker-slug (<V>sports-cards</V>) is 71–92% of the
            endpoint quarters, so the hedonic control can&rsquo;t hold quality constant within it. The
            art market shows the subtler version: its market-level index reads down (3Y <V>−14.1%</V>, 5Y{' '}
            <V>−30.6%</V>), but its bottom-up composite still abstains, because{' '}
            <span style={strong}>zero</span> art makers publish a defensible per-maker horizon. Picasso is
            the reason in miniature — his recent quarters are 88–92% prints with no reference-level
            control, so a shift in <em>which</em> prints sold would leak straight into the time effect.
            The gate catches it and the maker abstains.
          </p>

          <h2 style={h2}>7 · What this costs, and what it buys</h2>
          <p style={p}>
            The cost is coverage: three verified movers across a corpus of{' '}
            <span style={strong}>{meta.totalLots.toLocaleString()} lots</span> from {meta.sources.length}{' '}
            sources. Watches assemble a composite that resolves at 5Y (<V>+25.5%</V>, Rolex / Patek /
            Cartier at a capped 35/35/30); most verticals never seat enough measurable components to
            compose at all. That is a small published surface for a very large amount of data — and it is
            the point. Every appreciation figure the site shows has a 95% interval behind it that
            resolves the sign, ends on a complete quarter, survives a composition-break check, and holds
            the within-maker mix constant. Where it can&rsquo;t, it says so.{' '}
            <span style={strong}>We publish less, on purpose — and everything we publish, we can defend.</span>
          </p>
          <p style={{ ...p, marginTop: 28 }}>
            <Link href="/analytics" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              See the verified movers
            </Link>
            <Link href="/about" style={{ marginLeft: 18, fontSize: 14, color: 'var(--color-text-muted)' }}>
              Or read the systems walk-through
            </Link>
          </p>
        </article>
      </main>
      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}
