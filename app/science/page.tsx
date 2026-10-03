export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { shareMeta, verticalDescription } from '../lib/og-meta';

// Counts are cut at build (the nightly rebuild refreshes them); the card is
// tonight's call inside this vertical, drawn by scripts/build-og.tsx. The
// title keeps the lander's noun — MARKET_TITLE in app/lib/market.tsx
// re-asserts it on a client market switch.
export const metadata: Metadata = shareMeta({
  title: 'Science',
  description: verticalDescription('science'),
  image: '/og/live/call-science.png',
});

export { default } from '../page';
