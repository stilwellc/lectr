import type { Metadata } from 'next';
import { marketFacts, n, shareMeta } from '../lib/og-meta';
import { SEGMENT_BARE_TITLE } from '../lib/route-titles';

// The share card is tonight's call (public/og/live/call-all.png, drawn by
// scripts/build-og.tsx with the social desk's pickCall mirror).
const all = marketFacts('all');
export const metadata: Metadata = shareMeta({
  title: SEGMENT_BARE_TITLE['/value'],
  description: all.flagged
    ? `${n(all.flagged)} of ${n(all.live)} live lots where the record says the hammer lands above the house estimate. Each call is logged the night it is made and graded against the result.`
    : `No live lot clears the bar tonight — ${n(all.live)} on the block, each read against its comparable sales. Calls are logged the night they are made and graded against the result.`,
  image: '/og/live/call-all.png',
});

export default function ValueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
