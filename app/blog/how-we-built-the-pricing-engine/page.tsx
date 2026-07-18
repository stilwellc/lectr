import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../../components/ArtistNav';
import meta from '../../../public/data/ray/meta.json';
import { Colophon } from '../../components/Terminal';

export const metadata: Metadata = {
  title: 'The pricing engine, quantitatively — estimator, gates, calibration, and the ablations that failed',
  description:
    'The full math of lectr\'s comparable-sales engine: an IDF-cosine similarity kernel, a recency-decayed weighted median, hammer-basis correction, shrunk empirical calibration, split-conformal bands — and the models that measured worse.',
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
          <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
            <Link href="/blog" style={{ color: 'inherit', textDecoration: 'none' }}>Notes from the desk</Link> · July 16, 2026 · technical
          </p>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 38px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.15, margin: '0 0 14px' }}>
            The pricing engine, quantitatively
          </h1>
          <p style={{ ...p, fontSize: 16.5 }}>
            The estimator, the gates, the calibration, the validation protocol — and the ablations that
            measured worse. Everything below is fit and re-fit nightly on a corpus of ~36,000 priced sales
            and validated on a strict temporal holdout of every call the engine would have made since 2000.
          </p>
        </header>

        <article style={wrap}>
          <h2 style={h2}>0 · Notation and the target</h2>
          <p style={p}>
            A lot <V>ℓ</V> arrives with a house estimate band <V>[E_lo, E_hi]</V> (hammer basis) and sells
            at a realized price <V>R</V> (premium-inclusive). Write <V>m = (E_lo + E_hi)/2</V> for the
            estimate midpoint. The engine&rsquo;s job is <span style={strong}>not</span> to predict <V>R</V> —
            we measured ourselves against the houses&rsquo; own specialists at absolute pricing and lost
            (§7). The target is directional: estimate the level at which the lot&rsquo;s comparable pool
            currently clears, and flag the lot when that level is far from the ask.
          </p>

          <h2 style={h2}>1 · The similarity kernel</h2>
          <p style={p}>
            Comps are same-maker sold lots scored by a lexical kernel with structured bonuses. Titles are
            tokenized (stopworded, lightly singularized, biographical parentheticals stripped, the
            maker&rsquo;s own name words dropped — each hygiene step holdout-validated; the parenthetical
            strip alone moved art coverage 19.8→21.1% <em>and</em> edge +2pt). Tokens are weighted by
            inverse document frequency over the sold corpus:
          </p>
          <Formula caption="wₜ = IDF weight of token t; N = sold lots in the corpus; dfₜ = lots whose title carries t. cos is the cosine over the two titles' sparse IDF vectors.">
{`w_t = log( N / df_t )

cos(a,b) = Σ_t w_t(a) · w_t(b)  /  ( ‖w(a)‖ · ‖w(b)‖ )`}
          </Formula>
          <p style={p}>
            Structured agreement adds bonuses on top of the lexical read — same watch reference{' '}
            <V>+0.08</V>, same model line <V>+0.06</V>, same entity (player, mission) <V>+0.05</V>, same
            year <V>+0.04</V>, matching dimensions <V>+0.04</V>, same event <V>+0.04</V> — and the
            composite is scored on a 0–100 scale:
          </p>
          <Formula>
{`score(a,b) = round( 100 · ( cos(a,b) + Σ bonuses ) )`}
          </Formula>

          <h2 style={h2}>2 · The comp gate</h2>
          <p style={p}>A candidate enters the pool only if both the raw lexical read and the composite clear a bar:</p>
          <Formula caption="The fallback tier fires only when the strict pool cannot seat three comps; its output is capped at medium confidence and published as its own backtest row so the headline never silently blends.">
{`admit(c)    ⟺  cos ≥ 0.50  ∧  score ≥ 65
fallback(c) ⟺  cos ≥ 0.45  ∧  score ≥ 55    (only when |pool| < 3)`}
          </Formula>
          <p style={p}>
            Both pairs of constants came from A/B on the temporal holdout, not taste: the structured gate
            admitted <span style={strong}>+5% more coverage at identical edge</span> versus the old
            raw-cosine floor, and the fallback tier&rsquo;s marginal cohort measured{' '}
            <span style={strong}>+38.9% median / 63.1% beat</span> — statistically indistinguishable from
            the main engine. Per-market gate overrides were tested and rejected: no market prefers
            different constants; the score bar binds, the cosine floor is nearly inert across 0.45–0.55.
          </p>

          <h2 style={h2}>3 · The estimator</h2>
          <p style={p}>
            The pool&rsquo;s clearing level is a weighted median over the top-K comps by score
            (<V>K = 10</V>; K ∈ [5, 20] and the weight exponent were swept and are flat within noise),
            with weights that square the lexical read and decay with age:
          </p>
          <Formula caption="V = the engine's comp value. aᵢ = years between comp i's sale and the target's sale date; h = 2 years in estimate markets, 1 year in bid markets (memorabilia cycles faster — both measured). wmed = weighted median.">
{`w_i  =  cos_i²  ·  2^( −a_i / h )

V    =  wmed( { R_i } , { w_i } )`}
          </Formula>
          <p style={p}>
            The recency term is the survivor of a decay family tested on holdout: <V>h = 2y</V> added{' '}
            <span style={strong}>+1.1pt of edge at identical coverage</span>, and the flags it removed had
            been realizing exactly like unflagged lots — stale-comp false positives. A median, not a mean,
            because auction tails are heavy; weighted, because a 0.93-cosine comp is better evidence than
            a 0.55 one.
          </p>

          <h2 style={h2}>4 · The signal, and the buyer&rsquo;s-premium identity</h2>
          <Formula caption="r = the comp ratio. The below threshold is NOT 1.0 — and the reason is an accounting identity, not a tuning choice.">
{`r = V / m

label(ℓ) =  below   if  r ≥ 1.30
            above   if  r ≤ 0.75
            at      otherwise`}
          </Formula>
          <p style={p}>
            Realized prices are premium-inclusive while estimates are set on hammer. Across every lot in
            the corpus carrying both figures, the premium is remarkably flat:
          </p>
          <Formula caption="Flat 22–26% across houses and price bands. A pool trading exactly at its estimates therefore reads r ≈ 1.25 — flags in the 1.2–1.3 band were pure premium, not edge, which is why the threshold sits at 1.30.">
{`median( R / H )  =  1.250          H = hammer price

⇒   E[ r | pool trades at estimate ]  ≈  1.25`}
          </Formula>
          <p style={p}>
            Roughly <span style={strong}>70% of our original &ldquo;+40% vs estimate&rdquo; headline was
            this identity</span>, not alpha. Every public figure now leads with the hammer basis:
            performance is <V>H/m − 1</V> with <V>H = R/1.25</V> imputed where the house didn&rsquo;t
            publish a hammer (93% do). On that basis the record reads +15% flagged vs −5% unflagged — and
            the above-market call, which looked wrong premium-inclusive (+7%), is revealed as right
            (−11% at the hammer).
          </p>

          <h2 style={h2}>5 · Calibration: the displayed probability</h2>
          <p style={p}>
            The UI prints <V>P(beat)</V> — the chance the lot clears its high estimate — as a step
            function of <V>r</V>, re-fit from the full replay at every nightly build, per market, with
            recency weighting and shrinkage toward the global rate:
          </p>
          <Formula caption="b indexes the r-buckets (edges 0.6 / 0.9 / 1.3 / 2 / 10); ωⱼ = 2^(−ageⱼ/3y); yⱼ = 1 if lot j beat its high estimate; p_g = the global bucket rate; k = 60 pseudo-observations of shrinkage; min-n guards fall back to global. Monotonicity is enforced across the normal buckets — and deliberately NOT across the last one.">
{`p̂(b, mkt)  =  ( Σ_j ω_j · y_j  +  k · p_g(b) )  /  ( Σ_j ω_j  +  k )`}
          </Formula>
          <p style={p}>
            The honest detail: the final bucket (<V>r ≥ 10</V>) is <em>allowed to drop</em>, because it
            measurably does — extreme ratios are where data faults live, and the fitted rate falls to
            ~57–59% against a naive monotone extrapolation of 69%+. The engine tells users its confidence{' '}
            <em>decreases</em> out there. The displayed value band is split-conformal rather than a
            comp-price quantile:
          </p>
          <Formula caption="q̂ = empirical quantiles of realized/V on the holdout, per confidence tier. Held-out coverage 71–77%, versus 42–51% for the old comp-quantile band — 'high' confidence was, embarrassingly, the least honest band before this.">
{`band(ℓ)  =  [ V · q̂₀.₁₅(tier) ,   V · q̂₀.₈₅(tier) ]`}
          </Formula>

          <h2 style={h2}>6 · Validation protocol</h2>
          <p style={p}>
            One instrument produces every number above: a strict temporal holdout. For each concluded
            estimate-bearing lot, the engine replays with the comp roster truncated at the lot&rsquo;s own
            sale date, through the exact production code path:
          </p>
          <Formula caption="No hindsight: a lot's own result never participates in its own call, and neither does anything dated on or after it. Bought-in lots are scored as outcomes — a below-market flag on a lot that then failed to sell is a miss, not an exclusion.">
{`pool(ℓ)  =  { c  :  maker(c) = maker(ℓ)  ∧  t_c < t_ℓ }`}
          </Formula>
          <table style={table}>
            <thead>
              <tr><th style={th}>Cohort</th><th style={{ ...th, textAlign: 'right' }}>n</th><th style={{ ...th, textAlign: 'right' }}>median H/m − 1</th><th style={{ ...th, textAlign: 'right' }}>P(beat high)</th><th style={{ ...th, textAlign: 'right' }}>fail to sell</th></tr>
            </thead>
            <tbody>
              <tr><td style={td}>Flagged below</td><td style={tdNum}>7,768</td><td style={tdNum}>+15%</td><td style={tdNum}>45%</td><td style={tdNum}>9.0%</td></tr>
              <tr><td style={td}>Unflagged</td><td style={tdNum}>—</td><td style={tdNum}>−5%</td><td style={tdNum}>26%</td><td style={tdNum}>15.1%</td></tr>
              <tr><td style={td}>Flagged above</td><td style={tdNum}>—</td><td style={tdNum}>−11%</td><td style={tdNum}>—</td><td style={tdNum}>22.7%</td></tr>
            </tbody>
          </table>
          <p style={p}>
            The separation is monotone in every year of the series since 2000 (
            <Link href="/value" style={{ color: 'var(--color-fg)' }}>the chart is public</Link>), and the
            fail-to-sell gradient — 9.0% / 15.1% / 22.7% — is an out-of-sample check the estimator was
            never fit on.
          </p>

          <h2 style={h2}>7 · Ablations and negative results</h2>
          <p style={p}>What failed, with the numbers that killed it:</p>
          <table style={table}>
            <thead>
              <tr><th style={th}>Model</th><th style={th}>Result</th></tr>
            </thead>
            <tbody>
              <tr><td style={td}>Absolute hedonic regression — log R on size, year, medium, house</td><td style={td}>MdAPE 1.8–4.2× vs the houses&rsquo; own 1.25–1.45× — specialists win at absolute pricing</td></tr>
              <tr><td style={td}>Logistic P(beat) on log r, out-of-time</td><td style={td}>Brier worse by +0.0067 ± 0.0017 vs the recency-weighted step fit</td></tr>
              <tr><td style={td}>Full-feature logistic (pool size, dispersion, best-cos, comp age, market)</td><td style={td}>Every coefficient null except log r (z = 8.3); no learned score beats raw r for ranking</td></tr>
              <tr><td style={td}>Per-house estimate-bias adjustment of m</td><td style={td}>Null at house level (p = 0.84); maker-level actively dilutes (rank-corr 0.245 → 0.223) — maker estimate-lightness IS the harvested alpha</td></tr>
              <tr><td style={td}>Premium correction inside r instead of the claims layer</td><td style={td}>A near-constant /1.25 rescale absorbed by threshold re-tuning; matched flag sets overlap 97%</td></tr>
              <tr><td style={td}>Hard model-identity gate on the value path</td><td style={td}>−504 coverage, zero edge — the ranking already does the work</td></tr>
              <tr><td style={td}>Embedding / minhash retrieval</td><td style={td}>Retrieval failures are 0.5% of the coverage funnel; the binding constraint is candidate scarcity, not recall</td></tr>
            </tbody>
          </table>

          <h2 style={h2}>8 · Known limitations</h2>
          <p style={p}>
            The estimator is fuel-limited: ~55% of valuation failures are candidate scarcity (fewer than
            two usable same-maker priors), which is why the largest single improvement of the year was a
            19× archive backfill, not math. Coverage is honest but partial (~38% of estimate-bearing
            lots); edge compresses above $10K, exactly where mistakes are expensive; and bid-only markets
            carry a different guarantee (a realized-comp band, MdAPE ~39%, with no estimate to be
            directional against). All of it lives in the nightly replay, and the replay is the contract:{' '}
            <span style={strong}>measured on history, stated at the hammer, wrong in public when it&rsquo;s
            wrong.</span>
          </p>
          <p style={{ ...p, marginTop: 28 }}>
            <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              See the record
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
