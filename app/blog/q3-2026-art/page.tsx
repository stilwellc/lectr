import type { Metadata } from 'next';
import JsonLd from '../../components/JsonLd';
import { postMeta, postLd } from '../posts';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';
import { PullQuote } from '../../components/blog/Editorial';

const POST = {
  title: 'Q3 2026 art market in review — a thin summer that cleared almost everything',
  description: 'A $38M summer quarter, a third of last year’s, with 92% of lots selling and the money arriving in one Hong Kong week: a $4.9M Matisse, a $4.2M Condo, a Calder and a KAWS that ran 4× its estimate midpoint. Lichtenstein’s estate came back for a second round, and the engine cleared one art return: Lichtenstein, down 32% over a year. The Q3 2026 art numbers.',
};
export const metadata: Metadata = postMeta('q3-2026-art', POST);

export default function Q3Art() {
  return (
    <>
      <JsonLd data={postLd('q3-2026-art', POST)} />
    <QuarterInsight
      market="art"
      quarter="Q3 2026"
      months="July–September"
      basis="sold"
      date="October 22, 2026"
      moversHeader="Demand vs estimate"
      title="Art in Q3: a thin summer that cleared almost everything"
      dek="A $38M quarter, about a third of last summer’s, with no eight-figure lot to carry it. What did come up sold — 92% of it — and nearly half the money arrived in a single late-September week in Hong Kong."
      stats={[
        { label: 'Total realized', value: '$38.3M', sub: '684 lots sold · $113.6M in Q3 2025', tone: 'down' },
        { label: 'Median sale', value: '$10,227', sub: 'vs $13,970 in Q3 2025' },
        { label: 'Sell-through', value: '92%', sub: '89% a year ago', tone: 'up' },
        { label: 'Sold vs estimate', value: '1.28×', sub: 'median · 60% beat the high' },
      ]}
      headline={{
        image: '/blog/q3-2026-condo-figures.jpg',
        caption: 'George Condo — Figures in Motion',
        priceUsd: 4_175_360,
        house: "Sotheby's",
        saleLine: 'September 28, 2026 · Hong Kong',
        para: <>Condo&rsquo;s <em>Figures in Motion</em> (2013) is one of his crowded &ldquo;drawing paintings&rdquo; — acrylic, charcoal and pastel on linen, heads and torsos split into planes and stacked edge to edge until the canvas reads as a single agitated crowd. It is the Picasso lineage Condo has always claimed, run through cartoon and caricature, and Hong Kong has become the room that pays for it. At HK$32.6M — $4,175,360 — it landed squarely inside its HK$24M–40M estimate, a hair above the midpoint, at Sotheby&rsquo;s Modern &amp; Contemporary evening sale. Not a stretch and not a discount: a fair price, cleanly met. A year ago Condo&rsquo;s best result in our Q3 tape was <em>Reclining Blue Form</em> at $2.3M, also in Hong Kong; this one nearly doubled it, and it was the second-biggest art lot of the quarter.</>,
      }}
      topSales={[
        { title: 'Henri Matisse — Jeune femme au canapé', priceUsd: 4_878_080, house: "Christie's", date: '2026-09-29', maker: 'henri-matisse' },
        { title: 'George Condo — Figures in Motion', priceUsd: 4_175_360, house: "Sotheby's", date: '2026-09-28', maker: 'george-condo' },
        { title: 'Henri Matisse — Femme nue', priceUsd: 2_691_840, house: "Sotheby's", date: '2026-09-28', maker: 'henri-matisse' },
        { title: 'Alexander Calder — Untitled', priceUsd: 1_802_240, house: "Sotheby's", date: '2026-09-28', maker: 'alexander-calder' },
        { title: 'KAWS — Camo Can’t Help You', priceUsd: 1_146_880, house: "Christie's", date: '2026-09-30', maker: 'kaws' },
        { title: 'Roy Lichtenstein — Blue Nude (Study)', priceUsd: 704_000, house: "Sotheby's", date: '2026-09-25', maker: 'roy-lichtenstein' },
        { title: 'Roy Lichtenstein — Virtual Interior: Portrait of a Duck (Study)', priceUsd: 704_000, house: "Sotheby's", date: '2026-09-25', maker: 'roy-lichtenstein' },
        { title: 'Pablo Picasso — Deux Têtes (recto); Buste d’homme et sexe féminin (verso)', priceUsd: 524_288, house: "Christie's", date: '2026-09-30', maker: 'pablo-picasso' },
        { title: 'Keith Haring — Untitled (Subway Drawing)', priceUsd: 512_000, house: "Christie's", date: '2026-09-30', maker: 'keith-haring' },
        { title: 'Roy Lichtenstein — Singapore Brushstrokes (Maquette)', priceUsd: 486_400, house: "Sotheby's", date: '2026-09-25', maker: 'roy-lichtenstein' },
      ]}
      movers={[
        { label: 'Alexander Calder', slug: 'alexander-calder', chgPct: 74, n: 23 },
        { label: 'Roy Lichtenstein', slug: 'roy-lichtenstein', chgPct: 54, n: 139 },
        { label: 'Henri Matisse', slug: 'henri-matisse', chgPct: 39, n: 27 },
      ]}
      coolers={[
        { label: 'Keith Haring', slug: 'keith-haring', chgPct: 19, n: 41 },
        { label: 'Raymond Pettibon', slug: 'raymond-pettibon', chgPct: 2, n: 19 },
        { label: 'Ed Ruscha', slug: 'ed-ruscha', chgPct: -4, n: 17 },
      ]}
      footnote="The Movers figure is a demand read — how far the median sold lot landed over (or under) its own estimate midpoint this quarter — not a measured return. The coolers are the softest reads among names with real volume; in a quarter this firm, most of them still cleared their midpoints. Hong Kong results are converted from HKD at about 0.128. About 80 lots from late-quarter sales had no posted result when these figures were cut and are left out of sell-through."
    >
      <H>A summer quarter, and it looked like one</H>
      <P lede>
        Q3 is the off-season for art, and the tape doesn&rsquo;t pretend otherwise. We tracked{' '}
        <B>$38.3M across 684 sold lots — down two-thirds from $113.6M in Q3 2025</B>, and a long
        way from the half-billion-dollar spring that preceded it. July was a handful of day and online sales worth
        $2.9M; August barely registered at $0.25M; <B>September carried 92% of the quarter&rsquo;s
        value</B>. Only five lots cleared $1M, against seventeen a year ago, and none came close to
        eight figures. Last summer had a $25.2M Picasso in Hong Kong, the Karpidas evening sale in
        London and the first, live round of the Lichtenstein estate; this summer had none of those,
        and the total shows it.
      </P>
      <P>
        What the headline hides is how well the quarter actually traded. <B>Sell-through was 92%</B>,
        up from 89% a year ago and a world away from the spring, when about a third of everything
        offered bought in. The median sold lot landed at 1.28× its estimate midpoint (1.23× a year
        ago), 60% beat the high estimate, and only 11% fell short of the low. Sotheby&rsquo;s took
        53% of the value, Christie&rsquo;s 32% and Phillips 9% — a less lopsided split than spring&rsquo;s
        two-room evening market, because there was less evening to split.
      </P>
      <H>Hong Kong was the evening</H>
      <P>
        The quarter&rsquo;s only real marquee week was Hong Kong at the end of September, and{' '}
        <B>28 lots sold there accounted for $17.5M — 46% of everything we tracked</B>. All of the top
        five lots came from it. The lot of the quarter was Matisse&rsquo;s <em>Jeune femme au canapé</em>,
        a small 1944 oil painted in Vence — a woman on a sofa, the subject at the center of his
        wartime interiors — which made <B>$4.88M (HK$38.1M) at Christie&rsquo;s against a HK$20M–30M
        estimate</B>, half again over its midpoint. Sotheby&rsquo;s evening sale a day earlier added
        Condo&rsquo;s <em>Figures in Motion</em> at $4.18M, Matisse&rsquo;s <em>Femme nue</em> at
        $2.69M and an untitled Calder at $1.80M, those last two inside their estimates rather than
        through them.
      </P>
      <P>
        The loudest result came from a day sale: <B>KAWS&rsquo;s <em>Camo Can&rsquo;t Help You</em> made
        $1.15M at Christie&rsquo;s, more than four times its HK$1.6M–2.6M estimate midpoint</B>. It was
        not alone. KAWS&rsquo;s demand read across 38 sales sits at +23%, against +10% in the same
        quarter last year and roughly flat in Q2; his median sold lot was $4,672, up from $2,476 a year
        ago. Sell-through, at 84%, is still among the weakest of any name we track — buyers are
        choosing — but the ones they chose, they chased.
      </P>
      {/* the pull — lifted verbatim from the paragraph above */}
      <PullQuote>Sell-through, at 84%, is still among the weakest of any name we track — buyers are choosing — but the ones they chose, they chased.</PullQuote>
      <H>The Lichtenstein estate, round two</H>
      <P>
        The quarter&rsquo;s biggest single sale by lot count was Sotheby&rsquo;s second offering from the
        collection of Dorothy and Roy Lichtenstein — this time online, and this time studies,
        maquettes and works on paper rather than paintings. <B>109 of 120 lots sold for $6.97M</B>, the
        median lot at 1.54× its midpoint, and 71 of the 109 beat the high estimate. <em>Blue
        Nude (Study)</em> and <em>Virtual Interior: Portrait of a Duck (Study)</em> each made $704,000
        on $300K–400K estimates; the <em>Singapore Brushstrokes</em> maquette made $486,400 on a
        $40K–60K estimate. Estate provenance and conservative estimates are a combination that reliably
        produces numbers like these.
      </P>
      <P>
        It is also a clean lesson in why medians mislead. Lichtenstein&rsquo;s median sold lot fell
        from $71,120 to $23,040 year over year — a 68% drop that says nothing about prices. Last
        September&rsquo;s estate round was a live sale with paintings and sculpture worth $26.5M across 90
        lots; this September&rsquo;s was studies and ephemera. Different objects, different medians.
        The same is true of Picasso: <B>193 sales at 97% sell-through and a +28% demand read</B>, but a
        median of $6,469 and a total of $3.8M, against $42.2M a year ago when one Hong Kong bust did
        most of the work.
      </P>
      <H>What the engine will and won&rsquo;t say</H>
      <P>
        Art remains where our engine says the least. It runs a maker-level hedonic index here, but it
        publishes a return only where the 95% interval resolves the sign — and on this tape, almost
        nothing does. Picasso, Warhol, Matisse, KAWS, Haring and Calder all fail the bar this quarter,
        either because the year-ago quarter is too thin to anchor (under 80 comparable sales) or
        because the mix is so print-heavy that form can&rsquo;t be held constant. <B>One art cohort
        cleared: Roy Lichtenstein, at −32% over one year, with an interval of −54% to −1%</B>, on 149
        sales then and 139 now. Read it carefully: the upper bound barely clears zero, and both
        quarters lean on his own estate sales. But it is a measured, like-for-like decline, and it sits
        right next to a +54% demand read — estimates set low enough that lots beat them comfortably
        while still trading below last year&rsquo;s level. Demand against an estimate and the price of
        the work are different questions; this quarter they gave different answers.
      </P>
      <H>Where it was soft</H>
      <P>
        Softness this quarter meant &ldquo;merely met the estimate.&rdquo; <B>Ed Ruscha was the only
        name with real volume to land under</B>, at −4% across 17 sales, with his $200K–300K canvas{' '}
        <em>Broken Clock</em> bought in at Sotheby&rsquo;s. Raymond Pettibon sat at +2% on 19 sales,
        but seven more of his lots failed to sell — a 73% sell-through, the weakest on the roster.
        Keith Haring held a +19% read on 41 sales, down from +33% a year ago, with a Kermit Oswald
        collection sale still posting results as we cut the numbers. Prints, the bulk of the tape at
        465 sold lots, traded at a median 1.29× their midpoint, up from 1.22× last summer. The shape of
        the quarter is simple: almost no trophies, very few failures, and a middle that bought what it
        was offered — at prices the engine, for one artist at least, can now say were lower than a year
        ago.
      </P>
    </QuarterInsight>
    </>
  );
}
