import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Corrections register — where a published figure was reconciled to the live build',
  description:
    'A public, dated log of when lectr’s published editorial figures get reconciled against the current engine. The posts quote real numbers at the time they’re written; the engine keeps moving. When a figure drifts, we log it here in full rather than quietly patch it.',
  alternates: { canonical: '/blog/corrections' },
};

export default function CorrectionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
