import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import Flick from '../components/Flick';
import { Colophon } from '../components/Terminal';
import Masthead, { Accent } from '../components/Masthead';
import meta from '../../public/data/ray/meta.json';

export const metadata: Metadata = {
  title: 'How lectr works — architecture & the price engine',
  description: 'An engineer’s guide to lectr: the daily crawl, the data pipeline, the corpus/served split, and the value engine that turns comparable sales into a directional buy signal.',
};

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto', padding: '0 24px' };
const kicker: React.CSSProperties = { fontFamily: 'var(--font-mono), monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: '0 0 6px' };
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
      <span aria-hidden style={{ color: 'var(--color-text-faint)', lineHeight: 1 }}>
        <Flick size={12} style={{ transform: 'scaleY(-1)', marginLeft: 0, display: 'block' }} />
      </span>
    </div>
  );
}
function Branch({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div>;
}
const branchItem: React.CSSProperties = { flex: '1 1 150px', minWidth: 0 };

/* ── the walk-through as a certificate index — each section a disclosure row.
      Native details/summary: kicker + title on the clasp, prose inside. ── */
function Section({ ord, label, title, defaultOpen, children }: {
  ord: string; label: string; title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <details className="ray-about-sec" open={defaultOpen} style={wrap}>
      <summary className="ray-about-sum">
        <span style={{ minWidth: 0 }}>
          <span style={{ ...kicker, display: 'block' }}>{ord} · {label}</span>
          <span style={{ display: 'block', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--color-fg)', lineHeight: 1.3 }}>{title}</span>
        </span>
        <span className="ray-about-flick" aria-hidden>
          <Flick size={13} style={{ transform: 'scaleY(-1)', marginLeft: 0, display: 'block' }} />
        </span>
      </summary>
      <div className="ray-about-body">{children}</div>
    </details>
  );
}

export default function AboutPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      {/* NOTE: keep this style block free of quotes, apostrophes and angle
          brackets — React escapes them in server-rendered raw-text elements
          and the browser keeps the entity literally. */}
      <style>{`
        .ray-about-sec { border-bottom: 1px solid var(--hairline); }
        .ray-about-sec:first-of-type { border-top: 1px solid var(--hairline); }
        .ray-about-sum {
          list-style: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 20px 0;
          -webkit-tap-highlight-color: transparent;
        }
        .ray-about-sum::-webkit-details-marker { display: none; }
        .ray-about-sum::marker { content: none; }
        .ray-about-flick {
          flex: none;
          color: var(--color-text-faint);
          transition: transform var(--duration-fast) var(--ease-signature);
        }
        .ray-about-sec[open] .ray-about-flick { transform: rotate(180deg); }
        .ray-about-sum:hover .ray-about-flick { color: var(--color-fg); }
        .ray-about-body { padding: 4px 0 28px; }
      `}</style>
      <ArtistNav activeSlug="about" />

      <main id="main" style={{ paddingTop: 28, paddingBottom: 40 }}>
        <div style={{ ...wrap, marginBottom: 26 }}>
          {/* the certificate masthead — dated from the last crawl on the book */}
          <Masthead
            kicker="The machine"
            serial={meta.lastCrawl}
            title={<>How lectr <Accent>reads</Accent> the market.</>}
            sub={<>
              <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{meta.totalLots.toLocaleString()} lots</b>
              {' '}from{' '}
              <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{meta.sources.length} houses</b>
              {' '}— the architecture, the pipeline, and the price engine, end to end.
            </>}
          />
          <p style={{ ...p, fontSize: 16, marginTop: 18, marginBottom: 0 }}>
            lectr reads every auction estimate against every hammer. It ingests live and historical
            lots from the major houses, scores each against comparable sales, and calls whether a lot
            is trading below or above where its comps actually clear. Seven sections, engineering
            depth — open what you came for. It assumes you read code.
          </p>
        </div>

        <Section ord="01" label="System" title="A static site with a nightly build" defaultOpen>
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
        </Section>

        <Section ord="02" label="Ingestion" title="The crawl, and the status lifecycle">
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
        </Section>

        <Section ord="03" label="Data model" title="The corpus / served split, and money as a fact">
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
        </Section>

        <Section ord="04" label="The price engine" title="From comparable sales to a directional call">
          <p style={p}>
            The engine values a lot against its own maker&apos;s sold history: an IDF-weighted title-token
            cosine plus structured agreement (model / reference / entity / dims / year) selects the
            comparable pool, a weighted median prices it, and the ratio against the estimate-mid becomes
            the directional call — below, at, or above the comparable market. It deliberately does not
            try to out-price the house on a one-of-a-kind work; what&apos;s validated is the <strong>direction</strong>.
          </p>
          <p style={p}>
            The full math — the similarity scorer, the comp-pool gate, and how both were calibrated —
            is written up in{' '}
            <Link href="/blog/how-we-built-the-pricing-engine" style={{ color: 'var(--color-fg)', fontWeight: 600 }}>
              How we built the pricing engine <Flick size={11} />
            </Link>.
          </p>
        </Section>

        <Section ord="05" label="Validation" title="Temporal-holdout backtest — no hindsight">
          <p style={p}>
            Every claim the signal makes is scored by <code style={code}>build-backtest.ts</code>, which replays
            the real production engine over each concluded sale with its comp pool restricted to sales
            dated strictly before it — a lot never sees its own result, or anything after it. Engine
            changes ship only through that A/B harness: a tweak is adopted when it adds coverage at the
            same predictive edge, and rejected when it trades coverage for nothing.
          </p>
          <p style={p}>
            The live record — how flagged calls actually hammered against their estimates, refreshed by
            every crawl — is printed on{' '}
            <Link href="/value" style={{ color: 'var(--color-fg)', fontWeight: 600 }}>
              /value <Flick size={11} />
            </Link>.
          </p>
        </Section>

        <Section ord="06" label="Client" title="Three-phase progressive load">
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
        </Section>

        <Section ord="07" label="Deploy" title="Two guards, no broken deploys">
          <p style={p}>
            Every push to <code style={code}>main</code> runs the export and two gates before it can leave a
            broken build live: <strong>Guard&nbsp;1</strong> verifies every JS chunk the exported HTML
            references actually exists in <code style={code}>out/</code>; <strong>Guard&nbsp;2</strong> hits the
            unique deployment URL after publish and confirms the home page&apos;s JS resolves as executable
            JavaScript. If either fails, the job fails loudly rather than leaving production broken.
          </p>
        </Section>
      </main>

      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}
