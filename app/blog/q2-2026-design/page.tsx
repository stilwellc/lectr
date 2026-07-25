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
        { title: "Charlotte Perriand — 'Tunisie' bookcase (La Maison de la Tunisie)", priceUsd: 165_100, house: "Christie's", date: '2026-06-10', maker: 'jean-prouve' },
        { title: 'Pierre Jeanneret — three-piece "easy" seating suite', priceUsd: 153_600, house: "Sotheby's", date: '2026-06-10', maker: 'pierre-jeanneret' },
        { title: 'George Nakashima — special-order Conoid dining table', priceUsd: 153_600, house: 'Wright', date: '2026-05-13', maker: 'george-nakashima' },
        { title: 'Jean Prouvé — Cabinet, model no. 150', priceUsd: 142_545, house: 'Phillips', date: '2026-04-30', maker: 'jean-prouve' },
        { title: 'George Nakashima — special-order Triple Sliding Door cabinet', priceUsd: 102_400, house: 'Wright', date: '2026-05-13', maker: 'george-nakashima' },
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
        The median lot hammered <B>48% over its estimate midpoint</B>, <B>69% cleared their high
        estimate outright</B> — the best of any vertical this quarter — and 88% of offered lots sold.
        Every other market we track was pickier at the hammer. When a small market runs this hot,
        it&rsquo;s usually supply-starved demand: the good material is scarce, it comes up rarely, and
        the bidders who want it know they may not see another this good for a year. That is exactly the
        texture of the postwar design market — a handful of makers, a finite number of documented,
        provenanced pieces, and a bench of collectors who chase condition.
      </P>
      <P>
        It bears repeating what this number is and isn&rsquo;t: a demand signal, not a measured return.
        The cohorts here are thin — 170 sold lots across four makers this quarter — so our engine
        won&rsquo;t publish a designer-level price index; none clears the confidence bar. We read the
        heat off the estimates instead. A lot hammering 48% over its own midpoint tells you the room
        wanted it more than the specialist who set the estimate expected; it does not tell you the same
        chair is worth 48% more than it was a year ago. On design we speak in demand and in the top of
        the table, and we stop there.
      </P>
      <H>The ceiling: scarcity of the specific model</H>
      <P>
        The two headline results — the Jeanneret illuminated library table at <B>$355,600</B> and
        Nakashima&rsquo;s <em>Frenchman&rsquo;s Cove II</em> dining table at <B>$330,200</B> — both came
        out of Christie&rsquo;s June 10 design sale, and both make the same point. The Nakashima carried
        a $40–60K estimate and brought more than five times its high; the Jeanneret table, estimated
        $150–250K, ran past both. These aren&rsquo;t records — Nakashima&rsquo;s all-time high is the
        $822K &ldquo;Arlyn&rdquo; table from 2006, Jeanneret&rsquo;s a $4.1M Le Corbusier canvas — but
        they sit far above the typical lot for each maker, and that gap is the whole thesis of the
        vertical: within &ldquo;production&rdquo; furniture built by the hundreds, the scarce, documented,
        architectural example is a different asset entirely from the commodity chair.
      </P>
      <H>House dynamics: no single room owned it</H>
      <P>
        The value was unusually spread for so small a market. <B>Sotheby&rsquo;s took the largest single
        share at 45%</B>, led by a run of Prouvé — the $294K sideboard and two &ldquo;Visiteur&rdquo;
        armchairs at $230K and $166K. <B>Wright took ~25%</B> as the workhorse of the Nakashima and
        Chandigarh middle, including a $154K special-order Conoid table and a $102K sliding-door cabinet.
        Christie&rsquo;s took ~23% but owned the two biggest lots. Where a trophy quarter in art or
        watches concentrates in one house, design stayed a three-room market — a sign the depth of
        demand is broad, not a single-sale artifact.
      </P>
      <H>The maker reads: Nakashima and Prouvé grind, the commodity end drags</H>
      <P>
        The durable signal is <B>Nakashima&rsquo;s +20% demand read across 65 sales</B> — the deepest
        volume in the vertical, still hammering well over estimate, and the maker most likely to reward
        a patient bidder. <B>Prouvé&rsquo;s +14% on 36 sales</B> echoes it, and the three makers split
        the tracked money almost in thirds: Nakashima 38%, Prouvé 34%, Jeanneret 26%. Where the reads
        soften — Eames and Jeanneret both around −11% — it&rsquo;s a mix story, not a demand collapse.
        Eames is mostly Herman Miller production furniture with a typical tracked lot near $1,250; when
        the median is a mass-made lounge chair, it drags even as the rare early example holds. Jeanneret
        is the sharper version of the same tension: 51 sales, an 83% sell-through (the weakest in the
        vertical), the commodity Chandigarh chairs pulling the median down while the illuminated library
        table sets the quarter&rsquo;s ceiling. One maker, two markets — and the median can only see one
        of them.
      </P>
    </QuarterInsight>
  );
}
