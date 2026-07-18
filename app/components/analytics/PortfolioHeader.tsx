'use client';

import { useMemo } from 'react';
import { MarketStats, AuctionLot } from '../../types';
import { formatPrice, fmtSignedPct } from '../../utils';
import { MARKETS, marketOf } from '../../constants';
import { useMarket } from '../../lib/market';
import RecordBand from '../RecordBand';
import meta from '../../../public/data/ray/meta.json';

interface Props {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
}

export default function PortfolioHeader({ statsByArtist, allLots }: Props) {
  // the market label for the certificate's context slot — read from the same
  // market context the page filters by, so props stay untouched
  const { market } = useMarket();
  const marketMeta = MARKETS.find(m => m.key === market);
  const contextLabel = marketMeta?.live ? marketMeta.label : 'all markets';

  const cards = useMemo(() => {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const recentSold = allLots.filter(l =>
      l.status === 'sold' && l.priceUsd && new Date(l.saleDate) >= oneYearAgo
    );
    const avgPrice12mo = recentSold.length
      ? recentSold.reduce((s, l) => s + (l.priceUsd || 0), 0) / recentSold.length
      : 0;

    const lotsWithEstimate = allLots.filter(l =>
      l.status === 'sold' && l.priceUsd && l.estimateHigh && l.estimateHigh > 0
    );
    // HAMMER basis: estimates are hammer-basis while priceUsd includes the
    // buyer's premium (~1.25×) — comparing them raw overstated "over estimate"
    // by ~25pts. Served lots don't carry hammerUsd, so divide by the measured
    // flat premium factor.
    const avgOverEstimate = lotsWithEstimate.length
      ? lotsWithEstimate.reduce((s, l) =>
          s + ((l.priceUsd! / 1.25 - l.estimateHigh!) / l.estimateHigh!) * 100, 0) / lotsWithEstimate.length
      : 0;

    // makers tracked in THIS market — derived from the filtered stats passed
    // in, never the global roster
    const makerCount = Object.keys(statsByArtist).length;

    // estimate coverage: on markets where almost no sold lot carries an
    // estimate (sports/science) the vs-estimate KPI would be fake — show the
    // honest realized figure instead.
    const soldLots = allLots.filter(l => l.status === 'sold' && l.priceUsd);
    const estimateCoverage = soldLots.length ? lotsWithEstimate.length / soldLots.length : 0;
    const estimateCard = estimateCoverage >= 0.05
      ? { label: 'Avg. hammer vs estimate', value: fmtSignedPct(avgOverEstimate, 1), sub: `${lotsWithEstimate.length.toLocaleString()} lots · hammer basis`, tone: '' }
      : (() => {
          const prices = recentSold.map(l => l.priceUsd!).sort((a, b) => a - b);
          const median = prices.length
            ? (prices.length % 2
                ? prices[(prices.length - 1) / 2]
                : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)
            : 0;
          return { label: 'Median sale, past year', value: formatPrice(median), sub: 'realized · no house estimates in this market', tone: '' };
        })();

    // ONE corpus count: the 'all' book is the full crawl corpus from
    // meta.json, never the served subset — and every count names its base.
    const totalLotsCard = market === 'all' || !marketMeta?.live
      ? { label: 'Total lots', value: meta.totalLots.toLocaleString(), sub: 'on the book, full corpus', tone: '' }
      : { label: 'Total lots', value: allLots.length.toLocaleString(), sub: `on the book · ${contextLabel}`, tone: '' };

    // Sell-through, all-time: sold ÷ (sold + bought-in) over estimate-market
    // lots only — Goldin's no-reserve verticals conclude every lot 'sold', so
    // counting them would print a fake 100%; bid markets show sold count.
    const estMarketConcluded = allLots.filter(l =>
      (l.status === 'sold' || l.status === 'bought_in') &&
      ['art', 'design', 'watches'].includes(marketOf(l.artist))
    );
    const estMarketSold = estMarketConcluded.filter(l => l.status === 'sold').length;
    const sellThroughCard = estMarketConcluded.length >= 5
      ? {
          label: 'Sell-through, all-time',
          value: `${Math.round((estMarketSold / estMarketConcluded.length) * 100)}%`,
          sub: `${estMarketSold.toLocaleString()} sold of ${estMarketConcluded.length.toLocaleString()} concluded · estimate markets`,
          tone: '',
        }
      : {
          label: 'Sold lots',
          value: soldLots.length.toLocaleString(),
          sub: 'sold · no-reserve market, every lot concludes',
          tone: '',
        };

    return [
      totalLotsCard,
      { label: 'Makers tracked', value: makerCount.toLocaleString(), sub: `across ${contextLabel}`, tone: '' },
      sellThroughCard,
      estimateCard,
    ];
  }, [statsByArtist, allLots, market, marketMeta, contextLabel]);

  return (
    <section className="ray-portfolio-header rail">
      <style>{`
        .ray-portfolio-header { padding-block: 40px; }
        @media (max-width: 768px) {
          .ray-portfolio-header { padding-block: 32px; }
        }
      `}</style>

      {/* the book, printed — the same certificate CARD as the maker pages:
          .ray-paper flips the tokens, the drawn border stands in for the
          full-bleed band rule the rail can't give us here */}
      <div
        className="ray-paper"
        style={{ border: '1px solid var(--paper-edge)', borderRadius: 12, padding: '18px 20px 12px' }}
      >
        <RecordBand
          title="The book"
          context={contextLabel}
          footer="hammer basis where estimates exist"
          cells={cards.map(card => ({ k: card.label, v: card.value, sub: card.sub }))}
        />
      </div>
    </section>
  );
}
