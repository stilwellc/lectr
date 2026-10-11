import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Market analytics — the collectibles market in numbers',
  description: 'Price indices, sell-through, house distribution and maker rankings across art, design, watches, sports, science and pop culture.',
  path: '/analytics',
});

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
