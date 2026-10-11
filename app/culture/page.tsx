export const dynamic = 'force-static';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Pop Culture',
  description: 'Auction intelligence for the pop-culture market — screen-used props, stage-worn music & handwritten lyrics. The unrepeatable, never the mass market.',
  path: '/culture',
  image: '/og/m/culture.png',
  imageAlt: 'Pop Culture — the market on lectr: settled results and lots on the block',
});

export { default } from '../page';
