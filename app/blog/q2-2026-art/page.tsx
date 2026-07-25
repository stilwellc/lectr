import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 art market in review — the trophies cleared, the middle got picky',
  description: 'A half-billion-dollar quarter split between two houses, led by a $48M Matisse and a $48M Picasso. Masterpieces cleared; two-thirds of everything offered sold; KAWS kept repricing. The Q2 2026 art numbers.',
};

export default function Q2Art() {
  return (
    <QuarterInsight
      market="art"
      date="July 16, 2026"
      title="Art in Q2: trophies cleared, the middle got picky"
      dek="A $509M quarter carried by the marquee evening sales, split almost evenly between Sotheby's and Christie's. The masterpieces cleared without drama — but about a third of everything offered failed to sell, and the print-heavy middle did the sorting."
      stats={[
        { label: 'Total realized', value: '$508.8M', sub: '638 lots sold' },
        { label: 'Median sale', value: '$12,558', sub: 'across the artists we track' },
        { label: 'Sell-through', value: '66%', sub: 'the quarter’s real story', tone: 'down' },
        { label: 'Hammer vs estimate', value: '1.33×', sub: 'median · 59% beat the high' },
      ]}
      headline={{
        image: '/blog/q2-2026-picasso-fernande.jpg',
        caption: 'Pablo Picasso — Tête de femme (Fernande)',
        priceUsd: 48_360_000,
        house: "Christie's",
        saleLine: 'May 18, 2026 · New York',
        para: <>Picasso&rsquo;s 1909 bronze of Fernande Olivier is proto-Cubism you can walk around — the moment the fractured planes of <em>Les Demoiselles</em> left the canvas and entered three dimensions. Casts of this head sit in MoMA and the Tate, and when one reaches the block the market treats it as infrastructure, not inventory: $48,360,000 at Christie&rsquo;s May evening sale, all but tied with the quarter&rsquo;s top lot — Matisse&rsquo;s <em>La Chaise lorraine</em> at $48.4M across town at Sotheby&rsquo;s. Two houses, two masterworks, essentially the same number: that&rsquo;s where the money was.</>,
      }}
      topSales={[
        { title: 'Henri Matisse — La Chaise lorraine', priceUsd: 48_405_000, house: "Sotheby's", date: '2026-06-01', maker: 'henri-matisse' },
        { title: 'Pablo Picasso — Tête de femme (Fernande)', priceUsd: 48_360_000, house: "Christie's", date: '2026-05-18', maker: 'pablo-picasso' },
        { title: 'Pablo Picasso — Arlequin (Buste)', priceUsd: 42_640_000, house: "Sotheby's", date: '2026-06-01', maker: 'pablo-picasso' },
        { title: 'Pablo Picasso — Homme à la guitare', priceUsd: 40_885_000, house: "Christie's", date: '2026-05-18', maker: 'pablo-picasso' },
        { title: 'Henri Matisse — Robe noire et robe violette', priceUsd: 34_560_000, house: "Christie's", date: '2026-05-18', maker: 'henri-matisse' },
      ]}
      movers={[
        { label: 'Pablo Picasso', slug: 'pablo-picasso', chgPct: 14, n: 266 },
        { label: 'Futura 2000', slug: 'futura-2000', chgPct: 6, n: 4 },
        { label: 'George Condo', slug: 'george-condo', chgPct: 5, n: 14 },
      ]}
      coolers={[
        { label: 'Andy Warhol', slug: 'andy-warhol', chgPct: -7, n: 125 },
        { label: 'KAWS', slug: 'kaws', chgPct: -25, n: 25 },
        { label: 'Tom Sachs (small sample)', slug: 'tom-sachs', chgPct: -55, n: 3 },
      ]}
      footnote="Art is print- and edition-dominated and our engine abstains on artist-level appreciation here — none of these cohorts clear the confidence bar. The moves shown are demand reads: how the median lot is hammering against its own estimate right now, not a measured return. Sachs traded only a handful of times in the quarter — treat that read as an anecdote."
    >
      <H>Two houses, two evenings, half a billion dollars</H>
      <P>
        The quarter&rsquo;s value lived in the May and June marquee sales, and it split almost evenly:
        <B> Sotheby&rsquo;s took 52% of the art we track, Christie&rsquo;s 46%</B> — no other house
        cleared 2%. The top five lots — two Matisses, three Picassos — ran $34.6M to $48.4M across
        both rooms. When the market wants to know where masterpiece demand stands, it gets a handful
        of data points a season, and this season they were firm.
      </P>
      <H>The middle did the sorting</H>
      <P>
        Below the marquee, discipline. About <B>a third of everything offered failed to sell</B> —
        the weakest sell-through of any market we track this quarter — even as the median lot hammered
        a healthy 33% over its midpoint. That combination reads as a two-speed market: consignors
        reaching on estimates and buyers simply declining the reaches, while lots priced to the comps
        cleared. Art is where our engine is quietest by design: it&rsquo;s a print-dominated tape, and
        we won&rsquo;t publish an artist-level return that the cohorts can&rsquo;t support.
      </P>
      <H>The KAWS repricing continued</H>
      <P>
        The clearest soft spot: <B>KAWS&rsquo;s demand read sits −25%</B> — the median KAWS lot
        hammering a quarter under its estimate — across 25 sales, the steepest of any name with real
        volume. Editions-heavy markets reprice fast in both directions; this one is still finding its
        level, and unlike the trophy tier there&rsquo;s enough turnover to say so plainly.
      </P>
    </QuarterInsight>
  );
}
