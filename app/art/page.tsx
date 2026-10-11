export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Art',
  description: 'Auction intelligence for the art market — paintings, editions, photography & sculpture.',
  path: '/art',
  image: '/og/m/art.png',
  imageAlt: 'Art — the market on lectr: settled results and lots on the block',
});

export { default } from '../page';
