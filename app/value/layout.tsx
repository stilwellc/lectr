import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Buy signals — where the hammer should clear the estimate',
  description: 'Live lots lectr expects to hammer over the house estimate, with the comps behind each call — every call replayed against what the lot actually hammered for.',
};

export default function ValueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
