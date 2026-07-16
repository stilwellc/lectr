import type { Metadata } from 'next';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';

export const metadata: Metadata = {
  title: 'How lectr works — architecture & the price engine',
  description: 'An engineer’s guide to lectr: the daily crawl, the data pipeline, the corpus/served split, and the value engine that turns comparable sales into a directional buy signal.',
};

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto', padding: '0 24px' };
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '52px 0 6px' };
const kicker: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: '0 0 14px' };
const p: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: 'var(--color-text-secondary)', margin: '0 0 14px' };
const li: React.CSSProperties = { fontSize: 15, lineHeight: 1.6, color: 'var(--color-text-secondary)', margin: '0 0 8px' };
const code: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: 13, background: 'var(--color-bg-elevated)', padding: '1px 6px', borderRadius: 5, color: 'var(--color-fg)' };
const caption: React.CSSProperties = { fontSize: 12.5, color: 'var(--color-text-faint)', margin: '2px 0 26px', fontStyle: 'italic' };

/* ── responsive flow-diagram primitives — reflow to any width, never scroll ── */
function Flow({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 560, margin: '10px auto 22px', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>{children}</div>;
}
function Node({ title, sub, mono, tone, style }: { title: string; sub?: string; mono?: boolean; tone?: 'accent'; style?: React.CSSProperties }) {
  return (
    <div style={{
      border: `1px solid ${tone === 'accent' ? 'color-mix(in srgb, var(--color-accent-gold) 50%, var(--hairline))' : 'var(--hairline)'}`,
      boxShadow: tone === 'accent' ? '0 0 0 1px color-mix(in srgb, var(--color-accent-gold) 12%, transparent), 0 6px 24px -14px color-mix(in srgb, var(--color-accent-gold) 40%, transparent)' : undefined,
      borderRadius: 10, padding: '12px 15px', background: 'var(--color-bg-elevated)', ...style,
    }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-fg)', lineHeight: 1.35 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, fontFamily: mono ? 'var(--font-mono), monospace' : undefined, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}
function Down({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '7px 0' }}>
      {label && <span style={{ fontSize: 10.5, color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono), monospace', letterSpacing: '0.02em' }}>{label}</span>}
      <span aria-hidden style={{ color: 'var(--color-text-faint)', fontSize: 15, lineHeight: 1 }}>↓</span>
    </div>
  );
}
function Branch({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div>;
}
const branchItem: React.CSSProperties = { flex: '1 1 150px', minWidth: 0 };

export default function AboutPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="about" />

      <main id="main" style={{ paddingTop: 28, paddingBottom: 40 }}>
        <header style={{ ...wrap, marginBottom: 8 }}>
          <p style={kicker}>How it works</p>
          <h1 style={{ fontSize: 'clamp(30px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.025em', margin: '0 0 12px' }}>
            The architecture, the pipeline, and the price engine
          </h1>
          <p style={{ ...p, fontSize: 16 }}>
            lectr reads every auction estimate against every hammer. It ingests live and historical
            lots from the major houses, scores each against comparable sales, and calls whether a lot
            is trading below or above where its comps actually clear. This page is the engineering
            walk-through: the data flow, the storage split, the value engine, and how the signal is
            validated. It assumes you read code.
          </p>
        </header>

        <section style={wrap}>
          <p style={kicker}>01 · System</p>
          <h2 style={h2}>A static site with a nightly build</h2>
          <p style={p}>
            There is no application server. The entire product is a Next.js 14 <code style={code}>output: &apos;export&apos;</code> static
            bundle on Cloudflare Pages. All intelligence is computed ahead of time by a nightly crawl +
            build, baked into JSON, and shipped as static assets. The client is a pure reader.
          </p>
          <Flow>
            <Node title="Auction houses" sub="Sotheby’s · Christie’s · Goldin · Bonhams · Phillips · Wright · Rago · Heritage · Bruun Rasmussen" />
            <Down label="ingest" />
            <Node tone="accent" title="Daily crawl — scripts/ray-crawl.ts" sub="per-house adapter → item-level routing → status lifecycle → reconcile → sanitize → coverage tripwire → write-gate" />
            <Down label="writeCorpusAndServed()" />
            <Node title="Corpus — data/corpus/*.json.gz" sub="full v2, ~76 fields/lot, gzipped. The source of truth. Never served to the client." />
            <Down label="engine build pass" />
            <Branch>
              <Node style={branchItem} title="build-market" sub="values every lot + market index series" />
              <Node style={branchItem} title="build-upcoming" sub="eager client payload, signals precomputed" />
              <Node style={branchItem} title="build-backtest" sub="temporal-holdout replay" />
            </Branch>
            <Down label="slim projection (engine fields stripped)" />
            <Node title="Served — public/data/ray/*.json" sub="< 25 MB / file (Cloudflare cap)" />
            <Down label="git push → CI guards → Cloudflare Pages" />
            <Node title="Static client — Next.js export" sub="no server; 3-phase progressive load" />
          </Flow>
          <p style={caption}>The daily crawl is the only writer. A data commit to <code style={code}>main</code> triggers the same deploy pipeline as a code change.</p>
        </section>

        <section style={wrap}>
          <p style={kicker}>02 · Ingestion</p>
          <h2 style={h2}>The crawl, and the status lifecycle</h2>
          <p style={p}>
            Each house has its own adapter (Sotheby&apos;s GraphQL, Christie&apos;s <code style={code}>chrComponents</code> JSON,
            Goldin&apos;s faceted <code style={code}>lots_v2</code> API, HTML scrapers for the rest). Routing is
            strictly <em>item-level</em> — a lot is classified by its own attributes, never by the sale it
            came from — with hard doctrine gates: auctions only (never buy-now), sports means objects
            (never cards), science excludes video games.
          </p>
          <p style={p}>
            The hard part isn&apos;t fetching — it&apos;s the lifecycle. Houses close a sale hours before they post
            results, and some purge lots the instant an auction ends. So the crawler holds
            <strong> &ldquo;never silently lose a tracked lot&rdquo;</strong> as the invariant:
          </p>
          <Flow>
            <Node title="upcoming" sub="a live or scheduled lot" />
            <Down label="sale date passes, no result yet" />
            <Node tone="accent" title="results-pending" sub="house hasn’t posted a hammer — HELD VISIBLE as upcoming for 14 days (RESULT_PENDING_MS) so a just-closed lot never vanishes" />
            <Down label="resolves to one of" />
            <Branch>
              <Node style={branchItem} title="sold" sub="hammer posted → terminal" />
              <Node style={branchItem} title="bought_in / unknown-result" sub="> 14 days, still no result (withdrawn if it just disappeared)" />
            </Branch>
          </Flow>
          <ul style={{ paddingLeft: 20, margin: '0 0 14px' }}>
            <li style={li}><strong>reconcile + sanitize passes</strong> — house-agnostic nets that resolve zombie states and demote genuinely-stale rows, gated so a transient fetch failure can&apos;t withdraw a live lot.</li>
            <li style={li}><strong>coverage tripwire</strong> — snapshots active-lots-per-market before the crawl mutates anything, and alerts if a market&apos;s live inventory collapses.</li>
            <li style={li}><strong>write-gate</strong> — <code style={code}>assertInvariants()</code> refuses to publish a corpus that violates the schema (e.g. a sold lot with no price).</li>
          </ul>
        </section>

        <section style={wrap}>
          <p style={kicker}>03 · Data model</p>
          <h2 style={h2}>The corpus / served split, and money as a fact</h2>
          <p style={p}>
            The v2 schema carries ~76 fields per lot, which blows past Cloudflare&apos;s 25&nbsp;MB/file cap. So
            storage is split: the <strong>corpus</strong> (<code style={code}>data/corpus/*.json.gz</code>) is the full
            gzipped source of truth the build reads; the <strong>served</strong> files
            (<code style={code}>public/data/ray/*.json</code>) are a slim projection with engine-only fields
            (<code style={code}>titleTokens</code>, FX internals, fingerprints) stripped out.
          </p>
          <p style={p}>
            Currency is modelled so the price-vs-estimate math is honest: the <strong>native</strong> amount
            is the fact; <strong>USD is derived</strong> through a dated FX table (a 2015 sale uses the 2015
            rate). Every price records a <code style={code}>priceBasis</code>. Same-object identity is
            title-tokens + structured attributes scored as a percentage — never an image hash (different
            houses shoot the same object differently), never raw title equality.
          </p>
        </section>

        <section style={wrap}>
          <p style={kicker}>04 · The price engine</p>
          <h2 style={h2}>From comparable sales to a directional call</h2>
          <p style={p}>
            The engine (<code style={code}>app/lib/similarity.ts</code>, <code style={code}>value.ts</code>,
            <code style={code}> indices.ts</code>) values a lot against its own maker&apos;s sold history. It does
            not try to out-price the house on a unique work — measurement showed absolute comp valuation
            loses to expert estimates on one-of-a-kind art. What <em>is</em> validated is the
            <strong> direction</strong>: is this lot cheap or dear relative to where its comps clear?
          </p>
          <Flow>
            <Node title="A lot to value" sub="an upcoming lot — or a held-out sold lot in the backtest" />
            <Down label="candidate blocking: same-maker sold (backtest: dated < the lot, no leak)" />
            <Node title="similarity(lot, comp)" mono sub="cosine( IDF-weighted title-token vectors ) 0..1  +  structured bonus (model / reference / entity / dims / year).  score = round((cos + bonus) × 100)" />
            <Down label="for each comp" />
            <Node tone="accent" title="comp-pool gate — COMP_GATE" mono sub="keep comp iff  cosine ≥ 0.50  AND  score ≥ 65  (calibrated by the backtest A/B)" />
            <Down />
            <Node title="weightedMedian( top-K, weight = cosine² )" mono sub="= compValueUsd.  pool dispersion (q1..q3) → confidence tier" />
            <Down />
            <Node tone="accent" title="directional signal" mono sub="compRatio = compValueUsd / estimate-mid.  ≥ 1.30 → below comparable market (cheap) · ≤ 0.75 → above · else at" />
          </Flow>
          <ul style={{ paddingLeft: 20, margin: '0 0 14px' }}>
            <li style={li}><strong>Similarity</strong> is an IDF-weighted cosine over title tokens, plus a structured bonus for agreement on model/reference/entity/dimensions/year, combined into a 0–100 <code style={code}>score</code>.</li>
            <li style={li}><strong>The comp-pool gate</strong> keeps a comp when <code style={code}>cosine ≥ 0.50 AND score ≥ 65</code> — so a comp whose wording dips just under the old raw-cosine floor but whose structured agreement (same reference, same model) is strong is still counted.</li>
            <li style={li}><strong>The signal</strong> is <code style={code}>compRatio = compValue / estimate-mid</code>. Above 1.30 the lot is trading below its comps (a &ldquo;below comparable market&rdquo; flag); below 0.75 it&apos;s dear.</li>
          </ul>
          <p style={p}>
            Goldin sports/science lots carry no house estimate, so there the engine value <em>is</em> the
            estimate, shown against the live high bid.
          </p>
        </section>

        <section style={wrap}>
          <p style={kicker}>05 · Validation</p>
          <h2 style={h2}>Temporal-holdout backtest — no hindsight</h2>
          <p style={p}>
            The claim on <code style={code}>/value</code> (&ldquo;flagged calls beat their estimates by +X%&rdquo;) is
            produced by <code style={code}>build-backtest.ts</code>, which replays the <em>real</em> production
            engine over every concluded sale that carried an estimate. For each lot, the comp pool is
            restricted to sales dated strictly before it — a lot never sees its own result, or anything
            after it. The call is then scored against what the lot actually hammered for.
          </p>
          <p style={p}>
            That same harness is how engine changes ship: any tweak to the gate or scorer runs through
            the A/B before it goes live. The current gate broadening, for example, was adopted because it
            valued <strong>+5% more lots with an identical predictive edge</strong> (flagged median +40%,
            beat-high 63%, a 24-point edge over unflagged) — and the model hard-gate was <em>rejected</em>
            because it cost coverage for zero edge gain.
          </p>
        </section>

        <section style={wrap}>
          <p style={kicker}>06 · Client</p>
          <h2 style={h2}>Three-phase progressive load</h2>
          <p style={p}>
            Because the client is a static reader with a ~19&nbsp;MB tail of history, it loads in phases
            behind a module-level cache and listener fan-out (<code style={code}>app/hooks/useRayData.ts</code>).
            The first paint is driven by a small precomputed payload; the heavy history streams in behind
            it, and the 10&nbsp;MB sold archive is fetched only when a surface that needs it mounts.
          </p>
          <Flow>
            <Node tone="accent" title="Phase 1 — first paint" sub="upcoming.json (+ meta / stats / demand) ~400 KB. Signals are PRECOMPUTED at build time → the feed is interactive immediately." />
            <Down label="in the background" />
            <Node title="Phase 2 — full history" sub="lots.json ~9 MB. Merges in and re-attaches signal / soldComp to each lot by id." />
            <Down label="on demand" />
            <Node title="Phase 3 — sold archive" sub="sold-archive.json ~10 MB. Fetched ONLY when a sports/science comps modal opens; art/watch/design never pay for it." />
          </Flow>
        </section>

        <section style={wrap}>
          <p style={kicker}>07 · Deploy</p>
          <h2 style={h2}>Two guards, no broken deploys</h2>
          <p style={p}>
            Every push to <code style={code}>main</code> runs the export and two gates before it can leave a
            broken build live: <strong>Guard&nbsp;1</strong> verifies every JS chunk the exported HTML
            references actually exists in <code style={code}>out/</code>; <strong>Guard&nbsp;2</strong> hits the
            unique deployment URL after publish and confirms the home page&apos;s JS resolves as executable
            JavaScript. If either fails, the job fails loudly rather than leaving production broken.
          </p>
        </section>
      </main>

      <Colophon lotCount={43436} houseCount={9} record={null} />
    </div>
  );
}
