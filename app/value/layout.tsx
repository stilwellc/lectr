import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Buy signals — lots priced below their comps',
  description: 'Lots trading below where their comparable sales clear — each call replayed against what the lot actually hammered for.',
};

export default function ValueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
