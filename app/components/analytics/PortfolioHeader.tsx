'use client';

import { useMemo } from 'react';
import { MarketStats, AuctionLot } from '../../types';
import { formatPrice, fmtSignedPct } from '../../utils';
import { medianOverEstimatePct } from './ArtistRankingsTable';
import { MARKETS, marketOf } from '../../constants';
import { useMarket } from '../../lib/market';
import { useRayData } from '../../hooks/useRayData';
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
  // fetched meta.json wins — the build-time import is a first-paint fallback
  // only (build-time counts go stale between deploys; the crawl is nightly)
  const { totalLots: liveTotalLots } = useRayData();

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
    // ONE number, everywhere: the engine's realized-vs-estimate read (the
    // all-in published price vs the estimate mid — overEstimatePct, the
    // demand index's basis), MEDIAN over the market's sold lots with
    // estimates — the same helper the rankings table and roster wall print.
    // No second local statistic (the old mean of price/1.25 − estHigh
    // disagreed with every other surface on the page).
    const medianOverEstimate = medianOverEstimatePct(allLots);

    // makers tracked in THIS market — derived from the filtered stats passed
    // in, never the global roster
    const makerCount = Object.keys(statsByArtist).length;

    // estimate coverage: on markets where almost no sold lot carries an
    // estimate (sports/science) the vs-estimate KPI would be fake — show the
    // honest realized figure instead.
    const soldLots = allLots.filter(l => l.status === 'sold' && l.priceUsd);
    const estimateCoverage = soldLots.length ? lotsWithEstimate.length / soldLots.length : 0;
    const estimateCard = estimateCoverage >= 0.05 && medianOverEstimate > -999
      ? { label: 'Median sale vs. estimate', value: fmtSignedPct(medianOverEstimate, 1), sub: `${lotsWithEstimate.length.toLocaleString()} lots · all-in price vs. estimate mid`, tone: '' }
      : (() => {
          // STATS-FIRST: the loaded array is a slim sample on these verticals,
          // so median across the market's slug priceHistory (trailing 4 quarters'
          // medianPrice) when stats exist; only fall back to the loaded sample.
          const statMedians = Object.values(statsByArtist)
            .flatMap(x => (x.priceHistory || []).slice(-4).map(p => p.medianPrice))
            .filter(m => m > 0)
            .sort((a, b) => a - b);
          const prices = statMedians.length
            ? statMedians
            : recentSold.map(l => l.priceUsd!).sort((a, b) => a - b);
          const median = prices.length
            ? (prices.length % 2
                ? prices[(prices.length - 1) / 2]
                : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)
            : 0;
          return { label: 'Median sale, past year', value: formatPrice(median), sub: 'realized · no house estimates in this market', tone: '' };
        })();

    // ONE corpus count: the 'all' book is the full crawl corpus from
    // meta.json, never the served subset — and every count names its base.
    // On a live vertical the served array is a slim sample, so sum the
    // full-corpus totalLotsTracked over this market's slugs (same source as
    // the "sold lots" card below); allLots.length is only a last resort.
    const marketTracked = Object.values(statsByArtist).reduce((s, x) => s + (x.totalLotsTracked || 0), 0);
    const totalLotsCard = market === 'all' || !marketMeta?.live
      ? { label: 'Total lots', value: (liveTotalLots ?? meta.totalLots).toLocaleString(), sub: 'on the book, full corpus', tone: '' }
      : { label: 'Total lots', value: (marketTracked || allLots.length).toLocaleString(), sub: `on the book · ${contextLabel}`, tone: '' };

    // Sell-through, all-time: sold ÷ (sold + bought-in) over estimate-market
    // lots only — Goldin's no-reserve verticals conclude every lot 'sold', so
    // counting them would print a fake 100%; bid markets show sold count.
    // culture (Christie's/Sotheby's culture sales) carries real estimates + gets
    // bought-in — it's an estimate market, not a no-reserve one, so it belongs
    // in sell-through, not the "every lot concludes" bucket. (Only Goldin's
    // sports verticals are truly no-reserve.)
    const estMarketConcluded = allLots.filter(l =>
      (l.status === 'sold' || l.status === 'bought_in') &&
      ['art', 'design', 'watches', 'culture'].includes(marketOf(l.artist))
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
          // full-corpus count from stats.json (Σ totalLotsTracked over this
          // market's slugs), NOT soldLots.length — the loaded array is a slim
          // sample and undercounts these no-reserve/archive verticals badly.
          // totalSoldTracked is the SOLD-only count (totalLotsTracked includes
          // live lots — labeling that 'Sold lots' overstated every market)
          value: (Object.values(statsByArtist).reduce((s, x) => s + (x.totalSoldTracked ?? x.totalLotsTracked ?? 0), 0) || soldLots.length).toLocaleString(),
          sub: 'sold · no-reserve market, every lot concludes',
          tone: '',
        };

    return [
      totalLotsCard,
      { label: 'Makers tracked', value: makerCount.toLocaleString(), sub: `across ${contextLabel}`, tone: '' },
      sellThroughCard,
      estimateCard,
    ];
  }, [statsByArtist, allLots, market, marketMeta, contextLabel, liveTotalLots]);

  return (
    <section className="ray-portfolio-header rail">
      <style>{`
        /* section rhythm token — 40px desktop / 32px mobile, same computed
           values as before (full t/b rhythm would move the bottom +8px) */
        .ray-portfolio-header { padding-block: var(--sect-t); }
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
          footer="all-in price vs. estimate mid where estimates exist"
          cells={cards.map(card => ({ k: card.label, v: card.value, sub: card.sub }))}
        />
      </div>
    </section>
  );
}
