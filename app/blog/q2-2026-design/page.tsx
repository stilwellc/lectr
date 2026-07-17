import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 design market in review — the strongest demand of any vertical',
  description: 'Small in dollars, hottest in demand: 43% of design lots beat their high estimate at the hammer, the best read of any market lectr tracks. The Q2 2026 numbers.',
};

export default function Q2Design() {
  return (
    <QuarterInsight
      market="design"
      date="July 16, 2026"
      title="Design in Q2: small money, real heat"
      dek="The smallest market we track put up the strongest demand quality of the quarter: 43% of lots beat their high estimate at the hammer, 82% of everything offered sold, and the median more than doubled year over year."
      stats={[
        { label: 'Total realized', value: '$2.7M', sub: '102 lots sold' },
        { label: 'Median sale', value: '$14,080', sub: '+126% vs Q2 2025', tone: 'up' },
        { label: 'Sell-through', value: '82%', sub: 'buyers showed up' },
        { label: 'Beat the high estimate', value: '43%', sub: 'best of any market · 1.13× median', tone: 'up' },
      ]}
      headline={{
        image: '/blog/q2-2026-jeanneret-library-table.jpg',
        caption: 'Pierre Jeanneret — Illuminated Library Table, model PJ-TAT-10-B',
        priceUsd: 355_600,
        house: "Christie's",
        saleLine: 'June 10, 2026 · New York',
        para: <>Chandigarh furniture usually trades in the tens of thousands — chairs and desks made by the hundreds for Le Corbusier and Jeanneret&rsquo;s planned city. The illuminated library table is the other end of that market: a rare, architectural fixture built for the city&rsquo;s institutions, with far fewer survivors. At $355,600 it set the quarter&rsquo;s design ceiling and outran the typical Jeanneret lot by more than twentyfold — proof that within &ldquo;production&rdquo; furniture, scarcity of the specific model is everything.</>,
      }}
      topSales={[
        { title: 'Pierre Jeanneret — Illuminated Library Table, PJ-TAT-10-B', priceUsd: 355_600, house: "Christie's", date: '2026-06-10', maker: 'pierre-jeanneret' },
        { title: "George Nakashima — 'Frenchman's Cove II' Dining Table, 1968", priceUsd: 330_200, house: "Christie's", date: '2026-06-10', maker: 'george-nakashima' },
        { title: 'George Nakashima — Special-order Conoid dining table', priceUsd: 153_600, house: 'Wright', date: '2026-05-13', maker: 'george-nakashima' },
        { title: 'Jean Prouvé — Cabinet, model no. 150', priceUsd: 142_545, house: 'Phillips', date: '2026-04-30', maker: 'jean-prouve' },
        { title: 'George Nakashima — Special-order Triple Sliding Door cabinet', priceUsd: 102_400, house: 'Wright', date: '2026-05-13', maker: 'george-nakashima' },
      ]}
      movers={[
        { label: 'Charles & Ray Eames', slug: 'charles-eames', chgPct: 284, n: 17 },
        { label: 'George Nakashima', slug: 'george-nakashima', chgPct: 40, n: 42 },
        { label: 'Pierre Jeanneret', slug: 'pierre-jeanneret', chgPct: 3, n: 36 },
      ]}
      coolers={[
        { label: 'Jean Prouvé (small sample)', slug: 'jean-prouve', chgPct: -47, n: 7 },
      ]}
      footnote="Prouvé traded only 7 times in the quarter — the drop is a mix shift, not a verdict."
    >
      <H>The strongest demand read we measured</H>
      <P>
        Design is a $2.7M market next to art&rsquo;s $240M — and it out-demanded everything.
        The median lot hammered <B>13% over its estimate midpoint</B>, 43% cleared their
        <em> high</em> estimate outright, and 82% of offered lots sold. Every other market
        we track was pickier. When small markets run this hot, it&rsquo;s usually supply-starved
        demand: the good material is scarce and the bidders know it.
      </P>
      <H>Christie&rsquo;s June 10 set the ceiling; Wright carried the volume</H>
      <P>
        The two headline results — the Jeanneret illuminated library table at <B>$355,600</B> and
        Nakashima&rsquo;s <em>Frenchman&rsquo;s Cove II</em> at <B>$330,200</B> — both came out of
        Christie&rsquo;s June 10 design sale. But Wright moved the most value across the quarter
        ($1.5M of the $2.7M), the steady middle of the Nakashima and Chandigarh markets.
      </P>
      <H>Eames woke up</H>
      <P>
        The mover of the quarter: <B>Charles &amp; Ray Eames, median up 284%</B> across 17 sales —
        driven by special-order and early-production pieces rather than the commodity lounge chairs.
        Nakashima&rsquo;s +40% on 42 sales is the more durable signal: that market keeps grinding higher
        on genuinely deep trading volume.
      </P>
    </QuarterInsight>
  );
}
