import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market analytics — the collectibles market in numbers',
  description: 'Price indices, sell-through, house distribution and maker rankings across art, design, watches, sports, science and pop culture.',
};

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
