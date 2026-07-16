import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import Flick from '../components/Flick';

export const metadata: Metadata = {
  title: 'Notes from the desk',
  description: 'Writing from lectr — how the pricing engine works, what the market data actually says, and what we got wrong on the way.',
};

const POSTS = [
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
        <header style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px', marginBottom: 34 }}>
          <p style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', margin: '0 0 14px' }}>Notes from the desk</p>
          <h1 style={{ fontSize: 'clamp(30px, 4vw, 40px)', fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>
            What the data taught us
          </h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'var(--color-text-secondary)', margin: '12px 0 0', maxWidth: 560 }}>
            Occasional writing on how lectr reads the auction market — the methods, the measurements,
            and the wrong turns we kept the receipts for.
          </p>
        </header>

        <section style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px' }}>
          {POSTS.map(p => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              style={{ display: 'block', textDecoration: 'none', color: 'inherit', border: '1px solid var(--hairline)', borderRadius: 12, padding: '22px 24px', background: 'var(--color-bg-elevated)' }}
            >
              <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11.5, color: 'var(--color-text-faint)', marginBottom: 8 }}>
                {new Date(p.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
              </div>
              <h2 style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px', lineHeight: 1.3 }}>{p.title}</h2>
              <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--color-text-secondary)', margin: 0 }}>{p.dek}</p>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 14, fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>Read the note <Flick size={12} /></span>
            </Link>
          ))}
        </section>
      </main>
      <Colophon lotCount={53129} houseCount={9} record={null} />
    </div>
  );
}
