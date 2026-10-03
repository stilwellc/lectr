import { MARKETS, marketArtists, type Market } from '../../../constants';
import { marketFacts, n, shareMeta } from '../../../lib/og-meta';

/**
 * /makers/m/<market> — the roster with the market pinned in the URL
 * (audit-urls §3). The /m/ level keeps the six market keys out of the
 * maker-slug namespace (/makers/<slug>). Same mounted board as /makers:
 * MarketProvider derives the market straight from the path (segmentMarket in
 * app/lib/market.tsx), so this is a pure re-export — no props, no wrapper.
 * 'all' is the bare /makers route.
 */

// static export: the six live verticals, enumerated at build
export const dynamicParams = false;

export function generateStaticParams() {
  return MARKETS.filter(m => m.live && m.key !== 'all').map(m => ({ market: m.key }));
}

// Title must mirror SEGMENT_PAGES' noun in app/lib/market.tsx — the pushState
// market switch re-asserts `${label} makers — lectr` by hand.
export async function generateMetadata(props: { params: Promise<{ market: string }> }) {
  const params = await props.params;
  const label = MARKETS.find(m => m.key === params.market)?.label || params.market;
  const f = marketFacts(params.market as Market);
  const noun = params.market === 'tcg' ? 'TCG' : label.toLowerCase();
  const roster = marketArtists(params.market as Market).size;
  return shareMeta({
    title: `${label} makers — lectr`,
    absolute: true,
    description: `${roster} ${noun} ${roster === 1 ? 'name' : 'names'} on the ledger${f.settled ? ` with ${n(f.settled)} settled results between them` : ''} — sale history, records and the live lots, one dossier each.`,
    canonical: `/makers/m/${params.market}`,
  });
}

import Base from '../../page';

// A prop-less WRAPPER, not a re-export: forwarding the server-injected
// params/searchParams into the client page component makes Next serialize
// searchParams across the boundary — a NEXT_STATIC_GEN_BAILOUT under
// output:'export'. The market derives from the URL in MarketProvider, so the
// page needs no props at all.
export default function MarketSegmentPage() {
  return <Base />;
}
