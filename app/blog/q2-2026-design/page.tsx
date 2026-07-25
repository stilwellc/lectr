import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 design market in review — small money, real heat',
  description: 'The smallest market we track put up the strongest demand of the quarter: the median design lot hammered nearly 50% over its midpoint and 69% beat the high estimate. The Q2 2026 numbers.',
};

export default function Q2Design() {
  return (
    <QuarterInsight
      market="design"
      date="July 16, 2026"
      title="Design in Q2: small money, real heat"
      dek="The smallest market we track put up the strongest demand quality of the quarter: the median lot hammered nearly 50% over its estimate midpoint, more than two-thirds of lots beat their high estimate, and 88% of everything offered sold."
      stats={[
        { label: 'Total realized', value: '$5.9M', sub: '170 lots sold' },
        { label: 'Median sale', value: '$20,480', sub: 'across the designers we track' },
        { label: 'Sell-through', value: '88%', sub: 'buyers showed up' },
        { label: 'Beat the high estimate', value: '69%', sub: 'best of any market · 1.48× median', tone: 'up' },
      ]}
      headline={{
        image: '/blog/q2-2026-jeanneret-library-table.jpg',
        caption: 'Pierre Jeanneret — Illuminated Library Table, model PJ-TAT-10-B',
        priceUsd: 355_600,
        house: "Christie's",
        saleLine: 'June 10, 2026 · New York',
        para: <>Chandigarh furniture usually trades in the tens of thousands — chairs and desks made by the hundreds for Le Corbusier and Jeanneret&rsquo;s planned city. The illuminated library table is the other end of that market: a rare, architectural fixture built for the city&rsquo;s institutions, with far fewer survivors. At $355,600 it set the quarter&rsquo;s design ceiling and outran the typical Jeanneret lot by more than thirtyfold — proof that within &ldquo;production&rdquo; furniture, scarcity of the specific model is everything.</>,
      }}
      topSales={[
        { title: 'Pierre Jeanneret — Illuminated Library Table, PJ-TAT-10-B', priceUsd: 355_600, house: "Christie's", date: '2026-06-10', maker: 'pierre-jeanneret' },
        { title: "George Nakashima — 'Frenchman's Cove II' Dining Table, 1968", priceUsd: 330_200, house: "Christie's", date: '2026-06-10', maker: 'george-nakashima' },
        { title: 'Jean Prouvé — sideboard', priceUsd: 294_400, house: "Sotheby's", date: '2026-06-09', maker: 'jean-prouve' },
        { title: 'Jean Prouvé — "Visiteur" armchair', priceUsd: 230_400, house: "Sotheby's", date: '2026-06-10', maker: 'jean-prouve' },
        { title: 'Jean Prouvé — "Visiteur" armchair', priceUsd: 166_400, house: "Sotheby's", date: '2026-06-10', maker: 'jean-prouve' },
      ]}
      movers={[
        { label: 'George Nakashima', slug: 'george-nakashima', chgPct: 20, n: 65 },
        { label: 'Jean Prouvé', slug: 'jean-prouve', chgPct: 14, n: 36 },
      ]}
      coolers={[
        { label: 'Charles & Ray Eames', slug: 'charles-eames', chgPct: -11, n: 18 },
        { label: 'Pierre Jeanneret', slug: 'pierre-jeanneret', chgPct: -11, n: 51 },
      ]}
      footnote="Design is thin enough that our engine abstains on designer-level appreciation — none of these cohorts clear the confidence bar. The moves shown are demand reads: how each maker's median lot is hammering against its own estimate right now, not a measured return."
    >
      <H>The strongest demand read we measured</H>
      <P>
        Design is a $5.9M market next to art&rsquo;s half-billion — and it out-demanded everything.
        The median lot hammered <B>48% over its estimate midpoint</B>, <B>69% cleared their
        high estimate outright</B>, and 88% of offered lots sold. Every other market we track was
        pickier. When small markets run this hot, it&rsquo;s usually supply-starved demand: the good
        material is scarce and the bidders know it. It&rsquo;s a demand signal, not a measured return —
        the cohorts here are too thin for our index to publish a price move, so we read it off the
        estimates instead.
      </P>
      <H>Christie&rsquo;s set the ceiling; Sotheby&rsquo;s and Wright carried the middle</H>
      <P>
        The two headline results — the Jeanneret illuminated library table at <B>$355,600</B> and
        Nakashima&rsquo;s <em>Frenchman&rsquo;s Cove II</em> at <B>$330,200</B> — both came out of
        Christie&rsquo;s June 10 design sale. But the value was spread: Sotheby&rsquo;s took the
        largest single share (45%, led by a run of Prouvé), with Wright the workhorse of the
        Nakashima and Chandigarh middle. No single room owned the quarter.
      </P>
      <H>Nakashima keeps grinding</H>
      <P>
        The durable signal is <B>Nakashima&rsquo;s +20% demand read across 65 sales</B> — the deepest
        volume in the vertical, still hammering well over estimate. Prouvé&rsquo;s +14% on 36 sales
        echoes it. Where the reads soften — Eames and Jeanneret both around −11% — it&rsquo;s a mix
        story: commodity production pieces dragging the median while the rare, architectural examples
        keep setting the ceiling.
      </P>
    </QuarterInsight>
  );
}
