import { MARKETS } from '../../constants';

/**
 * /value/<market> — the buy-signal desk with the market pinned in the URL
 * (audit-urls §3). Same mounted board as /value: MarketProvider derives the
 * market straight from the path (segmentMarket in app/lib/market.tsx), so
 * this is a pure re-export — no props, no wrapper. 'all' is the bare route.
 */

// static export: the six live verticals, enumerated at build
export const dynamicParams = false;

export function generateStaticParams() {
  return MARKETS.filter(m => m.live && m.key !== 'all').map(m => ({ market: m.key }));
}

// Title must mirror SEGMENT_PAGES' noun in app/lib/market.tsx — the pushState
// market switch re-asserts `${label} buy signals — lectr` by hand.
export function generateMetadata({ params }: { params: { market: string } }) {
  const label = MARKETS.find(m => m.key === params.market)?.label || params.market;
  return {
    title: `${label} buy signals`,
    description: `${label} lots trading below where their comparable sales clear — each call replayed against what the lot actually hammered for.`,
    alternates: { canonical: `/value/${params.market}` },
  };
}

import Base from '../page';

// A prop-less WRAPPER, not a re-export: forwarding the server-injected
// params/searchParams into the client page component makes Next serialize
// searchParams across the boundary — a NEXT_STATIC_GEN_BAILOUT under
// output:'export'. The market derives from the URL in MarketProvider, so the
// page needs no props at all.
export default function MarketSegmentPage() {
  return <Base />;
}
