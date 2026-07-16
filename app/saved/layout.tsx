import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your watchlist',
  description: 'The lots you’re tracking — private to you, synced across devices.',
  robots: { index: false, follow: false },
};

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
