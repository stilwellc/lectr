import { MARKETS, type Market } from '../../constants';
import { marketFacts, n, shareMeta } from '../../lib/og-meta';

/**
 * /analytics/<market> — the analytics desk with the market pinned in the URL
 * (audit-urls §3: market is a path segment wherever it changes what you're
 * reading). Same mounted board as /analytics: MarketProvider derives the
 * market straight from the path (segmentMarket in app/lib/market.tsx), so
 * this is a pure re-export — no props, no wrapper. 'all' is the bare route.
 */

// static export: the six live verticals, enumerated at build
export const dynamicParams = false;

export function generateStaticParams() {
  return MARKETS.filter(m => m.live && m.key !== 'all').map(m => ({ market: m.key }));
}

// Title must mirror SEGMENT_PAGES' noun in app/lib/market.tsx — the pushState
// market switch re-asserts `${label} analytics — lectr` by hand.
export async function generateMetadata(props: { params: Promise<{ market: string }> }) {
  const params = await props.params;
  const label = MARKETS.find(m => m.key === params.market)?.label || params.market;
  const f = marketFacts(params.market as Market);
  const noun = params.market === 'tcg' ? 'TCG' : label.toLowerCase();
  return shareMeta({
    title: segmentTitle(label, 'analytics'),
    absolute: true,
    description: `The ${noun} market in numbers${f.settled ? ` — ${n(f.settled)} settled results` : ''}: price indices with their 95% intervals, sell-through, house share and maker rankings.`,
    canonical: `/analytics/${params.market}`,
  });
}

import Base from '../page';
import { segmentTitle } from '../../lib/route-titles';

// A prop-less WRAPPER, not a re-export: forwarding the server-injected
// params/searchParams into the client page component makes Next serialize
// searchParams across the boundary — a NEXT_STATIC_GEN_BAILOUT under
// output:'export'. The market derives from the URL in MarketProvider, so the
// page needs no props at all.
export default function MarketSegmentPage() {
  return <Base />;
}
