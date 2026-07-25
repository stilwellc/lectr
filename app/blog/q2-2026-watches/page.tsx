import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 watch market in review — the deepest, most liquid tape we track',
  description: '1,811 watches, $240M, near-total sell-through — and the only market where our engine will publish a return: Cartier +53% and Rolex +25% over five years, Patek −18% over three. The Q2 2026 numbers.',
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
      ]}
      footnote="The moves below are our hedonic index reads, each shown with its 95% confidence interval and the horizon over which it resolves. Where a maker's shorter-horizon interval spans zero — Rolex at one year, Audemars Piguet and Cartier at one and three — we don't publish a direction; watches is the one vertical where enough clears the bar to publish any return at all."
    >
      <H>The only tape we&rsquo;ll put a number on</H>
      <P>
        Watches were the easiest market to sell into all quarter — <B>97–98% sell-through</B> across
        1,811 lots, with the median hammering 35% over its estimate midpoint and 55% clearing the
        high outright. Nothing else we track comes close on clearance or on sample depth. That depth
        is why watches is the <em>only</em> vertical where our engine will publish a like-for-like
        return: the cohorts are big enough that a move survives its own confidence interval. Elsewhere
        we speak in demand; here we can speak in price.
      </P>
      <H>What the index actually says</H>
      <P>
        Three makers clear the bar, and they don&rsquo;t point the same way. <B>Cartier is up 52.9%
        over five years</B> (95% CI +19% to +96%) and <B>Rolex up 25.1%</B> (+12% to +39%) — durable,
        interval-backed appreciation on the deepest cohorts we hold. <B>Patek Philippe is down 18.2%
        over three years</B> (−26% to −9%): a real, resolved decline, not noise. The rest stay
        descriptive — Audemars Piguet&rsquo;s demand reads roughly flat (+2% over estimate), Omega
        soft (−12%), and at shorter horizons even Rolex&rsquo;s interval spans zero. We report the
        moves that resolve and hold the ones that don&rsquo;t.
      </P>
      <H>Trophies detached from the reference market</H>
      <P>
        The $10M Patek at the top of the quarter — and the four seven-figure Pateks behind it, all
        through Phillips — is the tell. Condition-and-rarity trophies keep setting records while the
        reference market beneath them reads flat-to-soft on the index. For a buyer, that&rsquo;s the
        opportunity: liquidity is total, but outside the unrepeatable pieces the comps have done the
        repricing and many estimates haven&rsquo;t caught up. The below-market flags our engine
        carries into Q3 sit in exactly that middle.
      </P>
    </QuarterInsight>
  );
}
