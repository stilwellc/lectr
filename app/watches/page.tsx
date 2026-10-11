export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Watches',
  description: 'Auction intelligence for the reference market — Rolex, Patek Philippe, Audemars Piguet, Omega, Cartier.',
  path: '/watches',
  image: '/og/m/watches.png',
  imageAlt: 'Watches — the market on lectr: settled results and lots on the block',
});

export { default } from '../page';
