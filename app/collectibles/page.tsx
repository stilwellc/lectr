export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Collectibles',
  description: 'Auction intelligence across every market lectr tracks — art, design, watches, sports, TCG, science & pop culture.',
  path: '/collectibles',
});

export { default } from '../page';
