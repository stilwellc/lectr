import type { Metadata } from 'next';

export const metadata: Metadata = {
  // the page calls itself "My profile" everywhere (nav, masthead, ⌘K) — the
  // tab title says the same
  title: 'My profile',
  description: 'The lots you’re tracking — private to you, synced across devices.',
  robots: { index: false, follow: false },
};

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
