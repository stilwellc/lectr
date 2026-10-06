export const dynamic = 'force-static';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Art',
  description: 'Auction intelligence for the art market — paintings, editions, photography & sculpture.',
  openGraph: { title: 'Art — lectr', description: 'Auction intelligence for the art market — paintings, editions, photography & sculpture.' },
};

export { default } from '../page';
