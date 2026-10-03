import type { Metadata } from 'next';
import { withShare } from '../lib/og-meta';

export const metadata: Metadata = withShare({
  // the page calls itself "My profile" everywhere (nav, masthead, ⌘K) — the
  // tab title says the same
  title: 'My profile',
  description: 'The lots you’re tracking — private to you, synced across devices.',
  robots: { index: false, follow: false },
});

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
