export const dynamic = 'force-static';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TCG',
  description: 'Auction intelligence for the trading-card game market — Pokémon singles, sealed boxes & sets, priced against the settled record.',
  openGraph: { title: 'TCG — lectr', description: 'Auction intelligence for the trading-card game market — Pokémon singles, sealed boxes & sets, priced against the settled record.' },
};

export { default } from '../page';
