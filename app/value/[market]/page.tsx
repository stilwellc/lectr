import { MARKETS, type Market } from '../../constants';
import { lotNoun, marketFacts, n, shareMeta } from '../../lib/og-meta';

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
export async function generateMetadata(props: { params: Promise<{ market: string }> }) {
  const params = await props.params;
  const label = MARKETS.find(m => m.key === params.market)?.label || params.market;
  const f = marketFacts(params.market as Market);
  const noun = params.market === 'tcg' ? 'TCG' : label.toLowerCase();
  return shareMeta({
    title: `${label} buy signals — lectr`,
    absolute: true,
    description: f.flagged
      ? `${n(f.flagged)} live ${noun} ${f.flagged === 1 ? 'lot' : 'lots'} where the record says the hammer lands above the house estimate, out of ${n(f.live)} on the block. Each call is logged tonight and graded against the result.`
      : f.live
        ? `No ${lotNoun(params.market as Market)} clears the bar tonight — ${n(f.live)} on the block, each read against its comparable sales.`
        : `No ${lotNoun(params.market as Market)} on the block right now — the desk reads the next sale against its comparable sales the night it lists.`,
    image: `/og/live/call-${params.market}.png`,
    canonical: `/value/${params.market}`,
  });
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
