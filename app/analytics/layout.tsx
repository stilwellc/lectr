import type { Metadata } from 'next';
import { bookFacts, n, shareMeta } from '../lib/og-meta';
import { SEGMENT_BARE_TITLE } from '../lib/route-titles';

const book = bookFacts();
export const metadata: Metadata = shareMeta({
  title: SEGMENT_BARE_TITLE['/analytics'],
  description: `Price indices with their 95% intervals, sell-through, house share and maker rankings across seven markets${book.settled ? ` — built from ${n(book.settled)} settled results` : ''}. A move prints only when its interval clears zero.`,
});

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
