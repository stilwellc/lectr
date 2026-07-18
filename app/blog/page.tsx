import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import Flick from '../components/Flick';
import Masthead, { Underscore } from '../components/Masthead';
import meta from '../../public/data/ray/meta.json';

export const metadata: Metadata = {
  title: 'Notes from the desk',
  description: 'Writing from lectr — how the pricing engine works, what the market data actually says, and what we got wrong on the way.',
};

const POSTS = [
  {
    slug: 'q2-2026-art',
    date: '2026-07-16',
    title: 'Art in Q2: a two-speed market',
    dek: 'A $240M quarter carried by one Christie’s evening — masterpieces cleared, the middle got picky (56% sell-through), and KAWS kept repricing.',
  },
  {
    slug: 'q2-2026-watches',
    date: '2026-07-16',
    title: 'Watches in Q2: everything sells, the middle repriced',
    dek: '96% sell-through across 728 lots — but the median fell 19% while Patek Philippe ran +67%. A sorting, not a downturn.',
  },
  {
    slug: 'q2-2026-design',
    date: '2026-07-16',
    title: 'Design in Q2: small money, real heat',
    dek: 'The smallest market we track posted the strongest demand of the quarter: 43% of lots beat their high estimate, and Eames woke up.',
  },
  {
    slug: 'q2-2026-sports',
    date: '2026-07-16',
    title: 'Sports in Q2: game-used doubled',
    dek: 'A $1.34M four-player jersey group on top, Messi debut shirts behind it, and the typical sale up 73% — broad participation, not two whales.',
  },
  {
    slug: 'q2-2026-science',
    date: '2026-07-16',
    title: 'Science in Q2: the quiet quarter',
    dek: 'Ten sales — the honest number. Apollo photographs led, and the real season (241 lots on the block) closes in Q3.',
  },
  {
    slug: 'how-we-built-the-pricing-engine',
    date: '2026-07-16',
    title: 'How we built the pricing engine — and everything it got wrong first',
    dek: 'Seven thousand replayed auction calls, a buyer’s-premium problem hiding in plain sight, and why our best model is the one that admits what it can’t know.',
  },
];

export default function BlogIndex() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="blog" />
      <main id="main" style={{ paddingTop: 28, paddingBottom: 60 }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px', marginBottom: 34 }}>
          {/* the certificate masthead — dated from the crawl the notes read */}
          <Masthead
            kicker="Notes from the desk"
            serial={meta.lastCrawl}
            title={<>What the data <Underscore>taught us</Underscore>.</>}
            sub={<>
              {POSTS.length} notes on file · occasional writing on how lectr reads the auction market —
              the methods, the measurements, and the wrong turns we kept the receipts for.
            </>}
          />
        </div>

        <section style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {POSTS.map(p => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="ray-blog-card ray-paper"
              style={{ display: 'block', textDecoration: 'none', color: 'var(--color-fg)', border: '1px solid var(--paper-edge)', borderRadius: 12, padding: '22px 24px', background: 'var(--paper-butter)' }}
            >
              <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--color-text-faint)', marginBottom: 8, letterSpacing: '0.02em' }}>
                {new Date(p.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
              </div>
              <h2 style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px', lineHeight: 1.3 }}>{p.title}</h2>
              <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--color-text-secondary)', margin: 0 }}>{p.dek}</p>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 14, fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>Read the note <Flick size={12} /></span>
            </Link>
          ))}
        </section>
      </main>
      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}
