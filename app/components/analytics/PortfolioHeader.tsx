'use client';

import { useMemo } from 'react';
import { MarketStats, AuctionLot } from '../../types';
import { formatPrice, fmtSignedPct } from '../../utils';
import { MARKETS } from '../../constants';
import { useMarket } from '../../lib/market';
import RecordBand from '../RecordBand';

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
    const stats = Object.values(statsByArtist);
    const totalRevenue = stats.reduce((sum, s) => sum + (s.totalAuctionRevenue || 0), 0);

    const weightedAppreciation = totalRevenue > 0
      ? stats.reduce((sum, s) =>
          sum + (s.appreciationRate || 0) * (s.totalAuctionRevenue || 0), 0) / totalRevenue
      : 0;

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

    return [
      { label: 'Total sales value', value: formatPrice(totalRevenue), sub: 'aggregate realized prices, all makers', tone: '' },
      { label: 'Total lots', value: allLots.length.toLocaleString(), sub: `${makerCount} makers tracked`, tone: '' },
      { label: 'Appreciation', value: fmtSignedPct(weightedAppreciation, 1), sub: 'sales-weighted avg across makers', tone: '' },
      estimateCard,
    ];
  }, [statsByArtist, allLots]);

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
        style={{ border: '1px solid rgba(25, 22, 18, 0.25)', borderRadius: 12, padding: '18px 20px 12px' }}
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
