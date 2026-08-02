import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'The roster — makers tracked at auction',
  description: 'Every maker lectr tracks — sparklines, record sales, and where each market is heading.',
};

export default function MakersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
