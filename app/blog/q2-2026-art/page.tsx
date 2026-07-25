import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 art market in review — the trophies cleared, the middle got picky',
  description: 'A half-billion-dollar quarter split between two houses, led by a $48M Matisse and a $48M Picasso — with Picasso alone half the tracked value. Masterpieces cleared, a third of everything offered bought in, and KAWS kept repricing. Why the engine abstains on art appreciation. The Q2 2026 art numbers.',
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
        { title: 'Pablo Picasso — Buste de femme', priceUsd: 31_011_500, house: "Sotheby's", date: '2026-06-01', maker: 'pablo-picasso' },
        { title: 'Andy Warhol — Double Elvis [Ferus Type]', priceUsd: 27_085_000, house: "Christie's", date: '2026-05-18', maker: 'andy-warhol' },
        { title: 'Andy Warhol — Do It Yourself (Violin)', priceUsd: 25_935_000, house: "Christie's", date: '2026-05-18', maker: 'andy-warhol' },
        { title: 'Andy Warhol — Brigitte Bardot', priceUsd: 24_830_000, house: "Sotheby's", date: '2026-06-01', maker: 'andy-warhol' },
        { title: 'Pablo Picasso — La femme enceinte, 1er état', priceUsd: 22_485_000, house: "Christie's", date: '2026-05-18', maker: 'pablo-picasso' },
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
        Almost the entire quarter&rsquo;s value lived in the May and June marquee sales, and it split
        cleanly down the middle: <B>Sotheby&rsquo;s took 52% of the art we track, Christie&rsquo;s
        46%</B> — no other house cleared 1%. Phillips, Bonhams and Wright, between them, moved under
        $10M of the tracked $509M; the trophy business is a two-room business, and this quarter both
        rooms were full. The top five lots — two Matisses, three Picassos — ran $34.6M to $48.4M
        across the two evenings. When the market wants to know where masterpiece demand stands, it
        gets a handful of data points a season, and this season they were firm.
      </P>
      <P>
        Three names carried the money. <B>Picasso alone was 51% of tracked art value</B> — half of
        the quarter&rsquo;s twelve eight-figure results were his, from the $48.4M <em>Tête de femme
        (Fernande)</em> down through <em>Buste de femme</em> at $31.0M and <em>La femme enceinte,
        1<sup>er</sup> état</em> at $22.5M. <B>Matisse added 24%</B>, anchored by <em>La Chaise
        lorraine</em> and <em>Robe noire et robe violette</em>. <B>Warhol added 19%</B> off a single
        Christie&rsquo;s consignment tranche. Everyone else — Condo, Haring, Ruscha and the rest of
        the roster combined — split the remaining ~6%. That is what a trophy quarter looks like on the
        tape: a few objects doing almost all of the work, and a long, quiet tail underneath.
      </P>
      <H>Warhol: the trophies moved, the cohort didn&rsquo;t</H>
      <P>
        Warhol is the clean case study for why we separate a headline from a market. Three Warhols
        cleared the block for real money — <em>Double Elvis [Ferus Type]</em> at $27.1M, <em>Do It
        Yourself (Violin)</em> at $25.9M, and <em>Brigitte Bardot</em> at $24.8M, the last of which
        beat its high estimate by better than a third. And yet <B>Warhol&rsquo;s demand read sits −7%</B>
        across 125 sales this quarter: the median Warhol lot hammered under its own estimate. The
        paintings are not the market; the market is the hundreds of prints and editions beneath them,
        and that cohort softened even as the canvases set the ceiling. His all-time record — the $195M
        <em> Shot Sage Blue Marilyn</em> from 2022, still the most expensive work of the whole roster —
        went nowhere near a challenge this season, and nothing in the quarter tried.
      </P>
      <H>The middle did the sorting</H>
      <P>
        Below the marquee, discipline. About <B>a third of everything offered failed to sell</B> —
        the weakest sell-through of any market we track this quarter — even as the median lot hammered
        a healthy 33% over its midpoint and 59% of sold lots beat their high estimate outright. That
        combination reads as a genuinely two-speed market: consignors reaching on estimates and buyers
        simply declining the reaches, while lots priced to the comps cleared without fuss. It is the
        opposite of the watch tape, where near-everything sells; here the buy-in is the story, and it
        is doing the work an index would do in a deeper market — sorting fair asks from hopeful ones.
      </P>
      <H>Why the engine stays quiet on art</H>
      <P>
        Art is where our engine is quietest, and that is on purpose. It is a print- and
        edition-dominated tape: Picasso&rsquo;s typical tracked lot is a few thousand dollars, not a
        few million; Warhol&rsquo;s median sits around $30K; KAWS around $2K. The eight-figure oils
        are the exception, not the sample. We do run a maker-level hedonic index here, but <B>none of
        these cohorts clears the 95% confidence bar</B> — the mix of forms and sizes is too wide and
        the trophy tape too thin for a like-for-like return to survive its own interval. So on art we
        <em> abstain</em> on appreciation and speak only in demand: how the median lot is hammering
        against its own estimate right now. When you see Picasso at +14% or Matisse near flat, that is
        a demand read on this quarter&rsquo;s estimates, not a measured price move — and it is the most
        we&rsquo;ll honestly assert. Where enough turns over to speak plainly, we do.
      </P>
      <H>The KAWS repricing continued</H>
      <P>
        The clearest soft spot with real volume behind it: <B>KAWS&rsquo;s demand read sits −25%</B> —
        the median KAWS lot hammering a quarter under its estimate — across 25 sales, and his
        sell-through, at 86%, is among the weakest of any name we track. Editions-heavy markets reprice
        fast in both directions, and KAWS is still finding his level well below the 2019 peak that set
        his $14.8M record. The rest of the young-contemporary and street cohort echoed it: Kenny Scharf
        at −26%, Raymond Pettibon at −18%, Ed Ruscha&rsquo;s print market at −7%. On the other side,
        the firmer reads were modest and thin — Futura 2000 at +6% on just four sales, George Condo at
        +5% on 14 — anecdotes more than trends. The signal of the quarter isn&rsquo;t any single mover;
        it&rsquo;s the shape: trophies firm, editions picky, and the engine declining to pretend it can
        see through the gap.
      </P>
    </QuarterInsight>
  );
}
