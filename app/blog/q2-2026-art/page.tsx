import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 art market in review — a two-speed quarter',
  description: 'A $240M quarter carried almost entirely by one Christie’s evening. Masterpieces cleared; the middle got picky. KAWS kept repricing. The Q2 2026 art numbers.',
};

export default function Q2Art() {
  return (
    <QuarterInsight
      market="art"
      date="July 16, 2026"
      title="Art in Q2: a two-speed market"
      dek="A $240M quarter carried almost entirely by one Christie’s evening. The masterpieces cleared without drama — but only 56% of everything offered found a buyer, and the middle market did the sorting."
      stats={[
        { label: 'Total realized', value: '$239.7M', sub: '405 lots sold' },
        { label: 'Median sale', value: '$8,320', sub: '+44% vs Q2 2025', tone: 'up' },
        { label: 'Sell-through', value: '56%', sub: 'the quarter’s real story', tone: 'down' },
        { label: 'Hammer vs estimate', value: '1.00×', sub: 'median · 33% beat the high' },
      ]}
      topSales={[
        { title: 'Pablo Picasso — Tête de femme (Fernande)', priceUsd: 48_360_000, house: "Christie's", date: '2026-05-18', maker: 'pablo-picasso' },
        { title: 'Pablo Picasso — Homme à la guitare', priceUsd: 40_885_000, house: "Christie's", date: '2026-05-18', maker: 'pablo-picasso' },
        { title: 'Henri Matisse — Robe noire et robe violette', priceUsd: 34_560_000, house: "Christie's", date: '2026-05-18', maker: 'henri-matisse' },
        { title: 'Andy Warhol — Double Elvis [Ferus Type]', priceUsd: 27_085_000, house: "Christie's", date: '2026-05-18', maker: 'andy-warhol' },
        { title: 'Andy Warhol — Do It Yourself (Violin)', priceUsd: 25_935_000, house: "Christie's", date: '2026-05-18', maker: 'andy-warhol' },
      ]}
      movers={[
        { label: 'Pablo Picasso', chgPct: 30, n: 151 },
        { label: 'Raymond Pettibon (small sample)', chgPct: 1412, n: 9 },
        { label: 'Kenny Scharf (small sample)', chgPct: 525, n: 5 },
      ]}
      coolers={[
        { label: 'Andy Warhol', chgPct: -26, n: 89 },
        { label: 'KAWS', chgPct: -79, n: 24 },
        { label: 'George Condo (small sample)', chgPct: -78, n: 7 },
      ]}
      footnote="Pettibon, Scharf and Condo medians come from single-digit sale counts — treat those moves as anecdotes, not trends."
    >
      <H>One evening was the quarter</H>
      <P>
        All five of the quarter&rsquo;s top prices — two Picassos, a Matisse, and two major Warhols —
        hammered in a single Christie&rsquo;s evening on May&nbsp;18. Christie&rsquo;s took
        <B> 96% of the quarter&rsquo;s art value</B> across the makers we track; no other house cleared
        $4M. When the market wants to know where masterpiece demand stands, it currently gets one
        data point a season — and this one was firm.
      </P>
      <H>The middle did the sorting</H>
      <P>
        Below the marquee, discipline: the median lot hammered <B>exactly at its estimate</B> (1.00×),
        only a third beat the high, and <B>44% of everything offered failed to sell</B> — the weakest
        sell-through of any market we track this quarter. That combination — rising median, weak
        sell-through — usually means consignors are reaching on estimates and buyers are simply
        declining, not that demand collapsed. The lots that were priced to the comps cleared.
      </P>
      <H>The KAWS repricing continued</H>
      <P>
        The quarter&rsquo;s clearest lowlight: KAWS&rsquo;s median sale fell <B>79% year over year</B> across
        24 sales, and the quarter&rsquo;s most visible miss was a KAWS <em>COMPANION (ORIGINALFAKE)</em> that
        brought $297K against a $455K low estimate — 35% under the floor. Editions-heavy markets reprice
        fast in both directions; this one is still finding its level.
      </P>
    </QuarterInsight>
  );
}
