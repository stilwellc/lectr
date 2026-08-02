import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 watch market in review — the deepest, most liquid tape we track',
  description: '1,811 watches, $240M, near-total sell-through — the only market where our engine will publish a return: Cartier +51% and Rolex +24% over five years, Patek −13% over three, each with its confidence interval. What a CI means and why watches is the one vertical that clears the bar. The Q2 2026 numbers.',
};

export default function Q2Watches() {
  return (
    <QuarterInsight
      market="watch"
      date="July 16, 2026"
      title="Watches in Q2: the deepest tape we track"
      dek="1,811 watches sold for $240M — by far the most liquid, most measurable market we cover. It's also the only vertical where our engine clears the bar to publish a return: Cartier and Rolex are up over five years, Patek is down over three, and each read carries its confidence interval."
      stats={[
        { label: 'Total realized', value: '$239.9M', sub: '1,811 lots sold' },
        { label: 'Median sale', value: '$48,260', sub: 'across the makers we track' },
        { label: 'Sell-through', value: '97–98%', sub: 'deepest liquidity we track', tone: 'up' },
        { label: 'Hammer vs estimate', value: '1.35×', sub: 'median · 55% beat the high' },
      ]}
      headline={{
        image: 'https://dist.phillips.com/auction-assets/HK080226/234083_001.jpg?bg-color=ffffff&pad=0&fit=bounds&height=550&optimize=medium&width=605',
        caption: 'Patek Philippe — pink gold perpetual calendar chronograph',
        priceUsd: 10_287_360,
        house: 'Phillips',
        saleLine: 'May 30, 2026 · Hong Kong',
        para: <>The quarter&rsquo;s top watch, and one of the largest of the year: an historically important pink gold perpetual calendar chronograph with French calendar and moon phases, its case made by Vichet — the only known pink gold first-series example carrying British hallmarks. It brought $10,287,360 at Phillips&rsquo; May sale against a $3.1–6.1M estimate. Phillips owned the top of the quarter: it took <B>43% of all watch value</B> and every one of the five biggest results, all of them Patek. That&rsquo;s the pattern beneath a market our engine reads as broadly flat-to-soft — the trophy tier keeps setting records even as the reference market it sits above cools.</>,
      }}
      topSales={[
        { title: 'Patek Philippe — pink gold perpetual calendar chronograph, French calendar & moon phases (Vichet case)', priceUsd: 10_287_360, house: 'Phillips', date: '2026-05-30', maker: 'patek-philippe' },
        { title: 'Patek Philippe — yellow gold two-crown world-time with cloisonné enamel dial', priceUsd: 9_155_150, house: 'Phillips', date: '2026-05-09', maker: 'patek-philippe' },
        { title: 'Patek Philippe — a most probably unique white gold perpetual calendar split-seconds chronograph', priceUsd: 5_202_000, house: 'Phillips', date: '2026-06-13', maker: 'patek-philippe' },
        { title: 'Patek Philippe — an incredible, extremely well-preserved pink gold perpetual calendar', priceUsd: 3_992_000, house: 'Phillips', date: '2026-06-13', maker: 'patek-philippe' },
        { title: 'Patek Philippe — a rare, freshly unsealed white gold double-dial wristwatch', priceUsd: 3_728_300, house: 'Phillips', date: '2026-05-09', maker: 'patek-philippe' },
        { title: 'Patek Philippe — 18K white gold automatic perpetual calendar (ref. 3450)', priceUsd: 2_759_000, house: "Christie's", date: '2026-06-12', maker: 'patek-philippe' },
        { title: 'Audemars Piguet — unique platinum custom-order minute-repeating perpetual calendar', priceUsd: 2_454_100, house: "Christie's", date: '2026-05-11', maker: 'audemars-piguet' },
        { title: 'Cartier — Crash, yellow gold distorted oval wristwatch', priceUsd: 1_998_848, house: "Sotheby's", date: '2026-04-24', maker: 'cartier' },
        { title: 'Patek Philippe — unique yellow gold single-button chronograph', priceUsd: 1_966_080, house: "Sotheby's", date: '2026-04-24', maker: 'patek-philippe' },
        { title: 'Cartier — 18K gold asymmetric wristwatch', priceUsd: 1_822_750, house: "Christie's", date: '2026-05-11', maker: 'cartier' },
      ]}
      footnote="The moves below are our hedonic index reads, each shown with its 95% confidence interval and the horizon over which it resolves. Where a maker's shorter-horizon interval spans zero — Rolex at one and three years, Patek at one, Audemars Piguet and Cartier at one and three — we don't publish a direction; watches is the one vertical where enough clears the bar to publish any return at all."
    >
      <H>The only tape we&rsquo;ll put a number on</H>
      <P>
        Watches were the easiest market to sell into all quarter — <B>97–98% sell-through</B> across
        1,811 lots, with the median hammering 35% over its estimate midpoint and 55% clearing the high
        outright. Nothing else we track comes close on clearance or on sample depth: art buys in a
        third of what it offers, design ran 170 sold lots all quarter, and watches cleared better than
        ten times that with almost nothing left in the room. That depth is the whole reason watches is
        the <em>only</em> vertical where our engine will publish a like-for-like return. Elsewhere we
        speak in demand — how the median lot hammered against its own estimate — because the cohorts
        are too thin or too mixed to isolate a price move. Here the cohorts are big enough that a move
        survives its own confidence interval, so we can speak in price.
      </P>
      <H>What a confidence interval means here</H>
      <P>
        The engine runs a hedonic index per maker: a regression that holds reference, metal, size and
        condition-language constant and reads the residual as the market&rsquo;s move over time — then
        it reports the 95% confidence interval around that move. <B>The rule is simple: if the interval
        spans zero, we publish nothing.</B> A read of &ldquo;+8%, but anywhere from −5% to +21%&rdquo;
        isn&rsquo;t a direction, it&rsquo;s noise wearing a number, and we&rsquo;d rather say so than
        launder it into a headline. That is why a maker can appear at one horizon and vanish at another:
        the same cohort resolves cleanly over five years and dissolves into uncertainty over one. It is
        also why watches is the one place we quote a return at all — everywhere else the intervals never
        tighten enough to clear the bar.
      </P>
      <H>What the index actually says</H>
      <P>
        Three makers clear the bar, and they don&rsquo;t point the same way. <B>Cartier is up 51.2%
        over five years</B> (95% CI +19% to +92%) — the strongest resolved appreciation on the board,
        drawn from a 5,771-lot cohort, and a striking read for a house often filed under jewelry rather
        than horology. <B>Rolex is up 23.6% over five years</B> (+11% to +38%) — durable,
        interval-backed appreciation on the deepest cohort we hold, though its one- and three-year
        intervals still span zero. Against them, <B>Patek Philippe is down 12.9% over three years</B>
        (−21% to −4%): a real decline, not noise, even as its one- and five-year windows stay
        unresolved. The rest stay descriptive. Audemars Piguet&rsquo;s demand reads
        roughly flat (+2% over estimate) and its index spans zero at every horizon; Omega reads soft
        (−12% demand). We report the moves that
        resolve and hold the ones that don&rsquo;t.
      </P>
      <P>
        Read together, that is a bifurcated market. The two makers most exposed to the last cycle&rsquo;s
        speculative froth — Patek and, at the reference level, the hyped steel sport models — are the
        ones giving ground, while the design-led houses that never ran as hot, Cartier especially, are
        the ones compounding. It is the opposite of the story the trophy headlines tell, and it is
        exactly the kind of divergence the index exists to surface: the record-setter and the appreciating
        asset are not the same maker.
      </P>
      <H>Trophies detached from the reference market</H>
      <P>
        The top of the quarter is nearly all Patek and nearly all Phillips. The $10.3M perpetual
        calendar chronograph led, followed by a $9.2M cloisonné world-time and three more seven-figure
        Pateks — and <B>Phillips took 43% of all tracked watch value</B> and the five biggest results
        outright. Sotheby&rsquo;s (28%) and Christie&rsquo;s (26%) split most of the rest. Patek alone
        was 60% of tracked value, Rolex 16%, Cartier 15%. None of these approached a record — Patek&rsquo;s
        all-time high is the $31.2M Grandmaster Chime from 2019 — but they didn&rsquo;t need to: they are
        the tell that condition-and-rarity trophies keep clearing at full price while the reference market
        beneath them reads flat-to-soft on the index. Two of the quarter&rsquo;s most interesting results
        were Cartiers — a <em>Crash</em> at $2.0M and an asymmetric gold wristwatch at $1.8M — which is
        the trophy tape agreeing with the index for once: the maker the engine says is appreciating is
        also the one throwing surprises at the top.
      </P>
      <H>Where the opportunity sits</H>
      <P>
        For a buyer, the shape of this market is the opportunity. Liquidity is total — you can sell almost
        anything — but outside the unrepeatable pieces the comps have already done the repricing and many
        estimates haven&rsquo;t caught up, particularly in Patek references that are still marked to the
        last cycle. The below-market flags our engine carries into Q3 sit in exactly that middle: not the
        trophies, which clear at or above every estimate, but the deep, liquid reference tape where a
        resolved, interval-backed decline has outrun the catalogues. That is the one vertical where we
        can point at a number and defend it — so it&rsquo;s the one where we do.
      </P>
    </QuarterInsight>
  );
}
