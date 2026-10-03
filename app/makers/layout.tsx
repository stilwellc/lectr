import type { Metadata } from 'next';
import { ROSTER } from '../constants';
import { bookFacts, n, shareMeta } from '../lib/og-meta';

const book = bookFacts();
export const metadata: Metadata = shareMeta({
  title: 'The roster — makers tracked at auction',
  description: `${ROSTER.makers} makers and ${ROSTER.categories} categories on one ledger — sale history, live lots and the single price read the data will stand behind${book.settled ? `, from ${n(book.settled)} settled results` : ''}.`,
});

export default function MakersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
