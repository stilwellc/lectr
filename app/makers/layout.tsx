import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'The roster — makers tracked at auction',
  description: 'Every maker lectr tracks — sparklines, record sales, and where each market is heading.',
  path: '/makers',
});

export default function MakersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
