import type { Metadata } from 'next';
import JsonLd from '../../components/JsonLd';
import { postMeta, postLd } from '../posts';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';
import { PullQuote } from '../../components/blog/Editorial';

const POST = {
  title: 'Q3 2026 design market in review — the Nakashima quarter',
  description: 'A summer quarter run almost entirely through Wright, and almost entirely on George Nakashima: the median design lot sold at 1.37× its estimate midpoint and 70% beat the high estimate, both up on Q3 2025. The Q3 2026 numbers.',
};
export const metadata: Metadata = postMeta('q3-2026-design', POST);

export default function Q3Design() {
  return (
    <>
      <JsonLd data={postLd('q3-2026-design', POST)} />
    <QuarterInsight
      market="design"
      quarter="Q3 2026"
      months="July–September"
      basis="sold"
      moversHeader="Demand vs estimate"
      date="October 22, 2026"
      title="Design in Q3: the Nakashima quarter"
      dek="A quiet summer calendar run almost entirely through one house and one maker — and hotter than the same quarter a year ago: the median lot sold at 1.37× its estimate midpoint, 70% beat the high estimate, and 91% of offered lots sold."
      stats={[
        { label: 'Total realized', value: '$1.58M', sub: '125 lots sold · +6% on Q3 2025' },
        { label: 'Median sale', value: '$5,376', sub: 'across the designers we track' },
        { label: 'Sell-through', value: '91%', sub: '96% in Q3 2025' },
        { label: 'Beat the high estimate', value: '70%', sub: 'vs 55% a year ago · 1.37× median', tone: 'up' },
      ]}
      headline={{
        image: '/blog/q3-2026-nakashima-triple-cabinet.jpg',
        caption: 'George Nakashima — Triple Sliding Door cabinet',
        priceUsd: 96_000,
        house: 'Wright',
        saleLine: 'September 16, 2026 · Modern Design',
        para: <>Nakashima built his reputation on the slab — the free-edged board left as the tree gave it — but the case pieces are where the joinery shows. This one is the canonical form: a long walnut carcass under a live-edge top that overhangs the ends, three sliding doors of fine vertical slats over a woven backing, the whole thing lifted on plank feet. It is a design the New Hope workshop made repeatedly, which is exactly why the result is informative: against a $40–50K estimate it sold for <B>$96,000</B>, nearly double the high, and set the quarter&rsquo;s design ceiling. When a repeatable model clears its estimate by that much, the premium is going to the particular board on top — the figure, the edge, the width — not to rarity of the form.</>,
      }}
      topSales={[
        { title: 'George Nakashima — Triple Sliding Door cabinet', priceUsd: 96_000, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
        { title: 'George Nakashima — Exceptional Conoid dining table', priceUsd: 76_800, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
        { title: 'George Nakashima — Exceptional Conoid desk', priceUsd: 70_400, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
        { title: 'George Nakashima — Conoid chairs, set of six', priceUsd: 70_400, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
        { title: 'George Nakashima — Exceptional Conoid bench', priceUsd: 63_840, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
        { title: 'George Nakashima — Conoid Cross-Legged occasional table', priceUsd: 57_600, house: 'Wright', date: '2026-08-13', maker: 'george-nakashima' },
        { title: 'George Nakashima — special-order cabinet', priceUsd: 44_800, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
        { title: 'George Nakashima — Exceptional special-order Minguren II dining table', priceUsd: 38_400, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
        { title: 'George Nakashima — Kornblut cabinets, pair', priceUsd: 35_840, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
        { title: 'George Nakashima — Hanging Wall cabinet', priceUsd: 33_280, house: 'Wright', date: '2026-09-16', maker: 'george-nakashima' },
      ]}
      movers={[
        { label: 'George Nakashima', slug: 'george-nakashima', chgPct: 51, n: 52 },
        { label: 'Pierre Jeanneret', slug: 'pierre-jeanneret', chgPct: 37, n: 13 },
        { label: 'Charles & Ray Eames', slug: 'charles-eames', chgPct: 17, n: 59 },
      ]}
      footnote="Design is thin enough that our engine abstains on designer-level appreciation — none of these cohorts clears the confidence bar. The figures in Movers are demand reads: how far each maker's median lot sold over its own estimate midpoint this quarter, not a measured return. No tracked maker's median sold under estimate, so there are no coolers to show."
    >
      <H>A summer quarter, and a hotter one</H>
      <P lede>
        Design&rsquo;s third quarter is structurally small. The major houses hold their big design sales
        in late spring and in December, so July through September belongs largely to Wright:
        <B> Wright took 99.7% of the $1.58M we tracked</B>, with a pair of Bonhams lots making up the
        rest. Judged against itself — Q3 2025, run the same way — it was a better quarter. Value rose
        about 6% on slightly fewer lots (125 sold against 136), and demand quality improved on every
        measure: the median lot sold at <B>1.37× its estimate midpoint</B> against 1.20× a year ago,
        <B> 70% beat the high estimate</B> against 55%, and only 6% sold under the low, down from 13%.
        Sell-through slipped from 96% to 91% — twelve lots bought in against six — which is the one soft
        number in an otherwise firmer quarter.
      </P>
      <P>
        Two caveats keep this honest. First, set beside Q2&rsquo;s $5.9M and 1.54× read, Q3 is a summer
        lull, not a turn — the spring quarter carries the Christie&rsquo;s, Sotheby&rsquo;s and Phillips
        design sales, and summer doesn&rsquo;t. Second, these are demand reads, not returns. With 125 sold
        lots across four makers, our engine won&rsquo;t publish a designer-level price index; nothing
        clears the confidence bar. A lot selling 37% over its own midpoint says the room wanted it more
        than the specialist expected — not that the same cabinet is worth 37% more than last year. The
        median sale price actually fell, from $6,368 to $5,376, because the mix tilted toward Eames
        production pieces; that&rsquo;s composition, not a decline.
      </P>
      <H>One sale, one maker</H>
      <P>
        The quarter came down to <B>Wright&rsquo;s September 16 Modern Design sale</B>: 40 tracked lots,
        $1.03M — about two-thirds of everything we recorded in Q3 — and 36 of those lots, $1.01M of the
        value, were Nakashima. The same sale did the same job last September ($994K on 47 lots), so this
        isn&rsquo;t an anomaly; it is the shape of the summer design market. Nakashima took <B>83% of the
        quarter&rsquo;s value</B> and every one of the ten biggest results. The core of it was a run of
        Conoid furniture — the line named for the concrete-shell studio Nakashima built in New Hope — with
        a dining table, desk, set of six chairs and a bench bringing a combined $281,440 on the
        day.
      </P>
      <P>
        What changed from a year ago is depth rather than ceiling. Last Q3&rsquo;s top lot, a Conoid bench
        at $104,775, outsold anything this quarter. But the band beneath it filled in: <B>22 lots cleared
        $25,000</B> this quarter against 14 in Q3 2025, worth $913K against $661K. The sharpest single
        read came in August, when a Conoid Cross-Legged occasional table estimated at $15–20K sold for
        $57,600 — nearly three times its high. The counterweight sat in the same September room: the
        Minguren II dining table, the quarter&rsquo;s one big Nakashima to miss, sold at $38,400 under its
        $40K low.
      </P>
      {/* the pull — lifted verbatim from the closing paragraph below */}
      <PullQuote>Hot, but less euphoric — which is a healthier place for a market to sit.</PullQuote>
      <H>The maker reads: Nakashima cools from very hot, Eames and Jeanneret firm</H>
      <P>
        <B>Nakashima&rsquo;s demand read is +51% across 52 sales</B>, with 85% of lots over the high
        estimate and only one bought in. That is still the strongest deep read in design, and the median
        Nakashima lot rose 14% on the year, from $19,685 to $22,400 — though it is a mix median, not an
        index. It is also down from +64% in Q3 2025: estimates appear to be catching up with the room.
        Hot, but less euphoric — which is a healthier place for a market to sit.
      </P>
      <P>
        The other two reads firmed. <B>Eames at +17% on 59 sales</B> (from +11%) is the volume end of the
        vertical — mostly Herman Miller production seating, a median lot of $1,536, and the most bought-in
        lots of any maker at eight, for an 88% sell-through. <B>Jeanneret at +37%</B> is up from +17%,
        but on just 13 sales against 25 a year ago, its tracked value roughly halved to $117K and its
        sell-through was the weakest in the vertical at 81%. Fewer Chandigarh pieces came up, and the
        ones that did sold well; call it a modest sample, not a trend. Prouvé had a single sale and
        doesn&rsquo;t get a read.
      </P>
    </QuarterInsight>
    </>
  );
}
