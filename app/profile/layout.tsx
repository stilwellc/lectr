import type { Metadata } from 'next';
// the desk's one row grammar (desk/row.tsx) — a global sheet, so every room
// that prints a lot row reads it from the layout, not from each room
import './styles/row.css';

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
