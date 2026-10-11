export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'TCG',
  description: 'Auction intelligence for the trading-card game market — Pokémon singles, sealed boxes & sets, priced against the settled record.',
  path: '/tcg',
  image: '/og/m/tcg.png',
  imageAlt: 'TCG — the market on lectr: settled results and lots on the block',
});

export { default } from '../page';
