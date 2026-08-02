import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'The roster — makers tracked at auction',
  description: 'Every maker lectr tracks — demand sparklines, record sales, and where each market is heading.',
};

export default function ArtistsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
