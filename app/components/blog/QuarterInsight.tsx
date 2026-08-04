import Link from 'next/link';
import ArtistNav from '../ArtistNav';
import Flick from '../Flick';
import { Colophon } from '../Terminal';
import { formatPrice } from '../../utils';

export interface TopSale { title: string; priceUsd: number; house: string; date: string; maker: string }
export interface Mover { label: string; chgPct: number; n: number; slug?: string }

const wrap: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '0 24px' };
const h2: React.CSSProperties = { fontFamily: 'var(--font-serif), serif', fontSize: 21, fontWeight: 400, letterSpacing: '-0.015em', margin: '42px 0 10px' };
const p: React.CSSProperties = { fontSize: 15.5, lineHeight: 1.7, color: 'var(--color-text-secondary)', margin: '0 0 16px' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '4px 0 8px', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--hairline)', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 12.5 };
const td: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid var(--hairline)', color: 'var(--color-text-secondary)' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-fg)', whiteSpace: 'nowrap' };

/** Prose paragraph + section head for the narrative body. */
export function P({ children }: { children: React.ReactNode }) { return <p style={p}>{children}</p>; }
export function H({ children }: { children: React.ReactNode }) { return <h2 style={h2}>{children}</h2>; }
export function B({ children }: { children: React.ReactNode }) { return <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>{children}</span>; }

/** Shared frame for the quarterly market notes — a stat band, the narrative
 *  sections, the top-sales table, movers, and the standing honesty footnote. */
export interface HeadlineLot {
  image: string;
  /** short display title for the caption */
  caption: string;
  priceUsd: number;
  house: string;
  saleLine: string;      // e.g. "May 18, 2026 · New York"
  para: React.ReactNode; // the lot's own paragraph
}

export default function QuarterInsight({
  market, title, dek, date, stats, children, topSales, movers, coolers, footnote, headline,
}: {
  market: string;
  title: string;
  dek: string;
  date: string;
  stats: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }[];
  children: React.ReactNode;
  topSales: TopSale[];
  movers?: Mover[];
  coolers?: Mover[];
  footnote?: string;
  headline?: HeadlineLot;
}) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="blog" />
      <div style={{ paddingTop: 28, paddingBottom: 60 }}>
        <header style={{ ...wrap, marginBottom: 6 }}>
          <p className="kicker" style={{ margin: '0 0 14px' }}>
            <Link href="/blog" style={{ color: 'inherit', textDecoration: 'none' }}>Notes from the desk</Link> · Q2 2026 in review · {date}
          </p>
          <h1 style={{ fontFamily: 'var(--font-serif), serif', fontSize: 'clamp(28px, 4vw, 36px)', fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1.16, margin: '0 0 12px' }}>{title}</h1>
          <p style={{ ...p, fontSize: 16 }}>{dek}</p>
        </header>

        {/* stat band */}
        <div style={{ ...wrap, margin: '18px auto 6px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1, background: 'var(--hairline)', border: '1px solid var(--hairline)', borderRadius: 12, overflow: 'hidden' }}>
            {stats.map(s => (
              <div key={s.label} style={{ background: 'var(--color-bg-elevated)', padding: '14px 16px' }}>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 5 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: s.tone === 'up' ? 'var(--color-up)' : s.tone === 'down' ? 'var(--color-down)' : 'var(--color-fg)' }}>{s.value}</div>
                {s.sub && <div style={{ fontSize: 11.5, color: 'var(--color-text-faint)', marginTop: 3 }}>{s.sub}</div>}
              </div>
            ))}
          </div>
        </div>

        <article style={wrap}>
          {headline && (
            <figure style={{ margin: '30px 0 34px' }}>
              {/* the lot of the quarter, presented as a catalogue plate: matted
                  photo with the settle vignette, caption rule, its own paragraph */}
              <div style={{
                position: 'relative', borderRadius: 14, overflow: 'hidden',
                border: '1px solid var(--hairline)', background: 'var(--color-bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220, maxHeight: 460,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={headline.image}
                  alt={headline.caption}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  style={{ width: '100%', maxHeight: 460, objectFit: 'contain', display: 'block', padding: 18 }}
                />
                <span aria-hidden style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  boxShadow: 'inset 0 0 0 1px rgba(242,238,227,0.05), inset 0 -46px 60px -34px rgba(12,10,6,0.55), inset 0 34px 44px -38px rgba(12,10,6,0.35)',
                }} />
              </div>
              <figcaption style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px',
                padding: '12px 2px 0', fontSize: 13.5, color: 'var(--color-text-muted)',
              }}>
                <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>{headline.caption}</span>
                <span>{headline.house} · {headline.saleLine}</span>
                <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: 'var(--color-fg)', fontWeight: 700 }}>{formatPrice(headline.priceUsd)}</span>
              </figcaption>
              <div style={{ marginTop: 14 }}>
                <p style={{ ...p, margin: 0 }}>{headline.para}</p>
              </div>
            </figure>
          )}
          {children}

          <h2 style={h2}>The top of the market</h2>
          <table style={table}>
            <thead><tr><th style={th}>Lot</th><th style={th}>House</th><th style={{ ...th, textAlign: 'right' }}>Realized</th></tr></thead>
            <tbody>
              {topSales.map(s => (
                <tr key={s.title + s.priceUsd}>
                  <td style={td}><Link href={`/makers/${s.maker}`} style={{ color: 'inherit', textDecorationColor: 'var(--hairline)', textUnderlineOffset: 3 }}>{s.title}</Link></td>
                  <td style={td}>{s.house}</td>
                  <td style={tdNum}>{formatPrice(s.priceUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(movers?.length || coolers?.length) ? (
            <>
              <h2 style={h2}>Movers</h2>
              <table style={table}>
                <thead><tr><th style={th}>Maker</th><th style={{ ...th, textAlign: 'right' }}>Median vs Q2 2025</th><th style={{ ...th, textAlign: 'right' }}>Sales</th></tr></thead>
                <tbody>
                  {[...(movers || []), ...(coolers || [])].map(m => (
                    <tr key={m.label}>
                      <td style={td}>{m.slug ? <Link href={`/makers/${m.slug}`} style={{ color: 'inherit', textDecorationColor: 'var(--hairline)', textUnderlineOffset: 3 }}>{m.label}</Link> : m.label}</td>
                      <td style={{ ...tdNum, color: m.chgPct >= 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>{m.chgPct >= 0 ? '+' : '−'}{Math.abs(Math.round(m.chgPct))}%</td>
                      <td style={tdNum}>{m.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-text-faint)', margin: '30px 0 0', borderTop: '1px solid var(--hairline)', paddingTop: 14 }}>
            Figures cover the {market} sales lectr tracked in Q2 2026 (April–June) — our coverage, not the
            entire market. Prices are premium-inclusive as published by the houses; &ldquo;vs estimate&rdquo;
            reads are taken at the hammer, since estimates are set on hammer. Small samples are flagged
            where they occur.{footnote ? ` ${footnote}` : ''}
          </p>
          <p style={{ marginTop: 22 }}>
            <Link href="/blog" style={{ fontSize: 14, color: 'var(--color-text-muted)' }}><Flick size={11} style={{ transform: 'scaleX(-1)', marginLeft: 0, marginRight: 2 }} /> All notes</Link>
          </p>
        </article>
      </div>
      <Colophon record={null} />
    </div>
  );
}
