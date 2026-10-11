export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Science',
  description: 'Auction intelligence for the science market — meteorites, fossils, space exploration & instruments.',
  path: '/science',
  image: '/og/m/science.png',
  imageAlt: 'Science — the market on lectr: settled results and lots on the block',
});

export { default } from '../page';
