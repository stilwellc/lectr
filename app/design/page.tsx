export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Design',
  description: 'Auction intelligence for the design market — furniture & objects by Nakashima, Eames, Prouvé, Jeanneret.',
  path: '/design',
  image: '/og/m/design.png',
  imageAlt: 'Design — the market on lectr: settled results and lots on the block',
});

export { default } from '../page';
