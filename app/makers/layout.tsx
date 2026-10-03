import type { Metadata } from 'next';
import { ROSTER } from '../constants';
import { bookFacts, n, shareMeta } from '../lib/og-meta';
import { SEGMENT_BARE_TITLE } from '../lib/route-titles';

const book = bookFacts();
export const metadata: Metadata = shareMeta({
  title: SEGMENT_BARE_TITLE['/makers'],
  description: `${ROSTER.makers} makers and ${ROSTER.categories} categories on one ledger — sale history, live lots and the single price read the data will stand behind${book.settled ? `, from ${n(book.settled)} settled results` : ''}.`,
});

export default function MakersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
