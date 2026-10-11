export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Sports',
  description: 'Auction intelligence for the sports market — sport cards, game-worn, trophies & tickets. Non-sport and Pokémon excluded.',
  path: '/sports',
  image: '/og/m/sports.png',
  imageAlt: 'Sports — the market on lectr: settled results and lots on the block',
});

export { default } from '../page';
