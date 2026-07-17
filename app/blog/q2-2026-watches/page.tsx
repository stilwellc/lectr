import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 watch market in review — everything sells, the middle repriced',
  description: '728 watches, 96% sell-through, $64.8M — and a median down 19% while Patek Philippe ran +67%. The flight to quality, in numbers.',
};

export default function Q2Watches() {
  return (
    <QuarterInsight
      market="watch"
      date="July 16, 2026"
      title="Watches in Q2: everything sells, the middle repriced"
      dek="The most liquid market we track — 96% of 700+ offered watches found buyers — but the median fell 19% year over year while Patek Philippe ran +67%. That’s not a downturn; it’s a sorting."
      stats={[
        { label: 'Total realized', value: '$64.8M', sub: '728 lots sold' },
        { label: 'Median sale', value: '$25,805', sub: '−19% vs Q2 2025', tone: 'down' },
        { label: 'Sell-through', value: '96%', sub: 'deepest liquidity we track', tone: 'up' },
        { label: 'Hammer vs estimate', value: '1.08×', sub: 'median · 32% beat the high' },
      ]}
      headline={{
        image: 'https://dist.phillips.com/auction-assets/NY080126/233450_001.jpg?bg-color=ffffff&pad=0&fit=bounds&height=550&optimize=medium&width=605',
        caption: 'Patek Philippe — the quarter’s top watch',
        priceUsd: 3_992_000,
        house: 'Phillips',
        saleLine: 'June 13, 2026 · New York',
        para: <>In a quarter where the average Rolex, Cartier and AP repriced down ~30%, the top of the Patek market did the opposite. This exceptionally preserved example brought $3,992,000 at Phillips&rsquo; June sale — the largest watch price of the quarter and the clearest statement of the sorting underway: condition-and-rarity trophies are detaching from the reference market beneath them. Phillips sold four of the quarter&rsquo;s five biggest watches; this one led them all.</>,
      }}
      topSales={[
        { title: 'Patek Philippe — an exceptionally well-preserved, highly important wristwatch', priceUsd: 3_992_000, house: 'Phillips', date: '2026-06-13', maker: 'patek-philippe' },
        { title: 'Patek Philippe — an extremely important and rare 18K wristwatch', priceUsd: 2_759_000, house: "Christie's", date: '2026-06-12', maker: 'patek-philippe' },
        { title: 'Rolex — an immensely well-preserved 14K yellow gold example', priceUsd: 1_803_400, house: 'Phillips', date: '2026-06-13', maker: 'rolex' },
        { title: 'Cartier — a unique, museum-quality piece', priceUsd: 1_402_080, house: 'Phillips', date: '2026-05-09', maker: 'cartier' },
        { title: 'Audemars Piguet — an extraordinary, historical stainless example', priceUsd: 1_256_030, house: 'Phillips', date: '2026-05-09', maker: 'audemars-piguet' },
      ]}
      movers={[
        { label: 'Patek Philippe', slug: 'patek-philippe', chgPct: 67, n: 193 },
      ]}
      coolers={[
        { label: 'Omega', slug: 'omega', chgPct: -34, n: 46 },
        { label: 'Rolex', slug: 'rolex', chgPct: -31, n: 244 },
        { label: 'Cartier', slug: 'cartier', chgPct: -30, n: 132 },
        { label: 'Audemars Piguet', slug: 'audemars-piguet', chgPct: -27, n: 113 },
      ]}
    >
      <H>Liquidity is not the question</H>
      <P>
        Watches were the easiest market to sell into all quarter: <B>96% sell-through</B> across 728
        lots, with the median hammering 8% over its estimate midpoint. Nothing else we track comes
        close on clearance. The question isn&rsquo;t whether watches sell — it&rsquo;s at what level.
      </P>
      <H>The sorting: Patek up 67%, everyone else down ~30%</H>
      <P>
        The market&rsquo;s median fell 19% year over year, but that single number hides the real
        move: <B>Patek Philippe&rsquo;s median rose 67%</B> across 193 sales while Rolex (−31%,
        n=244), Cartier (−30%), Audemars Piguet (−27%) and Omega (−34%) all repriced down through
        genuinely deep volume. Four of the five top prices ran through Phillips, which took
        <B> 65% of the quarter&rsquo;s value</B> — its Geneva and New York June sales were where the
        seven-figure material went.
      </P>
      <H>What it means for a buyer</H>
      <P>
        A 96%-sell-through market that&rsquo;s repricing down at the middle is close to a textbook
        buyer&rsquo;s setup outside the trophy tier: bids clear, but at a fairer level than a year
        ago. The below-market flags our engine carries into Q3 are concentrated in exactly that
        middle — references where the comps have already reset but estimates haven&rsquo;t.
      </P>
    </QuarterInsight>
  );
}
